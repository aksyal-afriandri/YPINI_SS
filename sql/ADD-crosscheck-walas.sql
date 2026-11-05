-- ==============================================================================
-- CROSSCHECK PENILAIAN: Guru Mapel periksa -> Wali Kelas konfirmasi & finalisasi
-- Jalankan di SQL Editor Supabase (aman dijalankan berulang).
--
-- Alur status (status tetap 3 nilai lama: berlangsung / dikumpulkan / dinilai):
--   dikumpulkan + diperiksa_guru_at KOSONG  = Perlu Dinilai (belum diperiksa guru)
--   dikumpulkan + diperiksa_guru_at TERISI  = Menunggu Konfirmasi Walas
--   dinilai (+ dikonfirmasi_oleh/at)        = Final, dikonfirmasi Walas/Admin
-- ==============================================================================

ALTER TABLE IF EXISTS public.percobaan_ujian
  ADD COLUMN IF NOT EXISTS diperiksa_guru_oleh uuid REFERENCES public.profiles (user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS diperiksa_guru_at   timestamptz,
  ADD COLUMN IF NOT EXISTS dikonfirmasi_oleh   uuid REFERENCES public.profiles (user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS dikonfirmasi_at     timestamptz;

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------------------
-- Akses baca untuk guru: agar halaman bisa mengenali Wali Kelas & penempatan kelas siswa.
-- (Di skrip dasar, tabel ini hanya bisa dibaca admin. Policy ini hanya SELECT.)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS wali_kelas_guru_read ON public.wali_kelas;
CREATE POLICY wali_kelas_guru_read ON public.wali_kelas
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_guru()));

DROP POLICY IF EXISTS siswa_kelas_tahun_ajaran_guru_read ON public.siswa_kelas_tahun_ajaran;
CREATE POLICY siswa_kelas_tahun_ajaran_guru_read ON public.siswa_kelas_tahun_ajaran
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_guru()));

NOTIFY pgrst, 'reload schema';