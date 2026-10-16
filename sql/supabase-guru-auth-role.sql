-- ============================================================
-- MIGRATION: SUPABASE GURU AUTHENTICATION & ROLE-BASED ACCESS
-- Jalankan skrip ini di SQL Editor Supabase Project Anda
-- ============================================================

-- 1. Pastikan ekstensi pgcrypto tersedia untuk hashing password
create extension if not exists "pgcrypto" with schema extensions;

-- 2. Pastikan kolom di public.profiles mendukung NIP & role 'guru'
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check check (role in ('admin', 'guru', 'siswa'));
alter table public.profiles add column if not exists nip text;

-- 3. Tambahkan kolom user_id pada public.data_guru jika belum ada
alter table public.data_guru add column if not exists user_id uuid references auth.users(id) on delete set null;

-- 4. Function & Trigger: Otomatis buat / perbarui akun auth & profiles saat data_guru ditambah atau diubah
create or replace function public.sync_guru_to_auth_and_profile()
returns trigger
language plpgsql
security definer
set search_path = extensions, public, auth
as $$
declare
  v_nip text;
  v_email text;
  v_name text;
  v_user_id uuid;
  v_encrypted_password text;
begin
  v_nip := trim(coalesce(new.nip, ''));
  v_name := trim(coalesce(new.nama, 'Guru'));

  if v_nip = '' then
    return new;
  end if;

  v_email := lower(v_nip) || '@gmail.com';

  -- Cek apakah user sudah ada di auth.users berdasarkan email
  select id into v_user_id from auth.users where lower(email) = v_email limit 1;

  if v_user_id is null then
    -- Buat user baru di auth.users dengan default password = NIP
    v_user_id := gen_random_uuid();
    v_encrypted_password := extensions.crypt(v_nip, extensions.gen_salt('bf'));

    insert into auth.users (
      id,
      instance_id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change
    ) values (
      v_user_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'authenticated',
      'authenticated',
      v_email,
      v_encrypted_password,
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_name, 'role', 'guru', 'nip', v_nip),
      now(),
      now(),
      '',
      '',
      '',
      ''
    );
  else
    -- Jika user sudah ada, perbarui metadata namanya jika berubah
    update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('name', v_name, 'role', 'guru', 'nip', v_nip),
        updated_at = now()
    where id = v_user_id;
  end if;

  -- Buat / perbarui profil di public.profiles
  insert into public.profiles (user_id, name, role, nip)
  values (v_user_id, v_name, 'guru', v_nip)
  on conflict (user_id) do update set
    name = excluded.name,
    role = 'guru',
    nip = excluded.nip,
    updated_at = now();

  -- Simpan link user_id di data_guru
  new.user_id := v_user_id;

  return new;
end;
$$;

-- Pasang trigger pada public.data_guru
drop trigger if exists trg_sync_guru_to_auth on public.data_guru;
create trigger trg_sync_guru_to_auth
  before insert or update of nip, nama on public.data_guru
  for each row
  execute function public.sync_guru_to_auth_and_profile();

-- Trigger saat guru dihapus: hapus auth.users akunnya (juga otomatis cascade ke profiles)
create or replace function public.delete_guru_auth_account()
returns trigger
language plpgsql
security definer
set search_path = extensions, public, auth
as $$
declare
  v_email text;
begin
  if old.nip is not null and trim(old.nip) <> '' then
    v_email := lower(trim(old.nip)) || '@gmail.com';
    delete from auth.users where lower(email) = v_email;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_delete_guru_auth on public.data_guru;
create trigger trg_delete_guru_auth
  after delete on public.data_guru
  for each row
  execute function public.delete_guru_auth_account();

-- 5. Sinkronisasi akun retroaktif untuk seluruh guru yang sudah ada saat ini
do $$
declare
  r record;
  v_email text;
  v_user_id uuid;
  v_encrypted_password text;
begin
  for r in select id, trim(nip) as nip, trim(nama) as nama from public.data_guru where nip is not null and trim(nip) <> '' loop
    v_email := lower(r.nip) || '@gmail.com';
    select id into v_user_id from auth.users where lower(email) = v_email limit 1;

    if v_user_id is null then
      v_user_id := gen_random_uuid();
      v_encrypted_password := extensions.crypt(r.nip, extensions.gen_salt('bf'));

      insert into auth.users (
        id,
        instance_id,
        aud,
        role,
        email,
        encrypted_password,
        email_confirmed_at,
        raw_app_meta_data,
        raw_user_meta_data,
        created_at,
        updated_at,
        confirmation_token,
        recovery_token,
        email_change_token_new,
        email_change
      ) values (
        v_user_id,
        '00000000-0000-0000-0000-000000000000'::uuid,
        'authenticated',
        'authenticated',
        v_email,
        v_encrypted_password,
        now(),
        '{"provider":"email","providers":["email"]}'::jsonb,
        jsonb_build_object('name', r.nama, 'role', 'guru', 'nip', r.nip),
        now(),
        now(),
        '',
        '',
        '',
        ''
      );
    end if;

    insert into public.profiles (user_id, name, role, nip)
    values (v_user_id, r.nama, 'guru', r.nip)
    on conflict (user_id) do update set
      name = excluded.name,
      role = 'guru',
      nip = excluded.nip,
      updated_at = now();

    update public.data_guru set user_id = v_user_id where id = r.id;
  end loop;
end;
$$;

-- 6. Helper Function: is_admin_or_guru() untuk RLS
create or replace function public.is_admin_or_guru()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and role in ('admin', 'guru')
  );
$$;
grant execute on function public.is_admin_or_guru() to authenticated, anon;

-- 7. RPC: Admin mereset password guru (bisa kembali ke NIP atau password baru)
create or replace function public.admin_set_guru_password(p_nip text, p_new_password text default null)
returns jsonb
language plpgsql
security definer
set search_path = extensions, public, auth
as $$
declare
  v_email text;
  v_pass text;
begin
  if not public.is_admin() then
    raise exception 'Hanya Administrator yang memiliki akses untuk mengubah password akun guru.';
  end if;

  v_email := lower(trim(p_nip)) || '@gmail.com';
  v_pass := trim(coalesce(p_new_password, p_nip));

  if char_length(v_pass) < 4 then
    raise exception 'Password minimal 4 karakter.';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(v_pass, extensions.gen_salt('bf')),
      updated_at = now()
  where lower(email) = v_email;

  if not found then
    raise exception 'Akun guru dengan NIP % tidak ditemukan di sistem auth.', p_nip;
  end if;

  return jsonb_build_object('success', true, 'message', 'Password guru berhasil diperbarui.');
end;
$$;
grant execute on function public.admin_set_guru_password(text, text) to authenticated;

-- 8. Pembaruan Policy RLS agar Guru dapat membaca dan mengelola data yang diizinkan
-- (Siswa, Absensi, Ujian, Aktifitas, Kelas/Pelajaran baca)

-- Profiles
drop policy if exists profiles_read_self_or_admin on public.profiles;
create policy profiles_read_self_or_admin on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin_or_guru()));

-- Data Siswa (Guru & Admin bisa baca & kelola siswa)
drop policy if exists data_siswa_admin_all on public.data_siswa;
create policy data_siswa_admin_all on public.data_siswa
  for all to authenticated
  using ((select public.is_admin_or_guru()))
  with check ((select public.is_admin_or_guru()));

-- Absensi (Guru & Admin bisa baca & catat absensi)
drop policy if exists absensi_admin_all on public.absensi;
create policy absensi_admin_all on public.absensi
  for all to authenticated
  using ((select public.is_admin_or_guru()))
  with check ((select public.is_admin_or_guru()));

-- Data Guru (Semua guru & admin bisa baca daftar guru; hanya admin yang bisa insert/update/delete)
drop policy if exists data_guru_admin_all on public.data_guru;
drop policy if exists data_guru_read on public.data_guru;
drop policy if exists data_guru_admin_manage on public.data_guru;
create policy data_guru_read on public.data_guru
  for select to authenticated
  using ((select public.is_admin_or_guru()));

create policy data_guru_admin_manage on public.data_guru
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Data Kelas & Relasi Kelas Tahun Ajaran
drop policy if exists data_kelas_admin_all on public.data_kelas;
drop policy if exists data_kelas_read on public.data_kelas;
drop policy if exists data_kelas_admin_manage on public.data_kelas;
create policy data_kelas_read on public.data_kelas
  for select to authenticated
  using ((select public.is_admin_or_guru()));

create policy data_kelas_admin_manage on public.data_kelas
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists kelas_tahun_ajaran_admin_all on public.kelas_tahun_ajaran;
drop policy if exists kelas_tahun_ajaran_read on public.kelas_tahun_ajaran;
drop policy if exists kelas_tahun_ajaran_admin_manage on public.kelas_tahun_ajaran;
create policy kelas_tahun_ajaran_read on public.kelas_tahun_ajaran
  for select to authenticated
  using ((select public.is_admin_or_guru()));

create policy kelas_tahun_ajaran_admin_manage on public.kelas_tahun_ajaran
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Data Siswa Kelas Tahun Ajaran
drop policy if exists siswa_kelas_tahun_ajaran_admin_all on public.siswa_kelas_tahun_ajaran;
create policy siswa_kelas_tahun_ajaran_admin_all on public.siswa_kelas_tahun_ajaran
  for all to authenticated
  using ((select public.is_admin_or_guru()))
  with check ((select public.is_admin_or_guru()));

-- Data Pelajaran
drop policy if exists data_pelajaran_admin_all on public.data_pelajaran;
drop policy if exists data_pelajaran_read on public.data_pelajaran;
drop policy if exists data_pelajaran_admin_manage on public.data_pelajaran;
create policy data_pelajaran_read on public.data_pelajaran
  for select to authenticated
  using ((select public.is_admin_or_guru()));

create policy data_pelajaran_admin_manage on public.data_pelajaran
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Tahun Ajaran & Pengaturan Tahun Ajaran
drop policy if exists tahun_ajaran_admin_all on public.tahun_ajaran;
drop policy if exists tahun_ajaran_read on public.tahun_ajaran;
drop policy if exists tahun_ajaran_admin_manage on public.tahun_ajaran;
create policy tahun_ajaran_read on public.tahun_ajaran
  for select to authenticated
  using ((select public.is_admin_or_guru()));

create policy tahun_ajaran_admin_manage on public.tahun_ajaran
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists pengaturan_tahun_ajaran_admin_read on public.pengaturan_tahun_ajaran;
create policy pengaturan_tahun_ajaran_admin_read on public.pengaturan_tahun_ajaran
  for select to authenticated
  using ((select public.is_admin_or_guru()));

-- Storage Foto Siswa
drop policy if exists student_photos_admin_read on storage.objects;
create policy student_photos_admin_read on storage.objects
  for select to authenticated
  using (bucket_id = 'student-photos' and (select public.is_admin_or_guru()));

-- Reload Schema Cache PostgREST
notify pgrst, 'reload schema';
