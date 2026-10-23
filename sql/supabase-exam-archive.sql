-- Migration: Add archive support to ujian table
-- Run this in Supabase SQL Editor

ALTER TABLE public.ujian 
ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

-- Index for faster filtering
CREATE INDEX IF NOT EXISTS idx_ujian_is_archived ON public.ujian (is_archived);

COMMENT ON COLUMN public.ujian.is_archived IS 'Jika true, ujian disembunyikan dari daftar utama (diarsipkan)';
