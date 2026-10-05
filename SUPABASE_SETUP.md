# Supabase and GitHub Pages setup

The static frontend is in this folder. It uses Supabase Auth, Postgres, and a private Storage bucket directly; Laravel is not required at runtime.

## Configure Supabase

1. Create a Supabase project and open **SQL Editor**.
2. Run the complete contents of `supabase-schema.sql`.
3. In **Authentication > Users**, create the first administrator with an email and password. Public sign-ups should be disabled unless the application is extended to support them.
4. Promote that account in SQL Editor, replacing the email below:

   ```sql
   update public.profiles
   set role = 'admin'
   where user_id = (
     select id from auth.users where email = 'admin@example.com'
   );
   ```

5. In **Project Settings > API**, copy the Project URL and publishable/anon key into `supabase-config.js`:

   ```js
   window.SUPABASE_CONFIG = {
     url: "https://YOUR_PROJECT.supabase.co",
     anonKey: "YOUR_PUBLISHABLE_OR_ANON_KEY",
   };
   ```

   The publishable/anon key is intended for a browser. Never put a `service_role` or secret key in this file. RLS is the access control boundary.

## Publish on GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` publishes this folder on pushes to `main` or `master`. In the repository, set **Settings > Pages > Build and deployment > Source** to **GitHub Actions**. After the workflow succeeds, use the Pages URL shown in the Actions run.

For a project site hosted below `https://OWNER.github.io/REPOSITORY/`, the existing relative links keep the pages within that path.

## Data migration notes

The schema covers the current Laravel tables for students, teachers, classes, subjects, school years, semesters, class guardians, and student-class assignments. Export the existing MySQL tables to CSV and import them into matching Supabase tables, preserving IDs and foreign-key values. Import referenced parent tables before `wali_kelas` and `siswa_kelas`. After importing explicit IDs, reset the identity sequences once:

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

Student photos are stored in a private bucket. Do not import the old Laravel `photo` filename as a usable path; upload those files to `student-photos` and set each `data_siswa.photo_path` to the new object path. Existing Laravel accounts cannot be copied as Supabase Auth accounts; create new Auth users and assign roles through `profiles`.

The frontend currently exposes CRUD for students, teachers, classes, subjects, and school years. The remaining relationship tables are preserved in the schema for future screens.