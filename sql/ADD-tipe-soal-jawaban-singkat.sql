-- ==============================================================================
-- MIGRASI: TIPE SOAL 'jawaban_singkat' (SERUPA ESSAY)
-- ==============================================================================
-- 1. Mengubah tipe kolom `soal_type` pada tabel `public.soal_ujian` menjadi `text`
--    agar fleksibel mendukung: 'pg', 'jawaban_singkat', dan 'essay'
--    (Seluruh data lama 'pg' dan 'essay' tetap aman terjaga 100%).
-- 2. Memperbarui CHECK constraint sehingga menerima 'pg', 'essay', dan 'jawaban_singkat'.
-- 3. Memperbarui fungsi RPC `submit_student_exam`:
--    - Nilai awal siswa saat submit dihitung dari soal PG yang benar.
--    - Jawaban singkat dan essay disimpan ke lembar jawaban untuk diperiksa/diceklis
--      oleh guru di menu Nilai Ujian, persis seperti essay.
-- ==============================================================================

-- 1. Hapus check constraint lama pada soal_ujian yang mengatur pilihan/soal_type
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT conname 
    FROM pg_constraint 
    WHERE conrelid = 'public.soal_ujian'::regclass 
      AND contype = 'c' 
      AND (
        pg_get_constraintdef(oid) ILIKE '%pilihan_a%' 
        OR pg_get_constraintdef(oid) ILIKE '%pilihan_b%'
        OR pg_get_constraintdef(oid) ILIKE '%soal_type%'
      )
  ) LOOP
    EXECUTE 'ALTER TABLE public.soal_ujian DROP CONSTRAINT IF EXISTS ' || quote_ident(r.conname);
  END LOOP;
END;
$$;

-- 2. Ubah kolom soal_type menjadi TEXT agar tidak terikat batasan transaksi ENUM
ALTER TABLE public.soal_ujian 
  ALTER COLUMN soal_type TYPE text USING soal_type::text;

-- 3. Tambahkan CHECK constraint baru pada tabel soal_ujian
ALTER TABLE public.soal_ujian 
  ADD CONSTRAINT soal_ujian_type_options_check 
  CHECK (
    (soal_type = 'pg' AND pilihan_a IS NOT NULL AND pilihan_b IS NOT NULL
      AND pilihan_c IS NOT NULL AND pilihan_d IS NOT NULL)
    OR
    (soal_type IN ('essay', 'jawaban_singkat') AND pilihan_a IS NULL AND pilihan_b IS NULL
      AND pilihan_c IS NULL AND pilihan_d IS NULL)
  );

-- 4. Perbarui fungsi submit_student_exam
CREATE OR REPLACE FUNCTION public.submit_student_exam(
  p_nis text,
  p_ujian_id bigint,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

    SELECT soal_type, coalesce(bobot_nilai, 0)
    INTO v_soal_type, v_weight
    FROM public.soal_ujian
    WHERE id = v_soal_id AND ujian_id = p_ujian_id;

    IF v_soal_type IS NULL THEN
      CONTINUE; -- bukan milik ujian ini
    END IF;

    -- Jika bobot kosong semua, gunakan bobot otomatis merata (100 / total_soal)
    IF NOT v_has_custom_points THEN
      IF v_total_soal > 0 THEN
        v_weight := 100.0 / v_total_soal::numeric;
      ELSE
        v_weight := 0;
      END IF;
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
      -- Soal Essay & Jawaban Singkat: disimpan untuk pemeriksaan/ceklis oleh guru
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

  v_nilai_pg := least(100.0, round(v_nilai_pg, 2));

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
    'nilai_total_awal', v_nilai_pg,
    'has_custom_points', v_has_custom_points
  );
END;
$$;
