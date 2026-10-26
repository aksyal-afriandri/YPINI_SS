-- ==============================================================================
-- MIGRATION: FUNGSI PROFIL SISWA & HAK AKSES FOTO PROFIL UNTUK TOPBAR SISWA
-- ==============================================================================
-- PANDUAN PENGGUNAAN:
-- 1. Buka dashboard Supabase project Anda di browser.
-- 2. Masuk ke menu "SQL Editor" di sidebar kiri.
-- 3. Buat "New query", tempelkan skrip ini, lalu klik tombol "Run".
-- ==============================================================================

-- 1. Buat / perbarui fungsi get_student_profile untuk mengambil profil & photo_path berdasarkan NIS
CREATE OR REPLACE FUNCTION public.get_student_profile(p_nis text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student record;
BEGIN
  SELECT id, nama, nis, photo_path
  INTO v_student
  FROM public.data_siswa
  WHERE nis = btrim(p_nis)
  LIMIT 1;

  IF v_student.id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Data siswa dengan NIS tersebut tidak ditemukan.'
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_student.id,
    'nama', v_student.nama,
    'nis', v_student.nis,
    'photo_path', v_student.photo_path
  );
END;
$$;

-- Berikan izin akses eksekusi fungsi get_student_profile kepada anon dan authenticated
REVOKE ALL ON FUNCTION public.get_student_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_profile(text) TO anon, authenticated;

-- 2. Pastikan storage bucket student-photos bersifat publik agar foto profil siswa dapat ditampilkan di browser
UPDATE storage.buckets
SET public = true
WHERE id = 'student-photos';

-- 3. Berikan izin baca (SELECT) file foto di bucket student-photos kepada siswa (anon & authenticated)
DROP POLICY IF EXISTS "student_photos_public_read" ON storage.objects;
CREATE POLICY "student_photos_public_read" ON storage.objects
  FOR SELECT TO anon, authenticated
  USING (bucket_id = 'student-photos');
