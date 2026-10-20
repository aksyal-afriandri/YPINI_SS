-- Migration: Stored Procedure & Permissions untuk Submit Jawaban Ujian Siswa (CBT)
-- Jalankan skrip ini di SQL Editor Supabase

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
  v_ujian record;
  v_percobaan_id bigint;
  v_item jsonb;
  v_soal_id bigint;
  v_answer text;
  v_is_essay boolean;
  v_kunci char(1);
  v_correct_count integer := 0;
  v_total_pg integer := 0;
  v_total_essay integer := 0;
  v_nilai_pg numeric(8, 2) := 0;
  v_order integer := 1;
BEGIN
  -- 1. Verifikasi NIS Siswa
  SELECT id INTO v_siswa_id
  FROM public.data_siswa
  WHERE nis = btrim(p_nis)
  LIMIT 1;

  IF v_siswa_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Siswa dengan NIS tersebut tidak ditemukan.');
  END IF;

  -- 2. Verifikasi Ujian Aktif
  SELECT id, nama_ujian, aktif, dibuka_at, ditutup_at
  INTO v_ujian
  FROM public.ujian
  WHERE id = p_ujian_id
  LIMIT 1;

  IF v_ujian IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Ujian tidak ditemukan.');
  END IF;

  -- 3. Hitung jumlah total PG & Essay
  SELECT count(*) INTO v_total_pg
  FROM public.soal_ujian
  WHERE ujian_id = p_ujian_id AND soal_type = 'pg';

  SELECT count(*) INTO v_total_essay
  FROM public.soal_ujian
  WHERE ujian_id = p_ujian_id AND soal_type = 'essay';

  -- 4. Cari atau buat record percobaan_ujian
  SELECT id INTO v_percobaan_id
  FROM public.percobaan_ujian
  WHERE ujian_id = p_ujian_id AND siswa_id = v_siswa_id
  ORDER BY id DESC
  LIMIT 1;

  IF v_percobaan_id IS NULL THEN
    INSERT INTO public.percobaan_ujian (ujian_id, siswa_id, status, mulai_at, dikumpulkan_at)
    VALUES (p_ujian_id, v_siswa_id, 'dikumpulkan', now(), now())
    RETURNING id INTO v_percobaan_id;
  ELSE
    UPDATE public.percobaan_ujian
    SET status = 'dikumpulkan',
        dikumpulkan_at = now(),
        updated_at = now()
    WHERE id = v_percobaan_id;
  END IF;

  -- Bersihkan jawaban sebelumnya untuk percobaan ini agar tidak terjadi konflik unik urutan
  DELETE FROM public.jawaban_siswa WHERE percobaan_id = v_percobaan_id;

  -- 5. Simpan masing-masing jawaban siswa
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    v_soal_id := (v_item->>'soal_id')::bigint;
    v_answer := btrim(coalesce(v_item->>'answer', ''));

    SELECT (soal_type = 'essay') INTO v_is_essay
    FROM public.soal_ujian
    WHERE id = v_soal_id AND ujian_id = p_ujian_id;

    IF v_is_essay IS NOT NULL THEN
      IF v_is_essay = false THEN
        -- Pilihan Ganda: validasi kunci
        SELECT jawaban_benar INTO v_kunci
        FROM public.kunci_pg
        WHERE soal_id = v_soal_id;

        IF v_kunci IS NOT NULL AND upper(v_answer) = v_kunci THEN
          v_correct_count := v_correct_count + 1;
        END IF;

        INSERT INTO public.jawaban_siswa (
          percobaan_id, ujian_id, soal_id, urutan_soal, jawaban_pg, jawaban_essay
        ) VALUES (
          v_percobaan_id, p_ujian_id, v_soal_id, v_order,
          CASE WHEN v_answer <> '' THEN upper(v_answer) ELSE NULL END,
          NULL
        )
        ON CONFLICT (percobaan_id, soal_id) DO UPDATE
        SET jawaban_pg = CASE WHEN v_answer <> '' THEN upper(v_answer) ELSE NULL END,
            jawaban_essay = NULL,
            updated_at = now();
      ELSE
        -- Essay
        INSERT INTO public.jawaban_siswa (
          percobaan_id, ujian_id, soal_id, urutan_soal, jawaban_pg, jawaban_essay
        ) VALUES (
          v_percobaan_id, p_ujian_id, v_soal_id, v_order, NULL,
          CASE WHEN v_answer <> '' THEN v_answer ELSE NULL END
        )
        ON CONFLICT (percobaan_id, soal_id) DO UPDATE
        SET jawaban_essay = CASE WHEN v_answer <> '' THEN v_answer ELSE NULL END,
            jawaban_pg = NULL,
            updated_at = now();
      END IF;

      v_order := v_order + 1;
    END IF;
  END LOOP;

  -- 6. Hitung nilai otomatis pilihan ganda
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
