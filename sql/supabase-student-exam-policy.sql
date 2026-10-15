-- Policy ini memakai role anon karena login siswa saat ini hanya menyimpan NIS
-- di sessionStorage, bukan membuat sesi Supabase Auth.
-- Catatan: ujian aktif dan soalnya dapat dibaca publik melalui anon key.
-- Jalankan setelah supabase-schema.sql dan supabase-exam-schema.sql.

GRANT SELECT ON public.ujian, public.soal_ujian, public.data_pelajaran TO anon;

DROP POLICY IF EXISTS ujian_student_read_active ON public.ujian;
CREATE POLICY ujian_student_read_active
ON public.ujian FOR SELECT TO anon
USING (
  aktif = true
  AND now() >= dibuka_at
  AND now() <= ditutup_at
);

DROP POLICY IF EXISTS soal_ujian_student_read_active ON public.soal_ujian;
CREATE POLICY soal_ujian_student_read_active
ON public.soal_ujian FOR SELECT TO anon
USING (
  EXISTS (
    SELECT 1
    FROM public.ujian u
    WHERE u.id = soal_ujian.ujian_id
      AND u.aktif = true
      AND now() >= u.dibuka_at
      AND now() <= u.ditutup_at
  )
);

DROP POLICY IF EXISTS data_pelajaran_student_read ON public.data_pelajaran;
CREATE POLICY data_pelajaran_student_read
ON public.data_pelajaran FOR SELECT TO anon
USING (true);

-- NIS-only session bukan autentikasi Supabase, sehingga role anon tidak dapat
-- dibatasi per siswa pada level RLS. Jangan gunakan untuk ujian yang perlu dirahasiakan.

-- Pengecekan NIS untuk login siswa tanpa membuka akses baca tabel data_siswa.
CREATE OR REPLACE FUNCTION public.student_nis_exists(p_nis text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.data_siswa
    WHERE nis = btrim(p_nis)
  );
$$;

REVOKE ALL ON FUNCTION public.student_nis_exists(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.student_nis_exists(text) TO anon, authenticated;
