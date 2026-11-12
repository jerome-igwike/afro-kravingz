// server/bookingHttp.ts
import { z } from "zod";

// server/bookingDb.ts
import { customAlphabet } from "nanoid";
import { Pool } from "pg";
var makeTicketSuffix = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 8);
var pool = null;
var poolConnectionString = null;
var schemaReadyPromise = null;
function getPostgresConnectionString() {
  return (process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "").trim();
}
function isPostgresConfigured() {
  return getPostgresConnectionString().length > 0;
}
function buildPoolConfig(rawUrl) {
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
        idleTimeoutMillis: 1e4,
        connectionTimeoutMillis: 8e3
      };
    }
    url.searchParams.delete("sslmode");
    return {
      connectionString: url.toString(),
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 1e4,
      connectionTimeoutMillis: 8e3
    };
  } catch {
    return {
      connectionString: rawUrl,
      ssl: { rejectUnauthorized: false },
      max: 5,
      idleTimeoutMillis: 1e4,
      connectionTimeoutMillis: 8e3
    };
  }
}
function getPgPool() {
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
async function ensureBookingSchema() {
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
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  return schemaReadyPromise;
}
function mapReservationRow(row) {
  const toIso = (value) => {
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
    paymentStatus: String(row.payment_status),
    confirmationStatus: String(row.confirmation_status),
    emailMessageId: row.email_message_id ? String(row.email_message_id) : null,
    emailError: row.email_error ? String(row.email_error) : null,
    approvedAt: toIso(row.approved_at),
    emailSentAt: toIso(row.email_sent_at),
    checkedInAt: toIso(row.checked_in_at),
    createdAt: toIso(row.created_at) ?? (/* @__PURE__ */ new Date()).toISOString(),
    updatedAt: toIso(row.updated_at) ?? (/* @__PURE__ */ new Date()).toISOString()
  };
}
async function submitGuestReservation(input) {
  await ensureBookingSchema();
  const db = getPgPool();
  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanNote = input.paymentReference?.trim() || null;
  const existing = await db.query(
    `SELECT * FROM buffet_reservations WHERE attendee_email = $1 LIMIT 1`,
    [cleanEmail]
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
      [cleanName, cleanNote, current.id]
    );
    return { reservation: mapReservationRow(updated.rows[0]), alreadyExists: true };
  }
  const ticketId = `AKXMAS-${(/* @__PURE__ */ new Date()).getFullYear()}-${makeTicketSuffix()}`;
  try {
    const inserted = await db.query(
      `INSERT INTO buffet_reservations (
        ticket_id, attendee_name, attendee_email, amount_pence, payment_reference, payment_status, confirmation_status
      ) VALUES ($1, $2, $3, 2500, $4, 'pending', 'not_sent')
      RETURNING *`,
      [ticketId, cleanName, cleanEmail, cleanNote]
    );
    return { reservation: mapReservationRow(inserted.rows[0]), alreadyExists: false };
  } catch (error) {
    const pgError = error;
    if (pgError?.code === "23505") {
      const retry = await db.query(
        `SELECT * FROM buffet_reservations WHERE attendee_email = $1 LIMIT 1`,
        [cleanEmail]
      );
      if (retry.rows[0]) {
        return { reservation: mapReservationRow(retry.rows[0]), alreadyExists: true };
      }
    }
    throw error;
  }
}
async function getGuestReservationStatus(input) {
  await ensureBookingSchema();
  const db = getPgPool();
  const cleanEmail = input.email.trim().toLowerCase();
  const cleanTicketId = input.ticketId.trim().toUpperCase();
  const result = await db.query(
    `SELECT * FROM buffet_reservations WHERE attendee_email = $1 AND UPPER(ticket_id) = $2 LIMIT 1`,
    [cleanEmail, cleanTicketId]
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

// server/emailService.ts
import QRCode from "qrcode";
import { Resend } from "resend";

// server/bookingHttp.ts
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
function getQueryParams(req) {
  const url = new URL(req.url || "/", "http://localhost");
  return url.searchParams;
}
function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}
function handleErrorResponse(res, error, fallbackMessage) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (message === "DATABASE_NOT_CONFIGURED") {
    return sendJson(res, 503, {
      ok: false,
      code: "DATABASE_NOT_CONFIGURED",
      error: "Reservation database is not configured yet. Please connect Neon or Supabase Postgres via DATABASE_URL."
    });
  }
  console.error("[Booking API Error]", error);
  return sendJson(res, 500, {
    ok: false,
    code: "INTERNAL_ERROR",
    error: message || fallbackMessage
  });
}
var reserveSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name.").max(160),
  email: z.string().trim().email("Please enter a valid email address.").max(320),
  paymentReference: z.string().trim().max(160).optional()
});
var waitlistSchema = z.object({
  name: z.string().trim().min(2, "Please add your name.").max(160),
  email: z.string().trim().email("Please use a valid email.").max(320)
});
async function handleReservationsRequest(req, res) {
  if (req.method === "GET") {
    try {
      if (!isPostgresConfigured()) {
        return sendJson(res, 503, {
          ok: false,
          code: "DATABASE_NOT_CONFIGURED",
          error: "Reservation database is not configured yet."
        });
      }
      const params = getQueryParams(req);
      const email = params.get("email")?.trim() ?? "";
      const ticketId = params.get("ticketId")?.trim() ?? "";
      if (!email || !ticketId) {
        return sendJson(res, 400, {
          ok: false,
          error: "Both email and ticketId are required to check pass status."
        });
      }
      const reservation = await getGuestReservationStatus({ email, ticketId });
      if (!reservation) {
        return sendJson(res, 404, {
          ok: false,
          error: "No reservation found matching those details."
        });
      }
      return sendJson(res, 200, { ok: true, reservation });
    } catch (error) {
      return handleErrorResponse(res, error, "Could not verify reservation status.");
    }
  }
  if (req.method === "POST") {
    try {
      if (!isPostgresConfigured()) {
        return sendJson(res, 503, {
          ok: false,
          code: "DATABASE_NOT_CONFIGURED",
          error: "Reservation database is not connected yet. Add DATABASE_URL in Vercel to accept live bookings."
        });
      }
      const body = await readJsonBody(req);
      const parsed = reserveSchema.safeParse(body);
      if (!parsed.success) {
        return sendJson(res, 400, {
          ok: false,
          error: parsed.error.issues[0]?.message || "Please enter a valid name and email."
        });
      }
      const result = await submitGuestReservation(parsed.data);
      return sendJson(res, result.alreadyExists ? 200 : 201, {
        ok: true,
        alreadyExists: result.alreadyExists,
        reservation: result.reservation
      });
    } catch (error) {
      return handleErrorResponse(res, error, "Could not log your reservation right now.");
    }
  }
  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}
var adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), passcode: z.string().min(1).max(64) }),
  z.object({ action: z.literal("approve"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("resend"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("reject"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("reopen"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("checkin"), ticketId: z.string().min(4).max(40) })
]);

// server/entries/reservations.ts
function handler(req, res) {
  return handleReservationsRequest(req, res);
}
export {
  handler as default
};
