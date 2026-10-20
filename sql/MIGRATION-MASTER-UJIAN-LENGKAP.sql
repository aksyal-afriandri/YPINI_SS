-- ==============================================================================
-- MASTER SETUP & MIGRATION: SISTEM UJIAN, PENILAIAN, & RIWAYAT SISWA (CBT YPN)
-- ==============================================================================
-- PANDUAN PENGGUNAAN:
-- 1. Buka dashboard Supabase project Anda di browser.
-- 2. Pilih menu "SQL Editor" di sidebar kiri.
-- 3. Buat "New Query", paste seluruh isi skrip SQL ini, lalu klik tombol "Run".
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- BAGIAN 1: KOLOM PENILAIAN PADA TABEL PERCOBAAN & JAWABAN SISWA
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.percobaan_ujian 
  ADD COLUMN IF NOT EXISTS nilai_pilihan_ganda numeric(8, 2) CHECK (nilai_pilihan_ganda >= 0),
  ADD COLUMN IF NOT EXISTS nilai_essay_final numeric(8, 2) CHECK (nilai_essay_final >= 0),
  ADD COLUMN IF NOT EXISTS nilai_total numeric(8, 2) CHECK (nilai_total >= 0);

ALTER TABLE IF EXISTS public.jawaban_siswa
  ADD COLUMN IF NOT EXISTS nilai_final numeric(8, 2) CHECK (nilai_final >= 0),
  ADD COLUMN IF NOT EXISTS catatan_guru text,
  ADD COLUMN IF NOT EXISTS ditinjau_oleh uuid REFERENCES public.profiles (user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ditinjau_at timestamptz;

-- Index untuk mempercepat query
CREATE INDEX IF NOT EXISTS idx_percobaan_ujian_ujian_status ON public.percobaan_ujian (ujian_id, status);
CREATE INDEX IF NOT EXISTS idx_percobaan_ujian_siswa ON public.percobaan_ujian (siswa_id);
CREATE INDEX IF NOT EXISTS idx_jawaban_siswa_percobaan ON public.jawaban_siswa (percobaan_id);
CREATE INDEX IF NOT EXISTS idx_jawaban_siswa_soal ON public.jawaban_siswa (soal_id);

-- ------------------------------------------------------------------------------
-- BAGIAN 2: IZIN & ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------
-- Berikan izin dasar pada tabel
GRANT SELECT ON public.ujian TO anon, authenticated;
GRANT SELECT ON public.data_pelajaran TO anon, authenticated;
GRANT SELECT ON public.percobaan_ujian TO anon, authenticated;

-- Policy agar siswa (anon) dapat melihat ujian yang aktif
DROP POLICY IF EXISTS ujian_student_read_all ON public.ujian;
CREATE POLICY ujian_student_read_all
  ON public.ujian FOR SELECT TO anon
  USING (aktif = true);

-- Policy untuk Admin & Guru (authenticated) agar bisa melihat dan menilai jawaban
DROP POLICY IF EXISTS percobaan_ujian_admin_manage ON public.percobaan_ujian;
CREATE POLICY percobaan_ujian_admin_manage ON public.percobaan_ujian
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS jawaban_siswa_admin_manage ON public.jawaban_siswa;
CREATE POLICY jawaban_siswa_admin_manage ON public.jawaban_siswa
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS kunci_pg_admin_manage ON public.kunci_pg;
CREATE POLICY kunci_pg_admin_manage ON public.kunci_pg
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS jawaban_acuan_essay_admin_manage ON public.jawaban_acuan_essay;
CREATE POLICY jawaban_acuan_essay_admin_manage ON public.jawaban_acuan_essay
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- BAGIAN 3: STORED PROCEDURE SUBMIT JAWABAN SISWA (submit_student_exam)
-- ------------------------------------------------------------------------------
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
          percobaan_id,
          soal_id,
          urutan_soal,
          jawaban_pilihan,
          jawaban_essay,
          ragu_ragu,
          updated_at
        )
        VALUES (
          v_percobaan_id,
          v_soal_id,
          v_order,
          NULLIF(upper(v_answer), ''),
          NULL,
          coalesce((v_item->>'is_doubt')::boolean, false),
          now()
        );
      ELSE
        -- Soal Essay
        INSERT INTO public.jawaban_siswa (
          percobaan_id,
          soal_id,
          urutan_soal,
          jawaban_pilihan,
          jawaban_essay,
          ragu_ragu,
          updated_at
        )
        VALUES (
          v_percobaan_id,
          v_soal_id,
          v_order,
          NULL,
          NULLIF(v_answer, ''),
          coalesce((v_item->>'is_doubt')::boolean, false),
          now()
        );
      END IF;

      v_order := v_order + 1;
    END IF;
  END LOOP;

  -- 6. Hitung estimasi nilai PG (0 - 100)
  IF v_total_pg > 0 THEN
    v_nilai_pg := round((v_correct_count::numeric / v_total_pg::numeric) * 100, 2);
  ELSE
    v_nilai_pg := 0;
  END IF;

  -- Update percobaan nilai PG
  UPDATE public.percobaan_ujian
  SET nilai_pilihan_ganda = v_nilai_pg,
      updated_at = now()
  WHERE id = v_percobaan_id;

  RETURN jsonb_build_object(
    'success', true,
    'percobaan_id', v_percobaan_id,
    'correct_pg', v_correct_count,
    'total_pg', v_total_pg,
    'total_essay', v_total_essay,
    'nilai_pg', v_nilai_pg,
    'message', 'Jawaban berhasil dikumpulkan.'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- BAGIAN 4: STORED PROCEDURE RIWAYAT & NILAI UJIAN SISWA (get_student_exam_history)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- BAGIAN 5: STORED PROCEDURE MULAI UJIAN (start_student_exam)
-- Dipanggil saat siswa mulai membuka lembar ujian untuk mencatat status 'berlangsung'
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_student_exam(
  p_nis text,
  p_ujian_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_siswa_id bigint;
  v_percobaan record;
BEGIN
  -- 1. Verifikasi Siswa berdasarkan NIS
  SELECT id INTO v_siswa_id
  FROM public.data_siswa
  WHERE nis = btrim(p_nis)
  LIMIT 1;

  IF v_siswa_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'Siswa tidak ditemukan.');
  END IF;

  -- 2. Cek apakah sudah pernah ada percobaan
  SELECT id, status, mulai_at, dikumpulkan_at
  INTO v_percobaan
  FROM public.percobaan_ujian
  WHERE ujian_id = p_ujian_id AND siswa_id = v_siswa_id
  ORDER BY id DESC
  LIMIT 1;

  IF v_percobaan IS NULL THEN
    -- Belum pernah mulai -> Buat record baru dengan status 'berlangsung'
    INSERT INTO public.percobaan_ujian (ujian_id, siswa_id, status, mulai_at)
    VALUES (p_ujian_id, v_siswa_id, 'berlangsung', now())
    RETURNING id, status, mulai_at, dikumpulkan_at INTO v_percobaan;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'percobaan_id', v_percobaan.id,
    'status', v_percobaan.status,
    'mulai_at', v_percobaan.mulai_at,
    'dikumpulkan_at', v_percobaan.dikumpulkan_at
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- BAGIAN 6: HAK AKSES EKSEKUSI PROSEDUR KE ANON & AUTHENTICATED
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.submit_student_exam(text, bigint, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_student_exam(text, bigint, jsonb) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.get_student_exam_history(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_student_exam_history(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.start_student_exam(text, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_student_exam(text, bigint) TO anon, authenticated;

-- ------------------------------------------------------------------------------
-- BAGIAN 7: RELOAD POSTGREST SCHEMA CACHE SUPABASE
-- ------------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
