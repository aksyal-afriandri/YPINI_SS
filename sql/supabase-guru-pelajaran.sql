-- Migration: Relasi Guru ke Mata Pelajaran (data_guru -> data_pelajaran)
-- Jalankan skrip ini di SQL Editor Supabase project Anda

-- 1. Tambahkan kolom pelajaran_id pada tabel data_guru jika belum ada
alter table public.data_guru
add column if not exists pelajaran_id bigint references public.data_pelajaran(id) on delete set null;

-- 2. Tambahkan index untuk optimasi performa query join guru & pelajaran
create index if not exists idx_data_guru_pelajaran_id on public.data_guru(pelajaran_id);

-- 3. Pastikan izin akses (RLS) mengizinkan select, insert, update, delete
grant select, insert, update, delete on public.data_guru to authenticated;
grant select on public.data_pelajaran to authenticated;

-- 4. Reload cache skema PostgREST agar relasi langsung terbaca
notify pgrst, 'reload schema';
