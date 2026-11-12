-- Run this once in your Supabase Dashboard -> SQL Editor -> New Query.
-- Creates the reservation & guest-list tables used by Afro Kravings Christmas Buffet.

CREATE TABLE IF NOT EXISTS public.buffet_reservations (
  id SERIAL PRIMARY KEY,
  ticket_id VARCHAR(40) NOT NULL UNIQUE,
  attendee_name VARCHAR(160) NOT NULL,
  attendee_email VARCHAR(320) NOT NULL UNIQUE,
  amount_pence INTEGER NOT NULL DEFAULT 2500,
  payment_reference VARCHAR(160),
  payment_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  confirmation_status VARCHAR(20) NOT NULL DEFAULT 'not_sent',
  email_message_id VARCHAR(160),
  email_error TEXT,
  approved_at TIMESTAMPTZ,
  email_sent_at TIMESTAMPTZ,
  checked_in_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS buffet_reservations_status_idx
  ON public.buffet_reservations (payment_status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.buffet_waitlist (
  id SERIAL PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(320) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keep guest emails & reservation records private from the public anon key.
-- Server endpoints use SUPABASE_SERVICE_ROLE_KEY or direct Postgres DATABASE_URL.
ALTER TABLE public.buffet_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buffet_waitlist ENABLE ROW LEVEL SECURITY;
