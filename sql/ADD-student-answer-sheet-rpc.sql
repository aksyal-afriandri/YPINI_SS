-- ==============================================================================
-- RPC: LEMBAR JAWABAN SISWA (UNTUK CETAK PDF DI HALAMAN NILAI SISWA)
-- ==============================================================================
-- Jalankan di Supabase > SQL Editor.
--
-- Fungsi ini mengembalikan soal, jawaban siswa, kunci PG, dan acuan jawaban
-- singkat/essay untuk SATU ujian milik siswa (berdasarkan NIS).
--
-- KEAMANAN: data HANYA dikembalikan jika percobaan terakhir siswa pada ujian
-- tersebut berstatus 'dinilai' (sudah difinalisasi guru). Jika belum final,
-- fungsi menolak (success = false), sehingga kunci jawaban tidak bocor ke
-- siswa yang nilainya belum difinalisasi, walaupun tombol cetak dimanipulasi
-- dari browser.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.get_student_answer_sheet(p_nis text, p_ujian_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_siswa_id bigint;
  v_siswa_nama text;
  v_nama_kelas text := '';
  v_attempt public.percobaan_ujian%ROWTYPE;
  v_ujian_nama text;
  v_mapel text;
  v_soal jsonb;
  v_kunci jsonb;
  v_acuan jsonb;
  v_jawaban jsonb;
BEGIN
  -- 1. Verifikasi siswa berdasarkan NIS
  SELECT id, nama INTO v_siswa_id, v_siswa_nama
  FROM public.data_siswa
  WHERE nis = btrim(p_nis)
  LIMIT 1;

  IF v_siswa_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Data siswa tidak ditemukan.');
  END IF;

  -- 2. Percobaan terakhir siswa pada ujian ini
  SELECT * INTO v_attempt
  FROM public.percobaan_ujian
  WHERE ujian_id = p_ujian_id AND siswa_id = v_siswa_id
  ORDER BY id DESC
  LIMIT 1;

  IF v_attempt.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Anda belum mengerjakan ujian ini.');
  END IF;

  -- 3. Wajib sudah difinalisasi
  IF v_attempt.status IS DISTINCT FROM 'dinilai' THEN
    RETURN jsonb_build_object(
      'success', false,
      'message', 'Lembar jawaban baru dapat dicetak setelah nilai difinalisasi oleh guru.'
    );
  END IF;

  -- 4. Info ujian & mapel
  SELECT u.nama_ujian, COALESCE(dp.nama_pelajaran, '-')
  INTO v_ujian_nama, v_mapel
  FROM public.ujian u
  LEFT JOIN public.data_pelajaran dp ON dp.id = u.pelajaran_id
  WHERE u.id = p_ujian_id;

  -- 5. Kelas aktif siswa (sama dengan logika get_student_exam_history)
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

  -- 6. Soal ujian
  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.nomor_urut), '[]'::jsonb)
  INTO v_soal
  FROM public.soal_ujian s
  WHERE s.ujian_id = p_ujian_id;

  -- 7. Kunci PG
  SELECT COALESCE(jsonb_agg(jsonb_build_object('soal_id', k.soal_id, 'jawaban_benar', k.jawaban_benar)), '[]'::jsonb)
  INTO v_kunci
  FROM public.kunci_pg k
  JOIN public.soal_ujian s ON s.id = k.soal_id
  WHERE s.ujian_id = p_ujian_id;

  -- 8. Acuan jawaban singkat / essay
  SELECT COALESCE(jsonb_agg(jsonb_build_object('soal_id', a.soal_id, 'jawaban', a.jawaban)), '[]'::jsonb)
  INTO v_acuan
  FROM public.jawaban_acuan_essay a
  JOIN public.soal_ujian s ON s.id = a.soal_id
  WHERE s.ujian_id = p_ujian_id;

  -- 9. Jawaban siswa (hanya kolom yang diperlukan; catatan AI/guru tidak ikut)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'soal_id', j.soal_id,
    'jawaban_pg', j.jawaban_pg,
    'jawaban_essay', j.jawaban_essay,
    'essay_benar', j.essay_benar
  )), '[]'::jsonb)
  INTO v_jawaban
  FROM public.jawaban_siswa j
  WHERE j.percobaan_id = v_attempt.id;

  RETURN jsonb_build_object(
    'success', true,
    'attempt', jsonb_build_object(
      'id', v_attempt.id,
      'ujian_id', p_ujian_id,
      'studentName', v_siswa_nama,
      'studentNis', btrim(p_nis),
      'className', COALESCE(v_nama_kelas, ''),
      'examName', v_ujian_nama,
      'subjectName', v_mapel,
      'mulai_at', v_attempt.mulai_at,
      'dikumpulkan_at', v_attempt.dikumpulkan_at,
      'nilai_total', v_attempt.nilai_total
    ),
    'soal', v_soal,
    'kunci_pg', v_kunci,
    'acuan', v_acuan,
    'jawaban', v_jawaban
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_student_answer_sheet(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_answer_sheet(text, bigint) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
