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
function getSupabaseRestConfig() {
  const url = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "").trim();
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}
function getDatabaseMode() {
  if (getPostgresConnectionString().length > 0) return "postgres";
  if (getSupabaseRestConfig()) return "supabase_rest";
  return "none";
}
function isPostgresConfigured() {
  return getDatabaseMode() !== "none";
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
  if (getDatabaseMode() !== "postgres") {
    return;
  }
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
var SupabaseHttpError = class extends Error {
  status;
  code;
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
};
async function supabaseRestRequest(pathWithQuery, options = {}) {
  const cfg = getSupabaseRestConfig();
  if (!cfg) {
    throw new Error("DATABASE_NOT_CONFIGURED");
  }
  const headers = {
    apikey: cfg.serviceRoleKey,
    Authorization: `Bearer ${cfg.serviceRoleKey}`,
    Accept: "application/json"
  };
  if (options.body !== void 0) {
    headers["Content-Type"] = "application/json";
  }
  if (options.prefer) {
    headers.Prefer = options.prefer;
  }
  const response = await fetch(`${cfg.url}/rest/v1/${pathWithQuery}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== void 0 ? JSON.stringify(options.body) : void 0
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!response.ok) {
    const errObj = parsed && typeof parsed === "object" ? parsed : {};
    const code = errObj.code ?? null;
    if (code === "PGRST205" || code === "42P01") {
      throw new Error("SUPABASE_SCHEMA_MISSING");
    }
    throw new SupabaseHttpError(
      response.status,
      code,
      errObj.message || `Supabase request failed (${response.status})`
    );
  }
  return parsed ?? [];
}
async function addWaitlistSignup(input) {
  const mode = getDatabaseMode();
  if (mode === "none") throw new Error("DATABASE_NOT_CONFIGURED");
  const cleanName = input.name.trim();
  const cleanEmail = input.email.trim().toLowerCase();
  if (mode === "supabase_rest") {
    const existingRows = await supabaseRestRequest(
      `buffet_waitlist?email=eq.${encodeURIComponent(cleanEmail)}&select=id&limit=1`
    );
    if (existingRows[0]) return { alreadyJoined: true };
    try {
      await supabaseRestRequest(
        "buffet_waitlist",
        {
          method: "POST",
          prefer: "return=minimal",
          body: { name: cleanName, email: cleanEmail }
        }
      );
      return { alreadyJoined: false };
    } catch (error) {
      if (error instanceof SupabaseHttpError && (error.status === 409 || error.code === "23505")) {
        return { alreadyJoined: true };
      }
      throw error;
    }
  }
  await ensureBookingSchema();
  const db = getPgPool();
  const existing = await db.query(
    `SELECT id FROM buffet_waitlist WHERE email = $1 LIMIT 1`,
    [cleanEmail]
  );
  if (existing.rows[0]) return { alreadyJoined: true };
  try {
    await db.query(
      `INSERT INTO buffet_waitlist (name, email) VALUES ($1, $2)`,
      [cleanName, cleanEmail]
    );
    return { alreadyJoined: false };
  } catch (error) {
    const pgError = error;
    if (pgError?.code === "23505") return { alreadyJoined: true };
    throw error;
  }
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
      error: "Reservation database is not configured yet. Add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or DATABASE_URL) in Vercel."
    });
  }
  if (message === "SUPABASE_SCHEMA_MISSING") {
    return sendJson(res, 503, {
      ok: false,
      code: "SUPABASE_SCHEMA_MISSING",
      error: "Supabase is connected, but the booking tables haven't been created yet. Run supabase/schema.sql in Supabase SQL Editor."
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
async function handleWaitlistRequest(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    if (!isPostgresConfigured()) {
      return sendJson(res, 503, {
        ok: false,
        code: "DATABASE_NOT_CONFIGURED",
        error: "Guest list database is not connected yet."
      });
    }
    const body = await readJsonBody(req);
    const parsed = waitlistSchema.safeParse(body);
    if (!parsed.success) {
      return sendJson(res, 400, {
        ok: false,
        error: parsed.error.issues[0]?.message || "Please enter a valid name and email."
      });
    }
    const result = await addWaitlistSignup(parsed.data);
    return sendJson(res, 200, { ok: true, alreadyJoined: result.alreadyJoined });
  } catch (error) {
    return handleErrorResponse(res, error, "Could not save your guest list entry.");
  }
}
var adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), passcode: z.string().min(1).max(64) }),
  z.object({ action: z.literal("approve"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("resend"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("reject"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("reopen"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("checkin"), ticketId: z.string().min(4).max(40) })
]);

// server/entries/waitlist.ts
function handler(req, res) {
  return handleWaitlistRequest(req, res);
}
export {
  handler as default
};
