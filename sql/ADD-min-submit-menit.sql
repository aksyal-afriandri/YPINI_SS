-- ==============================================================================
-- MIGRATION: WAKTU MINIMAL SEBELUM SISWA BOLEH MENGUMPULKAN UJIAN (PER UJIAN)
-- ==============================================================================
-- Jalankan di Supabase > SQL Editor.
-- Nilai 0 = siswa boleh langsung mengumpulkan begitu semua soal terjawab.
-- Ujian lama otomatis mendapat nilai default 20 menit (bisa diubah dari form Edit Ujian).
-- ==============================================================================

ALTER TABLE IF EXISTS public.ujian
  ADD COLUMN IF NOT EXISTS min_submit_menit integer NOT NULL DEFAULT 20
  CHECK (min_submit_menit >= 0);

NOTIFY pgrst, 'reload schema';
