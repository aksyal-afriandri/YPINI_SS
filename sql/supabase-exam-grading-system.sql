-- ==============================================================================
-- SISTEM PENILAIAN & FINALISASI JAWABAN SISWA (ADMIN & GURU)
-- Jalankan skrip ini di SQL Editor Supabase untuk memastikan hak akses & performa
-- ==============================================================================

-- 1. Pastikan kolom-kolom penilaian ada di tabel percobaan_ujian & jawaban_siswa
ALTER TABLE IF EXISTS public.percobaan_ujian 
  ADD COLUMN IF NOT EXISTS nilai_pilihan_ganda numeric(8, 2) CHECK (nilai_pilihan_ganda >= 0),
  ADD COLUMN IF NOT EXISTS nilai_essay_final numeric(8, 2) CHECK (nilai_essay_final >= 0),
  ADD COLUMN IF NOT EXISTS nilai_total numeric(8, 2) CHECK (nilai_total >= 0);

ALTER TABLE IF EXISTS public.jawaban_siswa
  ADD COLUMN IF NOT EXISTS nilai_final numeric(8, 2) CHECK (nilai_final >= 0),
  ADD COLUMN IF NOT EXISTS catatan_guru text,
  ADD COLUMN IF NOT EXISTS ditinjau_oleh uuid REFERENCES public.profiles (user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ditinjau_at timestamptz;

-- 2. Index untuk mempercepat query penilaian per ujian & siswa
CREATE INDEX IF NOT EXISTS idx_percobaan_ujian_ujian_status ON public.percobaan_ujian (ujian_id, status);
CREATE INDEX IF NOT EXISTS idx_percobaan_ujian_siswa ON public.percobaan_ujian (siswa_id);
CREATE INDEX IF NOT EXISTS idx_jawaban_siswa_percobaan ON public.jawaban_siswa (percobaan_id);
CREATE INDEX IF NOT EXISTS idx_jawaban_siswa_soal ON public.jawaban_siswa (soal_id);

-- 3. Hak akses RLS untuk Admin & Guru (authenticated)
-- Pastikan authenticated role (admin dan guru) dapat membaca dan mengupdate percobaan & jawaban
DROP POLICY IF EXISTS percobaan_ujian_admin_manage ON public.percobaan_ujian;
CREATE POLICY percobaan_ujian_admin_manage ON public.percobaan_ujian
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS jawaban_siswa_admin_manage ON public.jawaban_siswa;
CREATE POLICY jawaban_siswa_admin_manage ON public.jawaban_siswa
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- Pastikan kunci PG dan acuan essay dapat dibaca oleh Admin & Guru untuk koreksi
DROP POLICY IF EXISTS kunci_pg_admin_manage ON public.kunci_pg;
CREATE POLICY kunci_pg_admin_manage ON public.kunci_pg
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS jawaban_acuan_essay_admin_manage ON public.jawaban_acuan_essay;
CREATE POLICY jawaban_acuan_essay_admin_manage ON public.jawaban_acuan_essay
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
