-- Migration: Tambah Kolom Foto pada Soal Ujian & Storage Bucket 'exam-photos'
-- Jalankan skrip ini di SQL Editor Supabase

-- 1. Tambahkan kolom gambar_url dan gambar_urls pada tabel soal_ujian
ALTER TABLE public.soal_ujian
ADD COLUMN IF NOT EXISTS gambar_url text,
ADD COLUMN IF NOT EXISTS gambar_urls text[];

-- 2. Buat storage bucket exam-photos jika belum ada
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'exam-photos',
  'exam-photos',
  true,
  10485760, -- 10 MB per gambar
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 10485760,
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];

-- 3. Kebijakan akses storage bucket exam-photos
-- Publik / anonim (siswa) dapat membaca/melihat gambar soal
DROP POLICY IF EXISTS "exam_photos_public_read" ON storage.objects;
CREATE POLICY "exam_photos_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'exam-photos');

-- Pengguna terautentikasi (admin/guru) dapat mengunggah gambar soal
DROP POLICY IF EXISTS "exam_photos_auth_insert" ON storage.objects;
CREATE POLICY "exam_photos_auth_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'exam-photos');

DROP POLICY IF EXISTS "exam_photos_auth_update" ON storage.objects;
CREATE POLICY "exam_photos_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'exam-photos')
  WITH CHECK (bucket_id = 'exam-photos');

DROP POLICY IF EXISTS "exam_photos_auth_delete" ON storage.objects;
CREATE POLICY "exam_photos_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'exam-photos');

-- 4. Reload skema PostgREST agar kolom gambar terbaca oleh API
NOTIFY pgrst, 'reload schema';
