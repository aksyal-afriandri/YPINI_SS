-- ==============================================================================
-- UPDATE BOBOT NILAI OTOMATIS PG & MANUAL ESSAY / JAWABAN SINGKAT
-- ==============================================================================
-- PANDUAN PENGGUNAAN:
-- 1. Buka dashboard Supabase project Anda di browser.
-- 2. Masuk ke menu "SQL Editor" di sidebar kiri.
-- 3. Tempel (paste) seluruh skrip ini, lalu klik "Run".
-- ==============================================================================

-- 1. Pastikan kolom bobot_nilai dan kolom nilai ujian tersedia
ALTER TABLE IF EXISTS public.soal_ujian
  ADD COLUMN IF NOT EXISTS bobot_nilai numeric(8, 2) DEFAULT NULL CHECK (bobot_nilai IS NULL OR bobot_nilai >= 0);

ALTER TABLE IF EXISTS public.jawaban_siswa
  ADD COLUMN IF NOT EXISTS essay_benar boolean,
  ADD COLUMN IF NOT EXISTS nilai_final numeric(8, 2) CHECK (nilai_final >= 0),
  ADD COLUMN IF NOT EXISTS catatan_guru text,
  ADD COLUMN IF NOT EXISTS ditinjau_oleh uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ditinjau_at timestamptz;

ALTER TABLE IF EXISTS public.percobaan_ujian
  ADD COLUMN IF NOT EXISTS nilai_pilihan_ganda numeric(8, 2) CHECK (nilai_pilihan_ganda >= 0),
  ADD COLUMN IF NOT EXISTS nilai_essay_final numeric(8, 2) CHECK (nilai_essay_final >= 0),
  ADD COLUMN IF NOT EXISTS nilai_total numeric(8, 2) CHECK (nilai_total >= 0);

-- 2. Stored Procedure submit_student_exam:
-- - Soal PG dengan bobot kosong dihitung otomatis berdasarkan jumlah soal (100 / total_soal).
--   Semisal 10 soal = 10 poin per soal; 20 soal = 5 poin per soal; dst.
-- - Jawaban essay & jawaban singkat disimpan untuk pemeriksaan/koreksi manual oleh guru.
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
  v_soal_type text;
  v_kunci char(1);
  v_correct_count integer := 0;
  v_total_soal integer := 0;
  v_total_pg integer := 0;
  v_total_singkat integer := 0;
  v_total_essay integer := 0;
  v_has_custom_points boolean := false;
  v_auto_weight numeric(8, 4) := 0;
  v_weight numeric(8, 4) := 0;
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

  -- Hitung total butir soal
  SELECT count(*) INTO v_total_soal
  FROM public.soal_ujian WHERE ujian_id = p_ujian_id;

  SELECT count(*) INTO v_total_pg
  FROM public.soal_ujian WHERE ujian_id = p_ujian_id AND soal_type = 'pg';

  SELECT count(*) INTO v_total_singkat
  FROM public.soal_ujian WHERE ujian_id = p_ujian_id AND soal_type = 'jawaban_singkat';

  SELECT count(*) INTO v_total_essay
  FROM public.soal_ujian WHERE ujian_id = p_ujian_id AND soal_type = 'essay';

  -- Cek apakah ada bobot manual pada butir soal
  SELECT bool_or(bobot_nilai IS NOT NULL AND bobot_nilai > 0) INTO v_has_custom_points
  FROM public.soal_ujian WHERE ujian_id = p_ujian_id;

  v_has_custom_points := coalesce(v_has_custom_points, false);

  -- Hitung bobot otomatis jika kosong (100 / total_soal)
  IF v_total_soal > 0 THEN
    v_auto_weight := 100.0 / v_total_soal::numeric;
  ELSE
    v_auto_weight := 0;
  END IF;

  SELECT id, status INTO v_percobaan_id, v_status
  FROM public.percobaan_ujian
  WHERE ujian_id = p_ujian_id AND siswa_id = v_siswa_id
  ORDER BY id DESC
  LIMIT 1;

  -- Jangan menimpa nilai yang sudah difinalisasi oleh guru
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

    SELECT soal_type, coalesce(bobot_nilai, 0)
    INTO v_soal_type, v_weight
    FROM public.soal_ujian
    WHERE id = v_soal_id AND ujian_id = p_ujian_id;

    IF v_soal_type IS NULL THEN
      CONTINUE; -- bukan milik ujian ini
    END IF;

    -- Jika bobot kosong / belum diatur manual, gunakan bobot otomatis berdasarkan jumlah soal
    IF v_weight IS NULL OR v_weight <= 0 THEN
      v_weight := v_auto_weight;
    END IF;

    IF v_soal_type = 'pg' THEN
      v_letter := upper(left(v_answer, 1));
      IF v_letter NOT IN ('A', 'B', 'C', 'D') THEN
        v_letter := NULL;
      END IF;

      SELECT jawaban_benar INTO v_kunci FROM public.kunci_pg WHERE soal_id = v_soal_id;
      IF v_kunci IS NOT NULL AND v_letter = v_kunci THEN
        v_correct_count := v_correct_count + 1;
        v_nilai_pg := v_nilai_pg + v_weight;

        INSERT INTO public.jawaban_siswa (
          percobaan_id, ujian_id, soal_id, urutan_soal, jawaban_pg, jawaban_essay, nilai_final
        ) VALUES (
          v_percobaan_id, p_ujian_id, v_soal_id, v_order, v_letter, NULL, round(v_weight, 2)
        )
        ON CONFLICT (percobaan_id, soal_id) DO UPDATE
        SET jawaban_pg = EXCLUDED.jawaban_pg, jawaban_essay = NULL, nilai_final = EXCLUDED.nilai_final, updated_at = now();
      ELSE
        INSERT INTO public.jawaban_siswa (
          percobaan_id, ujian_id, soal_id, urutan_soal, jawaban_pg, jawaban_essay, nilai_final
        ) VALUES (
          v_percobaan_id, p_ujian_id, v_soal_id, v_order, v_letter, NULL, 0
        )
        ON CONFLICT (percobaan_id, soal_id) DO UPDATE
        SET jawaban_pg = EXCLUDED.jawaban_pg, jawaban_essay = NULL, nilai_final = 0, updated_at = now();
      END IF;

    ELSE
      -- Soal Essay & Jawaban Singkat: disimpan untuk pemeriksaan manual oleh guru
      INSERT INTO public.jawaban_siswa (
        percobaan_id, ujian_id, soal_id, urutan_soal, jawaban_pg, jawaban_essay, nilai_final
      ) VALUES (
        v_percobaan_id, p_ujian_id, v_soal_id, v_order, NULL, NULLIF(v_answer, ''), NULL
      )
      ON CONFLICT (percobaan_id, soal_id) DO UPDATE
      SET jawaban_essay = EXCLUDED.jawaban_essay, jawaban_pg = NULL, updated_at = now();
    END IF;

    v_order := v_order + 1;
  END LOOP;

  -- Batasi nilai PG maks 100 dan bulatkan 2 desimal
  v_nilai_pg := least(100.0, round(v_nilai_pg, 2));

  -- Simpan nilai PG awal dan set nilai_total awal ke nilai PG
  UPDATE public.percobaan_ujian
  SET nilai_pilihan_ganda = v_nilai_pg,
      nilai_total = v_nilai_pg,
      updated_at = now()
  WHERE id = v_percobaan_id;

  RETURN jsonb_build_object(
    'success', true,
    'message', 'Jawaban ujian berhasil dikumpulkan.',
    'percobaan_id', v_percobaan_id,
    'total_soal', v_total_soal,
    'total_pg', v_total_pg,
    'pg_benar', v_correct_count,
    'total_singkat', v_total_singkat,
    'total_essay', v_total_essay,
    'nilai_pg', v_nilai_pg,
    'nilai_total_awal', v_nilai_pg
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_student_exam(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_exam(text, bigint, jsonb) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
