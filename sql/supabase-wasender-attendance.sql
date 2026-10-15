-- ==============================================================================
-- MIGRASI DATABASE UNTUK NOTIFIKASI WHATSAPP ABSENSI (WASENDER)
-- ==============================================================================
-- Jalankan query ini di Supabase SQL Editor:
-- https://supabase.com/dashboard/project/_/sql

-- 1. Tambahkan kolom no_wa pada tabel data_siswa jika belum ada
alter table public.data_siswa 
add column if not exists no_wa text;

-- 2. Tambahkan kolom status notifikasi WA pada tabel absensi
alter table public.absensi 
add column if not exists wa_status text default 'pending';

alter table public.absensi 
add column if not exists wa_sent_at timestamptz;

-- 3. Beri izin hak akses tabel absensi dan data_siswa untuk service_role & authenticated
grant select, update on public.absensi to authenticated;
grant select, update on public.data_siswa to authenticated;

-- ==============================================================================
-- PETUNJUK SETUP SUPABASE DATABASE WEBHOOK (OPSI B):
-- ==============================================================================
-- 1. Deploy Edge Function:
--    Buka terminal dan jalankan:
--    npx supabase functions deploy wasender-send --no-verify-jwt
--
-- 2. Set Secrets di Supabase Dashboard:
--    Pergi ke: Project Settings -> Edge Functions -> Secrets
--    Tambahkan Secret baru:
--    - WASENDER_API_KEY = (API Key Anda dari Wasender)
--    - WASENDER_API_URL = https://www.wasenderapi.com/api/send-message (atau endpoint WASender Anda)
--
-- 3. Buat Database Webhook (Opsional, agar otomatis dari Database):
--    Pergi ke: Database -> Webhooks -> "Create a new webhook"
--    - Name: send_attendance_wa
--    - Table: public.absensi
--    - Events: Centang [INSERT]
--    - Type of Webhook: Supabase Edge Functions
--    - Edge Function: wasender-send
--    - HTTP Method: POST
--    - Klik "Create webhook"
-- ==============================================================================
