# Panduan Integrasi GitHub Pages dan Supabase

Frontend statis berada di folder ini. Saat berjalan, aplikasi memakai Supabase Auth, Postgres, dan Storage secara langsung; Laravel tidak dibutuhkan oleh frontend ini.

## Prinsip Aman

**Jangan hapus atau kosongkan database Laravel/MySQL sekarang.** Migrasi ini tidak memerlukannya. Biarkan database lama tetap utuh sebagai sumber data dan jalur pemulihan sampai Supabase lulus pengujian dan aplikasi baru dipakai dengan stabil.

- Jangan menjalankan `DROP DATABASE`, `DROP TABLE`, atau `TRUNCATE` pada database lama.
- Buat project Supabase baru untuk pengujian. Jangan gunakan project yang berisi data penting tanpa backup dan persetujuan pemiliknya.
- Sebelum cutover, database lama adalah sumber data utama. Hindari perubahan data di dua sistem secara bersamaan.
- `supabase-config.js` hanya boleh berisi Project URL dan publishable/anon key. Jangan pernah memasukkan `service_role` key atau secret ke frontend/GitHub.

## 1. Backup Database Lama

1. Buka phpMyAdmin, pilih database SchoolSys yang dipakai Laravel, lalu pilih **Export > Custom > SQL > Export**. Simpan file backup di luar folder publik website.
2. Pastikan file backup tidak kosong dan simpan satu salinan di lokasi aman lain.
3. Jika foto siswa dipakai, backup juga folder `storage/app/public/siswa` dari Laravel.
4. Jangan menghapus database, file foto, maupun akun Laravel. Pastikan backup bisa ditemukan sebelum lanjut.

## 2. Buat dan Siapkan Project Supabase

1. Buat project baru di Supabase dan simpan password database project di password manager. Password itu tidak digunakan oleh frontend.
2. Buka **SQL Editor > New query**, salin seluruh isi `supabase-schema.sql`, lalu pilih **Run**.
3. Di **Authentication > Users**, buat user admin dengan email dan password yang kuat.
4. Di SQL Editor, jalankan query berikut dan ganti alamat email dengan email admin tadi:

   ```sql
   update public.profiles
   set role = 'admin'
   where user_id = (
     select id from auth.users where email = 'admin@example.com'
   );
   ```

   Trigger dari schema membuat profile baru dengan role `siswa`; query di atas menaikkan hanya akun yang dipilih menjadi admin. Jangan memberi role admin ke akun publik.

5. Nonaktifkan pendaftaran publik di **Authentication > Settings/Sign In**, kecuali aplikasi memang akan dikembangkan untuk pendaftaran pengguna.
6. Buka **Project Settings > API**. Salin Project URL dan publishable/anon key ke `supabase-config.js`:

   ```js
   window.SUPABASE_CONFIG = {
     url: "https://YOUR_PROJECT.supabase.co",
     anonKey: "YOUR_PUBLISHABLE_OR_ANON_KEY",
   };
   ```

   Publishable/anon key memang dapat terlihat di browser. RLS pada schema membatasi data hanya untuk admin. Jangan memakai secret/service-role key.

## 3. Pindahkan Data

1. Di phpMyAdmin, ekspor tabel Laravel berikut satu per satu sebagai CSV: `data_siswa`, `data_guru`, `data_kelas`, `tahun_ajaran`, `data_pelajaran`, `semester`, `wali_kelas`, dan `siswa_kelas`.
2. Impor CSV ke tabel dengan nama sama di Supabase **Table Editor**. Pertahankan nilai `id` dan foreign key. Import urutan ini agar relasi tersedia:
   `data_guru`, `data_kelas`, `tahun_ajaran`, `data_siswa`, `data_pelajaran`, `semester`, lalu `wali_kelas` dan `siswa_kelas`.
3. Periksa jumlah baris pada tiap tabel di sumber dan tujuan. Cek juga beberapa nilai NISN/NIP dan foreign key secara manual. Pastikan spreadsheet tidak menghapus angka nol di depan NISN/NIP.
4. Setelah mengimpor ID secara eksplisit, jalankan query berikut **satu kali** di SQL Editor agar ID baru tidak bentrok:

   ```sql
   do $$
   declare
     table_name text;
   begin
     foreach table_name in array array[
       'data_siswa', 'data_guru', 'data_kelas', 'tahun_ajaran',
       'data_pelajaran', 'semester', 'wali_kelas', 'siswa_kelas'
     ] loop
       execute format(
         'select setval(pg_get_serial_sequence(%L, %L), coalesce(max(id), 1), max(id) is not null) from public.%I',
         'public.' || table_name, 'id', table_name
       );
     end loop;
   end $$;
   ```

5. Foto lama tidak otomatis berpindah. Upload file dari `storage/app/public/siswa` ke bucket privat `student-photos`, kemudian isi `data_siswa.photo_path` dengan path object baru di Storage. Kolom Laravel `photo` bukan path object Supabase.
6. Akun/password Laravel tidak dapat dipakai otomatis sebagai akun Supabase Auth. Buat akun Auth baru dan berikan role melalui `profiles`.

## 4. Deploy ke GitHub Pages

1. Folder `YPN_Test` adalah repository frontend tersendiri. Pastikan file perubahan berada di repository tersebut.
2. Push perubahan ke branch `main` atau `master`. Workflow `.github/workflows/deploy-pages.yml` akan menerbitkan isi repository ke Pages. Workflow mengecualikan `.env.production`, `.git`, dan `.htaccess`.
3. Di GitHub repository frontend, buka **Settings > Pages > Build and deployment**, lalu pilih **GitHub Actions** sebagai source.
4. Tunggu workflow berhasil di tab **Actions**. Buka URL Pages yang tercantum pada hasil deploy.

## 5. Uji Sebelum Cutover

Gunakan akun admin baru dan lakukan tes berikut di URL GitHub Pages:

1. Login berhasil dengan email; password salah atau akun non-admin tidak boleh masuk.
2. Pastikan data yang ditampilkan cocok dengan data hasil impor.
3. Buat satu record uji, edit, lalu hapus record uji tersebut.
4. Coba akses halaman admin dalam jendela privat tanpa login; halaman harus kembali ke login dan data tidak boleh terbaca.
5. Jika memakai foto, upload foto uji, buka preview, ganti foto, lalu hapus record uji.
6. Jika memakai Excel, uji file kecil dengan header di baris kedua seperti yang diharapkan import Laravel, lalu cocokkan jumlah imported dan skipped.

Baru setelah tes berhasil dan pengguna menyetujui perpindahan, arahkan pemakaian harian ke GitHub Pages + Supabase. Pada masa transisi, buat database Laravel read-only atau jangan gunakan kedua aplikasi untuk mengedit data bersamaan.

## Jika Ada Kesalahan atau Ingin Kembali

- Sebelum cutover, cukup hentikan pengujian frontend. Database Laravel tidak berubah oleh schema Supabase atau workflow GitHub Pages.
- Jika konfigurasi Supabase salah, kosongkan sementara URL/key di `supabase-config.js` atau perbaiki nilainya; jangan hapus project/database untuk mengatasi error konfigurasi.
- Jika deploy frontend bermasalah, perbaiki atau revert commit pada repository frontend dan nonaktifkan Pages bila diperlukan. Ini tidak menghapus database Supabase maupun MySQL.
- Jika sudah ada perubahan data setelah cutover, jangan langsung kembali memakai Laravel sebagai aplikasi tulis. Data baru di Supabase perlu diekspor dan diselaraskan lebih dulu agar perubahan tidak hilang.
- Penghapusan project Supabase hanya boleh dipertimbangkan untuk project uji yang dipastikan kosong, setelah memeriksa Project URL dan backup. Tidak ada langkah penghapusan seperti itu dalam prosedur integrasi ini.

Schema mencakup tabel siswa, guru, kelas, pelajaran, tahun ajaran, semester, wali kelas, dan relasi siswa-kelas. UI saat ini menyediakan CRUD untuk siswa, guru, kelas, pelajaran, dan tahun ajaran; tabel relasi lain sudah disiapkan untuk halaman lanjutan.