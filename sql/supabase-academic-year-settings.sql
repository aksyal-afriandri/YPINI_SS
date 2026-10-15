create table if not exists public.pengaturan_tahun_ajaran (
  id smallint primary key default 1 check (id = 1),
  tahun_ajaran_id bigint not null references public.tahun_ajaran (id) on delete restrict,
  updated_at timestamptz not null default now()
);

grant select, insert, update on public.pengaturan_tahun_ajaran to authenticated;
alter table public.pengaturan_tahun_ajaran enable row level security;

drop policy if exists pengaturan_tahun_ajaran_admin_read on public.pengaturan_tahun_ajaran;
create policy pengaturan_tahun_ajaran_admin_read on public.pengaturan_tahun_ajaran
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists pengaturan_tahun_ajaran_admin_insert on public.pengaturan_tahun_ajaran;
create policy pengaturan_tahun_ajaran_admin_insert on public.pengaturan_tahun_ajaran
  for insert to authenticated
  with check ((select public.is_admin()));

drop policy if exists pengaturan_tahun_ajaran_admin_update on public.pengaturan_tahun_ajaran;
create policy pengaturan_tahun_ajaran_admin_update on public.pengaturan_tahun_ajaran
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop trigger if exists pengaturan_tahun_ajaran_set_updated_at on public.pengaturan_tahun_ajaran;
create trigger pengaturan_tahun_ajaran_set_updated_at before update on public.pengaturan_tahun_ajaran
  for each row execute procedure public.set_updated_at();
