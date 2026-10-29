-- ==============================================================================
-- MIGRATION: SISTEM KEAMANAN PENGATURAN UJIAN & RELASI GURU KE MAPEL & KELAS
-- ==============================================================================
-- PANDUAN PENGGUNAAN:
-- 1. Buka dashboard Supabase project Anda di browser.
-- 2. Masuk ke menu "SQL Editor" di sidebar kiri.
-- 3. Tempelkan skrip ini, lalu klik tombol "Run".
-- ==============================================================================

-- 1. Tambahkan kolom relasi multi-pelajaran dan multi-kelas pada public.data_guru
ALTER TABLE IF EXISTS public.data_guru
  ADD COLUMN IF NOT EXISTS pelajaran_ids bigint[],
  ADD COLUMN IF NOT EXISTS kelas_list text[],
  ADD COLUMN IF NOT EXISTS kelas_ids bigint[];

COMMENT ON COLUMN public.data_guru.pelajaran_ids IS 'Daftar ID mata pelajaran yang diampu oleh guru (bisa lebih dari satu)';
COMMENT ON COLUMN public.data_guru.kelas_list IS 'Daftar nama kelas yang diajar oleh guru, misal ARRAY[''7A'', ''7B'', ''8A'']';
COMMENT ON COLUMN public.data_guru.kelas_ids IS 'Daftar ID kelas (opsional) yang diajar oleh guru';

-- 2. Sinkronisasi data lama di data_guru:
-- Jika pelajaran_id sudah ada tapi pelajaran_ids masih kosong, isi dengan array dari pelajaran_id
UPDATE public.data_guru
SET pelajaran_ids = ARRAY[pelajaran_id]
WHERE pelajaran_id IS NOT NULL 
  AND (pelajaran_ids IS NULL OR cardinality(pelajaran_ids) = 0);

-- 3. Tambahkan kolom password_ujian pada public.ujian
ALTER TABLE IF EXISTS public.ujian
  ADD COLUMN IF NOT EXISTS password_ujian text;

COMMENT ON COLUMN public.ujian.password_ujian IS 'Password otorisasi untuk mengubah pengaturan ujian, aktif/nonaktif, edit, kelola soal, dan hapus ujian';

-- 4. Berikan izin akses pada tabel
GRANT SELECT, INSERT, UPDATE, DELETE ON public.data_guru TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ujian TO authenticated;

-- 5. Reload cache skema PostgREST Supabase
NOTIFY pgrst, 'reload schema';
