import { customAlphabet } from "nanoid";
import { Pool, type PoolConfig } from "pg";

export type PaymentStatus = "pending" | "approved" | "rejected";
export type ConfirmationStatus = "not_sent" | "sent" | "failed";

export interface BuffetReservationRecord {
  id: number;
  ticketId: string;
  attendeeName: string;
  attendeeEmail: string;
  amountPence: number;
  paymentReference: string | null;
  paymentStatus: PaymentStatus;
  confirmationStatus: ConfirmationStatus;
  emailMessageId: string | null;
  emailError: string | null;
  approvedAt: string | null;
  emailSentAt: string | null;
  checkedInAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const makeTicketSuffix = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);

let pool: Pool | null = null;
let poolConnectionString: string | null = null;
let schemaReadyPromise: Promise<void> | null = null;

export function getPostgresConnectionString(): string {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.SUPABASE_DB_URL ||
    ""
  ).trim();
}

export function isPostgresConfigured(): boolean {
  return getPostgresConnectionString().length > 0;
}

function buildPoolConfig(rawUrl: string): PoolConfig {
  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const sslMode = (url.searchParams.get("sslmode") ?? "").toLowerCase();
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";

    if (isLocal || sslMode === "disable") {
      return {
        connectionString: rawUrl,
        ssl: false,
        max: 5,
        idleTimeoutMillis: 10_000,
        connectionTimeoutMillis: 8_000,
      };
    }

    // Strip libpq sslmode query so node-postgres does not override rejectUnauthorized for Supabase/Neon poolers.
    url.searchParams.delete("sslmode");
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    };
  } catch {
    return {
      connectionString: rawUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
    };
  }
}

export function getPgPool(): Pool {
  const connectionString = getPostgresConnectionString();
  if (!connectionString) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }
  if (!pool || poolConnectionString !== connectionString) {
    pool = new Pool(buildPoolConfig(connectionString));
    poolConnectionString = connectionString;
    schemaReadyPromise = null;
  }
  return pool;
}

export async function ensureBookingSchema(): Promise<void> {
  const db = getPgPool();
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await db.query(`
        CREATE TABLE IF NOT EXISTS buffet_reservations (
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
      `);
      await db.query(`
        CREATE INDEX IF NOT EXISTS buffet_reservations_status_idx
        ON buffet_reservations (payment_status, created_at DESC);
      `);
      await db.query(`
        CREATE TABLE IF NOT EXISTS buffet_waitlist (
          id SERIAL PRIMARY KEY,
          name VARCHAR(160) NOT NULL,
          email VARCHAR(320) NOT NULL UNIQUE,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
      `);
    })().catch(error => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}

function mapReservationRow(row: Record<string, unknown>): BuffetReservationRecord {
  const toIso = (value: unknown): string | null => {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return String(value);
  };
  return {
    id: Number(row.id),
    ticketId: String(row.ticket_id),
    attendeeName: String(row.attendee_name),
    attendeeEmail: String(row.attendee_email),
    amountPence: Number(row.amount_pence ?? 2500),
    paymentReference: row.payment_reference ? String(row.payment_reference) : null,
    paymentStatus: String(row.payment_status) as PaymentStatus,
    confirmationStatus: String(row.confirmation_status) as ConfirmationStatus,
    emailMessageId: row.email_message_id ? String(row.email_message_id) : null,
    emailError: row.email_error ? String(row.email_error) : null,
    approvedAt: toIso(row.approved_at),
    emailSentAt: toIso(row.email_sent_at),
    checkedInAt: toIso(row.checked_in_at),
    createdAt: toIso(row.created_at) ?? new Date().toISOString(),
    updatedAt: toIso(row.updated_at) ?? new Date().toISOString(),
  };
}

export async function submitGuestReservation(input: {
  name: string;
  email: string;
  paymentReference?: string;
}): Promise<{ reservation: BuffetReservationRecord; alreadyExists: boolean }> {
  await ensureBookingSchema();
  const db = getPgPool();
  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanNote = input.paymentReference?.trim() || null;

  const existing = await db.query(
    `SELECT * FROM buffet_reservations WHERE attendee_email = $1 LIMIT 1`,
    [cleanEmail],
  );

  if (existing.rows[0]) {
    const current = mapReservationRow(existing.rows[0]);
    if (current.paymentStatus === "approved") {
      return { reservation: current, alreadyExists: true };
    }
    const updated = await db.query(
      `UPDATE buffet_reservations
       SET attendee_name = $1,
           payment_reference = COALESCE($2, payment_reference),
           payment_status = 'pending',
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [cleanName, cleanNote, current.id],
    );
    return { reservation: mapReservationRow(updated.rows[0]), alreadyExists: true };
  }

  const ticketId = `AKXMAS-${new Date().getFullYear()}-${makeTicketSuffix()}`;
  try {
    const inserted = await db.query(
      `INSERT INTO buffet_reservations (
        ticket_id, attendee_name, attendee_email, amount_pence, payment_reference, payment_status, confirmation_status
      ) VALUES ($1, $2, $3, 2500, $4, 'pending', 'not_sent')
      RETURNING *`,
      [ticketId, cleanName, cleanEmail, cleanNote],
    );
    return { reservation: mapReservationRow(inserted.rows[0]), alreadyExists: false };
  } catch (error) {
    // Handle concurrent insert on same email cleanly.
    const pgError = error as { code?: string };
    if (pgError?.code === "23505") {
      const retry = await db.query(
        `SELECT * FROM buffet_reservations WHERE attendee_email = $1 LIMIT 1`,
        [cleanEmail],
      );
      if (retry.rows[0]) {
        return { reservation: mapReservationRow(retry.rows[0]), alreadyExists: true };
      }
    }
    throw error;
  }
}

export async function getGuestReservationStatus(input: {
  email: string;
  ticketId: string;
}): Promise<BuffetReservationRecord | null> {
  await ensureBookingSchema();
  const db = getPgPool();
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanTicketId = input.ticketId.trim().toUpperCase();
  const result = await db.query(
    `SELECT * FROM buffet_reservations WHERE attendee_email = $1 AND UPPER(ticket_id) = $2 LIMIT 1`,
    [cleanEmail, cleanTicketId],
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

export async function listAdminReservations(): Promise<BuffetReservationRecord[]> {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `SELECT * FROM buffet_reservations ORDER BY created_at DESC, id DESC`,
  );
  return result.rows.map(mapReservationRow);
}

export async function getReservationByTicketId(
  ticketId: string,
): Promise<BuffetReservationRecord | null> {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `SELECT * FROM buffet_reservations WHERE UPPER(ticket_id) = $1 LIMIT 1`,
    [ticketId.trim().toUpperCase()],
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

export async function markReservationApproved(
  ticketId: string,
): Promise<BuffetReservationRecord | null> {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `UPDATE buffet_reservations
     SET payment_status = 'approved',
         approved_at = COALESCE(approved_at, NOW()),
         updated_at = NOW()
     WHERE UPPER(ticket_id) = $1
     RETURNING *`,
    [ticketId.trim().toUpperCase()],
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

export async function recordTicketEmailOutcome(input: {
  ticketId: string;
  status: ConfirmationStatus;
  messageId?: string | null;
  error?: string | null;
}): Promise<BuffetReservationRecord | null> {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `UPDATE buffet_reservations
     SET confirmation_status = $1,
         email_message_id = COALESCE($2, email_message_id),
         email_error = $3,
         email_sent_at = CASE WHEN $1 = 'sent' THEN NOW() ELSE email_sent_at END,
         updated_at = NOW()
     WHERE UPPER(ticket_id) = $4
     RETURNING *`,
    [
      input.status,
      input.messageId ?? null,
      input.error ?? null,
      input.ticketId.trim().toUpperCase(),
    ],
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

export async function updateReservationStatus(input: {
  ticketId: string;
  paymentStatus: PaymentStatus;
}): Promise<BuffetReservationRecord | null> {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `UPDATE buffet_reservations
     SET payment_status = $1,
         approved_at = CASE WHEN $1 = 'approved' THEN COALESCE(approved_at, NOW()) WHEN $1 = 'pending' THEN NULL ELSE approved_at END,
         updated_at = NOW()
     WHERE UPPER(ticket_id) = $2
     RETURNING *`,
    [input.paymentStatus, input.ticketId.trim().toUpperCase()],
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

export async function toggleGuestCheckIn(
  ticketId: string,
): Promise<BuffetReservationRecord | null> {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `UPDATE buffet_reservations
     SET checked_in_at = CASE WHEN checked_in_at IS NULL THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE UPPER(ticket_id) = $1 AND payment_status = 'approved'
     RETURNING *`,
    [ticketId.trim().toUpperCase()],
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

export async function addWaitlistSignup(input: {
  name: string;
  email: string;
}): Promise<{ alreadyJoined: boolean }> {
  await ensureBookingSchema();
  const db = getPgPool();
  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim().toLowerCase();

  const existing = await db.query(
    `SELECT id FROM buffet_waitlist WHERE email = $1 LIMIT 1`,
    [cleanEmail],
  );
  if (existing.rows[0]) return { alreadyJoined: true };

  try {
    await db.query(
      `INSERT INTO buffet_waitlist (name, email) VALUES ($1, $2)`,
      [cleanName, cleanEmail],
    );
    return { alreadyJoined: false };
  } catch (error) {
    const pgError = error as { code?: string };
    if (pgError?.code === "23505") return { alreadyJoined: true };
    throw error;
  }
}
