-- ==============================================================================
-- SISTEM RIWAYAT & NILAI UJIAN SISWA (BERBASIS NIS)
-- Jalankan skrip ini di SQL Editor Supabase untuk mengaktifkan fitur riwayat ujian siswa
-- ==============================================================================

-- 1. Beri izin SELECT pada tabel ujian, data_pelajaran, dan percobaan_ujian (jika belum)
GRANT SELECT ON public.ujian TO anon, authenticated;
GRANT SELECT ON public.data_pelajaran TO anon, authenticated;
GRANT SELECT ON public.percobaan_ujian TO anon, authenticated;

-- Perluas policy SELECT ujian untuk anon agar siswa dapat melihat daftar ujian yang pernah ada
DROP POLICY IF EXISTS ujian_student_read_all ON public.ujian;
CREATE POLICY ujian_student_read_all
ON public.ujian FOR SELECT TO anon
USING (aktif = true);

-- 2. Fungsi Stored Procedure (RPC) untuk mengambil seluruh riwayat ujian siswa dengan aman
CREATE OR REPLACE FUNCTION public.get_student_exam_history(p_nis text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_siswa_id bigint;
  v_siswa_nama text;
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

  -- 2. Query seluruh ujian aktif atau yang sudah pernah dikerjakan oleh siswa
  SELECT jsonb_build_object(
    'success', true,
    'siswa', jsonb_build_object(
      'id', v_siswa_id,
      'nama', v_siswa_nama,
      'nis', p_nis
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
  WHERE u.aktif = true OR pu.id IS NOT NULL;

  RETURN v_result;
END;
$$;

-- 3. Beri hak akses eksekusi RPC ke anon dan authenticated
REVOKE ALL ON FUNCTION public.get_student_exam_history(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_exam_history(text) TO anon, authenticated;

-- 4. Reload schema cache PostgREST Supabase
NOTIFY pgrst, 'reload schema';
