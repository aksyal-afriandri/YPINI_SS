-- Migration: Perbaiki Foreign Key Constraint saat Menghapus Data Siswa (ON DELETE CASCADE)
-- Jalankan skrip ini di SQL Editor Supabase untuk mengatasi error:
-- "update or delete on table data_siswa violates foreign key constraint siswa_kelas_tahun_ajaran_siswa_id_fkey"

-- 1. Perbaiki Foreign Key pada tabel siswa_kelas_tahun_ajaran agar ikut terhapus otomatis (CASCADE) saat data siswa dihapus
ALTER TABLE public.siswa_kelas_tahun_ajaran
DROP CONSTRAINT IF EXISTS siswa_kelas_tahun_ajaran_siswa_id_fkey;

ALTER TABLE public.siswa_kelas_tahun_ajaran
ADD CONSTRAINT siswa_kelas_tahun_ajaran_siswa_id_fkey
FOREIGN KEY (siswa_id)
REFERENCES public.data_siswa (id)
ON DELETE CASCADE;

-- 2. Perbaiki Foreign Key pada kolom siswa_kelas_tahun_ajaran_id di tabel absensi agar ikut terhapus/cascade
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'absensi'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'siswa_kelas_tahun_ajaran_id'
    ) LOOP
        EXECUTE 'ALTER TABLE public.absensi DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.absensi
ADD CONSTRAINT absensi_siswa_kelas_tahun_ajaran_id_fkey
FOREIGN KEY (siswa_kelas_tahun_ajaran_id)
REFERENCES public.siswa_kelas_tahun_ajaran (id)
ON DELETE CASCADE;

-- 3. Perbaiki Foreign Key pada tabel percobaan_ujian agar riwayat ujian siswa ikut cascade saat siswa dihapus
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (
        SELECT tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
         AND tc.table_schema = kcu.table_schema
        WHERE tc.table_schema = 'public'
          AND tc.table_name = 'percobaan_ujian'
          AND tc.constraint_type = 'FOREIGN KEY'
          AND kcu.column_name = 'siswa_id'
    ) LOOP
        EXECUTE 'ALTER TABLE public.percobaan_ujian DROP CONSTRAINT IF EXISTS ' || quote_ident(r.constraint_name);
    END LOOP;
END $$;

ALTER TABLE public.percobaan_ujian
ADD CONSTRAINT percobaan_ujian_siswa_id_fkey
FOREIGN KEY (siswa_id)
REFERENCES public.data_siswa (id)
ON DELETE CASCADE;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
