-- ==============================================================================
-- SKRIP PERBAIKAN CASCADE FOREIGN KEY UJIAN, PERCOBAAN, & JAWABAN SISWA
-- Jalankan skrip ini di SQL Editor Supabase.
-- Masalah yang diatasi:
-- "update or delete on table 'ujian' violates foreign key constraint 'percobaan_ujian_ujian_id_fkey'"
-- Mengubah relasi agar saat Ujian dihapus, data percobaan_ujian dan jawaban_siswa
-- otomatis ikut terhapus (ON DELETE CASCADE) tanpa menimbulkan error foreign key.
-- ==============================================================================

-- 1. Pastikan foreign key pada percobaan_ujian memiliki ON DELETE CASCADE
ALTER TABLE IF EXISTS public.percobaan_ujian
  DROP CONSTRAINT IF EXISTS percobaan_ujian_ujian_id_fkey;

ALTER TABLE IF EXISTS public.percobaan_ujian
  ADD CONSTRAINT percobaan_ujian_ujian_id_fkey
    FOREIGN KEY (ujian_id) REFERENCES public.ujian(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.percobaan_ujian
  DROP CONSTRAINT IF EXISTS percobaan_ujian_siswa_id_fkey;

ALTER TABLE IF EXISTS public.percobaan_ujian
  ADD CONSTRAINT percobaan_ujian_siswa_id_fkey
    FOREIGN KEY (siswa_id) REFERENCES public.data_siswa(id) ON DELETE CASCADE;

-- 2. Pastikan foreign key pada soal_ujian memiliki ON DELETE CASCADE
ALTER TABLE IF EXISTS public.soal_ujian
  DROP CONSTRAINT IF EXISTS soal_ujian_ujian_id_fkey;

ALTER TABLE IF EXISTS public.soal_ujian
  ADD CONSTRAINT soal_ujian_ujian_id_fkey
    FOREIGN KEY (ujian_id) REFERENCES public.ujian(id) ON DELETE CASCADE;

-- 3. Pastikan foreign key kunci_pg dan jawaban_acuan_essay
ALTER TABLE IF EXISTS public.kunci_pg
  DROP CONSTRAINT IF EXISTS kunci_pg_soal_id_fkey;

ALTER TABLE IF EXISTS public.kunci_pg
  ADD CONSTRAINT kunci_pg_soal_id_fkey
    FOREIGN KEY (soal_id) REFERENCES public.soal_ujian(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.jawaban_acuan_essay
  DROP CONSTRAINT IF EXISTS jawaban_acuan_essay_soal_id_fkey;

ALTER TABLE IF EXISTS public.jawaban_acuan_essay
  ADD CONSTRAINT jawaban_acuan_essay_soal_id_fkey
    FOREIGN KEY (soal_id) REFERENCES public.soal_ujian(id) ON DELETE CASCADE;

-- 4. Bersihkan dan perbarui relasi pada jawaban_siswa agar ON DELETE CASCADE
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_name = 'jawaban_siswa' AND constraint_type = 'FOREIGN KEY'
  ) LOOP
    EXECUTE 'ALTER TABLE public.jawaban_siswa DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
  END LOOP;
END;
$$;

-- Tambahkan kembali foreign keys jawaban_siswa dengan ON DELETE CASCADE
ALTER TABLE IF EXISTS public.jawaban_siswa
  ADD CONSTRAINT jawaban_siswa_percobaan_id_fkey
    FOREIGN KEY (percobaan_id) REFERENCES public.percobaan_ujian(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.jawaban_siswa
  ADD CONSTRAINT jawaban_siswa_soal_id_fkey
    FOREIGN KEY (soal_id) REFERENCES public.soal_ujian(id) ON DELETE CASCADE;

ALTER TABLE IF EXISTS public.jawaban_siswa
  ADD CONSTRAINT jawaban_siswa_ujian_id_fkey
    FOREIGN KEY (ujian_id) REFERENCES public.ujian(id) ON DELETE CASCADE;
