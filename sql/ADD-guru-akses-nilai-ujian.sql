-- ==============================================================================
-- AKSES GURU PADA JAWABAN & NILAI SISWA (percobaan_ujian & jawaban_siswa)
-- Jalankan di SQL Editor Supabase (aman dijalankan berulang).
--
-- Aturan:
--   * Admin        : melihat & mengelola semua data.
--   * Guru mapel   : hanya pengerjaan ujian untuk MAPEL yang diampu (data_guru.pelajaran_ids)
--                    DAN siswa yang berada di KELAS yang diampu (data_guru.kelas_list).
--                    Jika kelas_list kosong => semua kelas untuk mapel tersebut.
--                    Jika ujian punya sasaran kelas/tingkat, sasaran itu harus cocok.
--   * Wali kelas   : tambahan, boleh melihat semua pengerjaan siswa di kelas perwaliannya.
--
-- Tanpa skrip ini, filter di halaman (admin/nilai-ujian) hanya menyembunyikan data
-- di tampilan; data tetap bisa dibaca lewat API karena policy lama memakai USING (true).
-- ==============================================================================

-- 1. Helper: ambil tingkat dari nama kelas ("7A", "VIII B", "Kelas 9C", "Tujuh A")
CREATE OR REPLACE FUNCTION public.extract_tingkat(p_nama text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v text := lower(trim(coalesce(p_nama, '')));
  m text[];
BEGIN
  IF v = '' THEN RETURN ''; END IF;

  IF v ~ '\m(dua\s*belas)\M' THEN RETURN '12'; END IF;
  IF v ~ '\mtujuh\M'    THEN RETURN '7';  END IF;
  IF v ~ '\mdelapan\M'  THEN RETURN '8';  END IF;
  IF v ~ '\msembilan\M' THEN RETURN '9';  END IF;
  IF v ~ '\msepuluh\M'  THEN RETURN '10'; END IF;
  IF v ~ '\msebelas\M'  THEN RETURN '11'; END IF;
  IF v ~ '\menam\M'     THEN RETURN '6';  END IF;
  IF v ~ '\mlima\M'     THEN RETURN '5';  END IF;
  IF v ~ '\mempat\M'    THEN RETURN '4';  END IF;
  IF v ~ '\mtiga\M'     THEN RETURN '3';  END IF;
  IF v ~ '\mdua\M'      THEN RETURN '2';  END IF;
  IF v ~ '\msatu\M'     THEN RETURN '1';  END IF;

  IF v ~ '\mviii\M' THEN RETURN '8';  END IF;
  IF v ~ '\mvii\M'  THEN RETURN '7';  END IF;
  IF v ~ '\mxii\M'  THEN RETURN '12'; END IF;
  IF v ~ '\mxi\M'   THEN RETURN '11'; END IF;
  IF v ~ '\mix\M'   THEN RETURN '9';  END IF;
  IF v ~ '\mx\M'    THEN RETURN '10'; END IF;
  IF v ~ '\mvi\M'   THEN RETURN '6';  END IF;
  IF v ~ '\miv\M'   THEN RETURN '4';  END IF;
  IF v ~ '\mv\M'    THEN RETURN '5';  END IF;
  IF v ~ '\miii\M'  THEN RETURN '3';  END IF;
  IF v ~ '\mii\M'   THEN RETURN '2';  END IF;
  IF v ~ '\mi\M'    THEN RETURN '1';  END IF;

  m := regexp_match(v, '(\d{1,2})');
  IF m IS NOT NULL THEN RETURN (m[1])::int::text; END IF;
  RETURN '';
END;
$$;

-- 2. Helper: apakah user yang login boleh mengakses pengerjaan ujian ini?
CREATE OR REPLACE FUNCTION public.can_access_percobaan(p_percobaan_id bigint)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_guru        public.data_guru%ROWTYPE;
  v_year_id     bigint;
  v_siswa_id    bigint;
  v_ujian       public.ujian%ROWTYPE;
  v_kelas_list  text[];
  v_pelajaran   bigint[];
  v_placement   record;
  v_ok_exam     boolean := false;
  v_t_kelas     text;
  v_t_tingkat   text;
BEGIN
  -- Admin: bebas
  IF public.is_admin() THEN RETURN true; END IF;

  -- Selain guru: tidak boleh
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = (SELECT auth.uid()) AND role = 'guru'
  ) THEN
    RETURN false;
  END IF;

  SELECT g.* INTO v_guru
  FROM public.data_guru g
  WHERE g.user_id = (SELECT auth.uid())
  LIMIT 1;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT p.siswa_id INTO v_siswa_id
  FROM public.percobaan_ujian p
  WHERE p.id = p_percobaan_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT u.* INTO v_ujian
  FROM public.ujian u
  JOIN public.percobaan_ujian p ON p.ujian_id = u.id
  WHERE p.id = p_percobaan_id;
  IF NOT FOUND THEN RETURN false; END IF;

  SELECT tahun_ajaran_id INTO v_year_id
  FROM public.pengaturan_tahun_ajaran WHERE id = 1;

  -- Kelas siswa pada tahun ajaran aktif
  SELECT s.kelas_tahun_ajaran_id, upper(trim(k.nama_kelas)) AS nama_kelas
  INTO v_placement
  FROM public.siswa_kelas_tahun_ajaran s
  JOIN public.kelas_tahun_ajaran k ON k.id = s.kelas_tahun_ajaran_id
  WHERE s.siswa_id = v_siswa_id
    AND (v_year_id IS NULL OR s.tahun_ajaran_id = v_year_id)
  ORDER BY s.tanggal_mulai DESC
  LIMIT 1;

  -- (a) Wali kelas: boleh semua pengerjaan siswa di kelas perwaliannya
  IF v_placement.kelas_tahun_ajaran_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.wali_kelas w
    WHERE w.guru_id = v_guru.id
      AND w.kelas_tahun_ajaran_id = v_placement.kelas_tahun_ajaran_id
      AND (v_year_id IS NULL OR w.tahun_ajaran_id = v_year_id)
  ) THEN
    RETURN true;
  END IF;

  -- (b) Guru mapel: mapel diampu
  v_pelajaran := coalesce(
    nullif(v_guru.pelajaran_ids, '{}'),
    CASE WHEN v_guru.pelajaran_id IS NOT NULL THEN ARRAY[v_guru.pelajaran_id] END
  );
  IF v_pelajaran IS NULL OR NOT (v_ujian.pelajaran_id = ANY (v_pelajaran)) THEN
    RETURN false;
  END IF;

  -- (c) Kelas yang diampu
  SELECT coalesce(array_agg(upper(trim(x))), '{}') INTO v_kelas_list
  FROM unnest(coalesce(v_guru.kelas_list, '{}')) AS x;

  IF cardinality(v_kelas_list) = 0 THEN
    RETURN true; -- kelas_list kosong = semua kelas untuk mapel ini
  END IF;

  -- Sasaran ujian harus beririsan dengan kelas guru
  v_t_kelas   := upper(trim(coalesce(v_ujian.target_kelas, '')));
  v_t_tingkat := upper(trim(coalesce(v_ujian.target_tingkat, '')));

  IF v_t_kelas = '' AND v_t_tingkat = '' THEN
    v_ok_exam := true;
  ELSIF v_t_kelas = 'SEMUA' OR v_t_tingkat = 'SEMUA' THEN
    v_ok_exam := true;
  ELSE
    IF v_t_kelas <> '' AND EXISTS (
      SELECT 1 FROM unnest(string_to_array(v_t_kelas, ',')) AS c
      WHERE upper(trim(c)) = ANY (v_kelas_list)
    ) THEN
      v_ok_exam := true;
    END IF;
    IF NOT v_ok_exam AND v_t_tingkat <> '' AND EXISTS (
      SELECT 1 FROM unnest(v_kelas_list) AS c
      WHERE public.extract_tingkat(c) = v_t_tingkat
    ) THEN
      v_ok_exam := true;
    END IF;
  END IF;
  IF NOT v_ok_exam THEN RETURN false; END IF;

  -- Siswa harus berada di salah satu kelas yang diampu guru
  RETURN v_placement.nama_kelas IS NOT NULL
     AND v_placement.nama_kelas = ANY (v_kelas_list);
END;
$$;

GRANT EXECUTE ON FUNCTION public.extract_tingkat(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_percobaan(bigint) TO authenticated;

-- 3. Ganti policy lama (USING true) dengan policy berbasis peran
DROP POLICY IF EXISTS percobaan_ujian_admin_all    ON public.percobaan_ujian;
DROP POLICY IF EXISTS percobaan_ujian_admin_manage ON public.percobaan_ujian;
DROP POLICY IF EXISTS percobaan_ujian_staff_scope  ON public.percobaan_ujian;
CREATE POLICY percobaan_ujian_staff_scope ON public.percobaan_ujian
  FOR ALL TO authenticated
  USING ((SELECT public.can_access_percobaan(id)))
  WITH CHECK ((SELECT public.can_access_percobaan(id)));

DROP POLICY IF EXISTS jawaban_siswa_admin_all    ON public.jawaban_siswa;
DROP POLICY IF EXISTS jawaban_siswa_admin_manage ON public.jawaban_siswa;
DROP POLICY IF EXISTS jawaban_siswa_staff_scope  ON public.jawaban_siswa;
CREATE POLICY jawaban_siswa_staff_scope ON public.jawaban_siswa
  FOR ALL TO authenticated
  USING ((SELECT public.can_access_percobaan(percobaan_id)))
  WITH CHECK ((SELECT public.can_access_percobaan(percobaan_id)));

CREATE INDEX IF NOT EXISTS idx_siswa_kelas_ta_siswa_year
  ON public.siswa_kelas_tahun_ajaran (siswa_id, tahun_ajaran_id);

NOTIFY pgrst, 'reload schema';

-- ------------------------------------------------------------------------------
-- CATATAN:
--  * Siswa mengerjakan ujian lewat fungsi RPC (SECURITY DEFINER), jadi tidak terpengaruh.
--  * Jika ada halaman lain yang membaca percobaan_ujian langsung (mis. monitoring-ujian),
--    guru hanya akan melihat baris yang lolos aturan di atas.
--  * Walas yang membuka monitoring kelas perwaliannya tetap melihat semua siswa kelasnya.
-- ------------------------------------------------------------------------------
