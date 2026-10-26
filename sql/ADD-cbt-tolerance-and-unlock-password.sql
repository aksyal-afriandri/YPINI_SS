-- ==============================================================================
-- MIGRATION: TOLERANSI WAKTU PER UJIAN & PASSWORD GLOBAL BUKA KUNCI CBT
-- ==============================================================================
-- PANDUAN PENGGUNAAN:
-- 1. Buka dashboard Supabase project Anda di browser.
-- 2. Masuk ke menu "SQL Editor" di sidebar kiri.
-- 3. Buat "New Query", tempelkan skrip ini, lalu klik tombol "Run".
-- ==============================================================================

-- 1. Tambahkan kolom toleransi_menit ke tabel ujian (default 15 menit)
ALTER TABLE IF EXISTS public.ujian 
  ADD COLUMN IF NOT EXISTS toleransi_menit integer NOT NULL DEFAULT 15;

-- 2. Buat tabel pengaturan_cbt untuk menyimpan konfigurasi global CBT
CREATE TABLE IF NOT EXISTS public.pengaturan_cbt (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  password_unlock text NOT NULL DEFAULT 'admin123',
  toleransi_menit_default integer NOT NULL DEFAULT 15,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert nilai default jika tabel baru dibuat
INSERT INTO public.pengaturan_cbt (id, password_unlock, toleransi_menit_default)
VALUES (1, 'admin123', 15)
ON CONFLICT (id) DO NOTHING;

-- 3. Row Level Security & Hak Akses
GRANT SELECT ON public.pengaturan_cbt TO anon, authenticated;
GRANT ALL ON public.pengaturan_cbt TO authenticated;

ALTER TABLE public.pengaturan_cbt ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pengaturan_cbt_read_all ON public.pengaturan_cbt;
CREATE POLICY pengaturan_cbt_read_all ON public.pengaturan_cbt
  FOR SELECT TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS pengaturan_cbt_admin_manage ON public.pengaturan_cbt;
CREATE POLICY pengaturan_cbt_admin_manage ON public.pengaturan_cbt
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);
