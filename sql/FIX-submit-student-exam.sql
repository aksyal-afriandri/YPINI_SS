-- =============================================================================
-- FIX: jawaban siswa tidak masuk database (submit_student_exam)
-- Jalankan di Supabase > SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- LANGKAH 0 (DIAGNOSA, hanya membaca) - jalankan satu per satu & lihat hasilnya
-- -----------------------------------------------------------------------------
-- A. Versi fungsi yang SEDANG aktif. Kalau di dalamnya ada "jawaban_pilihan" atau
--    "ragu_ragu", berarti yang terpasang versi MIGRATION-MASTER (salah skema).
--
--   select pg_get_functiondef('public.submit_student_exam(text,bigint,jsonb)'::regprocedure);
--
-- B. Kolom tabel jawaban_siswa yang benar-benar ada di database Anda:
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'jawaban_siswa'
--   order by ordinal_position;
--
-- C. Siswa yang statusnya masih 'berlangsung' padahal sudah merasa selesai
--    (jml_jawaban = 0 berarti jawabannya tidak pernah tersimpan):
--
--   select p.id, s.nis, p.ujian_id, p.status, p.mulai_at,
--          (select count(*) from public.jawaban_siswa j where j.percobaan_id = p.id) as jml_jawaban
--   from public.percobaan_ujian p
--   join public.data_siswa s on s.id = p.siswa_id
--   order by p.mulai_at desc;

-- -----------------------------------------------------------------------------
-- LANGKAH 1: pasang ulang fungsi yang cocok dengan skema supabase-complete-exam-system.sql
-- (kolom jawaban_pg + ujian_id). CREATE OR REPLACE menimpa versi lama/salah.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_student_exam(
  p_nis text,
  p_ujian_id bigint,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_siswa_id bigint;
  v_percobaan_id bigint;
  v_status text;
  v_item jsonb;
  v_soal_id bigint;
  v_answer text;
  v_letter text;
  v_is_essay boolean;
  v_kunci char(1);
  v_correct_count integer := 0;
  v_total_pg integer := 0;
  v_total_essay integer := 0;
  v_nilai_pg numeric(8, 2) := 0;
  v_order integer := 1;
BEGIN
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Format jawaban tidak valid.');
  END IF;

  SELECT id INTO v_siswa_id
  FROM public.data_siswa
  WHERE nis = btrim(p_nis)
  LIMIT 1;

  IF v_siswa_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Siswa dengan NIS tersebut tidak ditemukan.');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.ujian WHERE id = p_ujian_id) THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ujian tidak ditemukan.');
  END IF;

  SELECT count(*) INTO v_total_pg
  FROM public.soal_ujian WHERE ujian_id = p_ujian_id AND soal_type = 'pg';

  SELECT count(*) INTO v_total_essay
  FROM public.soal_ujian WHERE ujian_id = p_ujian_id AND soal_type = 'essay';

  SELECT id, status INTO v_percobaan_id, v_status
  FROM public.percobaan_ujian
  WHERE ujian_id = p_ujian_id AND siswa_id = v_siswa_id
  ORDER BY id DESC
  LIMIT 1;

  -- Jangan menimpa jawaban/nilai yang sudah dinilai guru
  IF v_status = 'dinilai' THEN
    RETURN jsonb_build_object('success', true, 'message', 'Ujian ini sudah dinilai.', 'percobaan_id', v_percobaan_id);
  END IF;

  IF v_percobaan_id IS NULL THEN
    INSERT INTO public.percobaan_ujian (ujian_id, siswa_id, status, mulai_at, dikumpulkan_at)
    VALUES (p_ujian_id, v_siswa_id, 'dikumpulkan', now(), now())
    RETURNING id INTO v_percobaan_id;
  ELSE
    UPDATE public.percobaan_ujian
    SET status = 'dikumpulkan', dikumpulkan_at = now(), updated_at = now()
    WHERE id = v_percobaan_id;
  END IF;

  DELETE FROM public.jawaban_siswa WHERE percobaan_id = v_percobaan_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    v_soal_id := (v_item->>'soal_id')::bigint;
    v_answer  := btrim(coalesce(v_item->>'answer', ''));

    SELECT (soal_type = 'essay') INTO v_is_essay
    FROM public.soal_ujian
    WHERE id = v_soal_id AND ujian_id = p_ujian_id;

    IF v_is_essay IS NULL THEN
      CONTINUE; -- soal bukan milik ujian ini -> abaikan
    END IF;

    IF v_is_essay = false THEN
      -- Pilihan ganda: hanya huruf A-D yang valid (menghindari pelanggaran CHECK constraint)
      v_letter := upper(left(v_answer, 1));
      IF v_letter NOT IN ('A', 'B', 'C', 'D') THEN
        v_letter := NULL;
      END IF;

      SELECT jawaban_benar INTO v_kunci FROM public.kunci_pg WHERE soal_id = v_soal_id;
      IF v_kunci IS NOT NULL AND v_letter = v_kunci THEN
        v_correct_count := v_correct_count + 1;
      END IF;

      INSERT INTO public.jawaban_siswa (
        percobaan_id, ujian_id, soal_id, urutan_soal, jawaban_pg, jawaban_essay
      ) VALUES (
        v_percobaan_id, p_ujian_id, v_soal_id, v_order, v_letter, NULL
      )
      ON CONFLICT (percobaan_id, soal_id) DO UPDATE
      SET jawaban_pg = EXCLUDED.jawaban_pg, jawaban_essay = NULL, updated_at = now();
    ELSE
      INSERT INTO public.jawaban_siswa (
        percobaan_id, ujian_id, soal_id, urutan_soal, jawaban_pg, jawaban_essay
      ) VALUES (
        v_percobaan_id, p_ujian_id, v_soal_id, v_order, NULL, NULLIF(v_answer, '')
      )
      ON CONFLICT (percobaan_id, soal_id) DO UPDATE
      SET jawaban_essay = EXCLUDED.jawaban_essay, jawaban_pg = NULL, updated_at = now();
    END IF;

    v_order := v_order + 1;
  END LOOP;

  IF v_total_pg > 0 THEN
    v_nilai_pg := round((v_correct_count::numeric / v_total_pg::numeric) * 100, 2);
    UPDATE public.percobaan_ujian
    SET nilai_pilihan_ganda = v_nilai_pg,
        nilai_total = CASE WHEN v_total_essay = 0 THEN v_nilai_pg ELSE nilai_total END,
        updated_at = now()
    WHERE id = v_percobaan_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Jawaban ujian berhasil dikumpulkan.',
    'percobaan_id', v_percobaan_id,
    'total_soal', (v_total_pg + v_total_essay),
    'total_pg', v_total_pg,
    'pg_benar', v_correct_count,
    'nilai_pg', v_nilai_pg
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_student_exam(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_exam(text, bigint, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

-- -----------------------------------------------------------------------------
-- LANGKAH 2: jangan jalankan lagi MIGRATION-MASTER-UJIAN-LENGKAP.sql (BAGIAN 3 di dalamnya
-- akan menimpa fungsi ini dengan versi yang salah). Hapus atau perbaiki bagian itu.
-- -----------------------------------------------------------------------------
