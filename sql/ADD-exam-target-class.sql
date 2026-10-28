-- ==============================================================================
-- MIGRATION: SASARAN KELAS & TINGKAT UJIAN CBT
-- ==============================================================================
-- PANDUAN PENGGUNAAN:
-- 1. Buka dashboard Supabase project Anda di browser.
-- 2. Masuk ke menu "SQL Editor" di sidebar kiri.
-- 3. Buat "New Query", tempelkan skrip ini, lalu klik tombol "Run".
-- ==============================================================================

-- 1. Tambahkan kolom target_tingkat dan target_kelas ke tabel ujian
ALTER TABLE IF EXISTS public.ujian 
  ADD COLUMN IF NOT EXISTS target_tingkat text,
  ADD COLUMN IF NOT EXISTS target_kelas text;

COMMENT ON COLUMN public.ujian.target_tingkat IS 'Tingkat kelas target ujian, misal 7, 8, 9, atau NULL/SEMUA untuk seluruh tingkat';
COMMENT ON COLUMN public.ujian.target_kelas IS 'Daftar nama kelas spesifik target ujian (dipisah koma), misal 7A, 7B, atau NULL/SEMUA';

-- 2. Perbarui RPC get_student_profile agar menyertakan data kelas aktif siswa
CREATE OR REPLACE FUNCTION public.get_student_profile(p_nis text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_student record;
  v_class record;
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

  -- Cari penempatan kelas aktif siswa
  SELECT
    kt.id AS kelas_tahun_ajaran_id,
    kt.kelas_id,
    kt.jenjang,
    kt.nama_kelas
  INTO v_class
  FROM public.siswa_kelas_tahun_ajaran sk
  JOIN public.kelas_tahun_ajaran kt ON kt.id = sk.kelas_tahun_ajaran_id
  LEFT JOIN public.pengaturan_tahun_ajaran pta ON pta.id = 1
  WHERE sk.siswa_id = v_student.id
    AND (pta.tahun_ajaran_id IS NULL OR sk.tahun_ajaran_id = pta.tahun_ajaran_id)
  ORDER BY sk.tanggal_mulai DESC, sk.id DESC
  LIMIT 1;

  -- Fallback jika belum diatur di kelas_tahun_ajaran
  IF v_class.nama_kelas IS NULL THEN
    SELECT
      k.id AS kelas_id,
      k.nama_kelas,
      NULL::bigint AS kelas_tahun_ajaran_id,
      NULL::text AS jenjang
    INTO v_class
    FROM public.siswa_kelas sk
    JOIN public.data_kelas k ON k.id = sk.kelas_id
    WHERE sk.siswa_id = v_student.id
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'id', v_student.id,
    'nama', v_student.nama,
    'nis', v_student.nis,
    'photo_path', v_student.photo_path,
    'kelas_id', v_class.kelas_id,
    'kelas_tahun_ajaran_id', v_class.kelas_tahun_ajaran_id,
    'nama_kelas', COALESCE(v_class.nama_kelas, ''),
    'jenjang', COALESCE(v_class.jenjang, '')
  );
END;
$$;

-- Berikan izin eksekusi kepada anon dan authenticated
REVOKE ALL ON FUNCTION public.get_student_profile(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_profile(text) TO anon, authenticated;

-- 3. Perbarui RPC get_student_exam_history agar memfilter riwayat ujian sesuai kelas siswa
CREATE OR REPLACE FUNCTION public.get_student_exam_history(p_nis text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_siswa_id bigint;
  v_siswa_nama text;
  v_nama_kelas text := '';
  v_tingkat text := '';
  v_result jsonb;
BEGIN
  -- 1. Verifikasi Siswa berdasarkan NIS
  SELECT id, nama INTO v_siswa_id, v_siswa_nama
  FROM public.data_siswa
  WHERE nis = btrim(p_nis)
  LIMIT 1;

  IF v_siswa_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Data siswa dengan NIS tersebut tidak ditemukan.'
    );
  END IF;

  -- 2. Ambil kelas aktif siswa
  SELECT kt.nama_kelas INTO v_nama_kelas
  FROM public.siswa_kelas_tahun_ajaran sk
  JOIN public.kelas_tahun_ajaran kt ON kt.id = sk.kelas_tahun_ajaran_id
  LEFT JOIN public.pengaturan_tahun_ajaran pta ON pta.id = 1
  WHERE sk.siswa_id = v_siswa_id
    AND (pta.tahun_ajaran_id IS NULL OR sk.tahun_ajaran_id = pta.tahun_ajaran_id)
  ORDER BY sk.tanggal_mulai DESC, sk.id DESC
  LIMIT 1;

  IF v_nama_kelas IS NULL OR v_nama_kelas = '' THEN
    SELECT k.nama_kelas INTO v_nama_kelas
    FROM public.siswa_kelas sk
    JOIN public.data_kelas k ON k.id = sk.kelas_id
    WHERE sk.siswa_id = v_siswa_id
    LIMIT 1;
  END IF;

  v_nama_kelas := COALESCE(v_nama_kelas, '');
  -- Ekstrak tingkat: teks bahasa Indonesia (tujuh, delapan, dst), angka romawi (VII, VIII, dst), atau digit angka
  IF v_nama_kelas ~* '\y(tujuh)\y' THEN
    v_tingkat := '7';
  ELSIF v_nama_kelas ~* '\y(delapan)\y' THEN
    v_tingkat := '8';
  ELSIF v_nama_kelas ~* '\y(sembilan)\y' THEN
    v_tingkat := '9';
  ELSIF v_nama_kelas ~* '\y(sepuluh)\y' THEN
    v_tingkat := '10';
  ELSIF v_nama_kelas ~* '\y(sebelas)\y' THEN
    v_tingkat := '11';
  ELSIF v_nama_kelas ~* '\y(dua\s*belas)\y' THEN
    v_tingkat := '12';
  ELSIF v_nama_kelas ~* '\y(enam)\y' THEN
    v_tingkat := '6';
  ELSIF v_nama_kelas ~* '\y(lima)\y' THEN
    v_tingkat := '5';
  ELSIF v_nama_kelas ~* '\y(empat)\y' THEN
    v_tingkat := '4';
  ELSIF v_nama_kelas ~* '\y(tiga)\y' THEN
    v_tingkat := '3';
  ELSIF v_nama_kelas ~* '\y(dua)\y' THEN
    v_tingkat := '2';
  ELSIF v_nama_kelas ~* '\y(satu)\y' THEN
    v_tingkat := '1';
  ELSIF v_nama_kelas ~* '\yVIII\y' THEN
    v_tingkat := '8';
  ELSIF v_nama_kelas ~* '\yVII\y' THEN
    v_tingkat := '7';
  ELSIF v_nama_kelas ~* '\yXII\y' THEN
    v_tingkat := '12';
  ELSIF v_nama_kelas ~* '\yXI\y' THEN
    v_tingkat := '11';
  ELSIF v_nama_kelas ~* '\yIX\y' THEN
    v_tingkat := '9';
  ELSIF v_nama_kelas ~* '\yX\y' THEN
    v_tingkat := '10';
  ELSIF v_nama_kelas ~* '\yVI\y' THEN
    v_tingkat := '6';
  ELSIF v_nama_kelas ~* '\yIV\y' THEN
    v_tingkat := '4';
  ELSIF v_nama_kelas ~* '\yV\y' THEN
    v_tingkat := '5';
  ELSIF v_nama_kelas ~* '\yIII\y' THEN
    v_tingkat := '3';
  ELSIF v_nama_kelas ~* '\yII\y' THEN
    v_tingkat := '2';
  ELSIF v_nama_kelas ~* '\yI\y' THEN
    v_tingkat := '1';
  ELSE
    v_tingkat := COALESCE(substring(v_nama_kelas from '([0-9]+)'), '');
  END IF;

  -- 3. Query seluruh ujian aktif yang sesuai dengan kelas siswa atau yang sudah pernah dikerjakan
  SELECT jsonb_build_object(
    'success', true,
    'siswa', jsonb_build_object(
      'id', v_siswa_id,
      'nama', v_siswa_nama,
      'nis', p_nis,
      'nama_kelas', v_nama_kelas
    ),
    'exams', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', u.id,
          'nama_ujian', u.nama_ujian,
          'nama_pelajaran', coalesce(dp.nama_pelajaran, '-'),
          'waktu_menit', u.waktu_menit,
          'dibuka_at', u.dibuka_at,
          'ditutup_at', u.ditutup_at,
          'aktif', u.aktif,
          'target_tingkat', u.target_tingkat,
          'target_kelas', u.target_kelas,
          -- Status waktu
          'is_open', (u.aktif = true AND now() >= u.dibuka_at AND now() <= u.ditutup_at),
          'is_ended', (now() > u.ditutup_at),
          'is_upcoming', (now() < u.dibuka_at),
          -- Status percobaan pengerjaan siswa
          'has_attempted', (pu.id IS NOT NULL),
          'attempt_id', pu.id,
          'attempt_status', pu.status, -- 'berlangsung', 'dikumpulkan', 'dinilai', null
          'mulai_at', pu.mulai_at,
          'dikumpulkan_at', pu.dikumpulkan_at,
          -- Nilai akhir HANYA dimunculkan jika status sudah 'dinilai' (difinalisasi guru)
          'is_finalized', (pu.status = 'dinilai'),
          'nilai_akhir', CASE WHEN pu.status = 'dinilai' THEN pu.nilai_total ELSE NULL END
        )
        ORDER BY 
          -- Prioritas: Ujian yang sedang terbuka dan belum selesai diletakkan paling atas
          CASE 
            WHEN (u.aktif = true AND now() >= u.dibuka_at AND now() <= u.ditutup_at) 
                 AND (pu.status IS NULL OR pu.status = 'berlangsung') THEN 0
            WHEN (u.aktif = true AND now() < u.dibuka_at) THEN 1
            ELSE 2
          END ASC,
          u.dibuka_at DESC
      ),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM public.ujian u
  LEFT JOIN public.data_pelajaran dp ON dp.id = u.pelajaran_id
  LEFT JOIN LATERAL (
    SELECT id, status, mulai_at, dikumpulkan_at, nilai_total
    FROM public.percobaan_ujian
    WHERE ujian_id = u.id AND siswa_id = v_siswa_id
    ORDER BY id DESC
    LIMIT 1
  ) pu ON true
  WHERE (pu.id IS NOT NULL)
     OR (
       u.aktif = true
       AND (
         (u.target_tingkat IS NULL OR u.target_tingkat = '' OR u.target_tingkat = 'SEMUA' OR (v_tingkat <> '' AND u.target_tingkat = v_tingkat))
         AND
         (u.target_kelas IS NULL OR u.target_kelas = '' OR u.target_kelas = 'SEMUA' OR (v_nama_kelas <> '' AND v_nama_kelas = ANY(string_to_array(u.target_kelas, ','))))
       )
     );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_exam_history(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_exam_history(text) TO anon, authenticated;

-- 4. Reload cache PostgREST Supabase
NOTIFY pgrst, 'reload schema';

