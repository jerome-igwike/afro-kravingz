// server/bookingHttp.ts
import crypto from "node:crypto";
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
async function listAdminReservations() {
  const mode = getDatabaseMode();
  if (mode === "none") throw new Error("DATABASE_NOT_CONFIGURED");
  if (mode === "supabase_rest") {
    const rows = await supabaseRestRequest(
      "buffet_reservations?order=created_at.desc,id.desc"
    );
    return rows.map(mapReservationRow);
  }
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `SELECT * FROM buffet_reservations ORDER BY created_at DESC, id DESC`
  );
  return result.rows.map(mapReservationRow);
}

// server/emailService.ts
import QRCode from "qrcode";
import { Resend } from "resend";
function getResendFromEmail() {
  return (process.env.RESEND_FROM_EMAIL || "Afro Kravings <tickets@afrokravingz.com>").trim();
}
function isResendConfigured() {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

// server/bookingHttp.ts
function getAdminPasscode() {
  return (process.env.ADMIN_PASSCODE || "2340").trim();
}
function getSigningSecret() {
  return process.env.ADMIN_TOKEN_SECRET || process.env.MANUS_JWT_SECRET || `ak-xmas-${getAdminPasscode()}-ledger-key`;
}
function safeEqualString(a, b) {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
function verifyAdminToken(token) {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [issuedAt, providedSig] = parts;
  const ts = Number(issuedAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  if (Date.now() - ts > 24 * 60 * 60 * 1e3) return false;
  const expectedSig = crypto.createHmac("sha256", getSigningSecret()).update(issuedAt).digest("hex");
  return safeEqualString(providedSig, expectedSig);
}
function isAuthorizedAdmin(req) {
  const tokenHeader = req.headers["x-admin-token"];
  const passcodeHeader = req.headers["x-admin-passcode"];
  const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  const passcode = Array.isArray(passcodeHeader) ? passcodeHeader[0] : passcodeHeader;
  if (verifyAdminToken(token)) return true;
  if (passcode && safeEqualString(passcode.trim(), getAdminPasscode())) return true;
  return false;
}
function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
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
async function handleAdminOrdersRequest(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }
  if (!isAuthorizedAdmin(req)) {
    return sendJson(res, 401, { ok: false, error: "Admin passcode required." });
  }
  const diagnostics = {
    databaseConfigured: isPostgresConfigured(),
    databaseMode: getDatabaseMode(),
    resendConfigured: isResendConfigured(),
    resendFromEmail: getResendFromEmail(),
    customPasscodeConfigured: Boolean(process.env.ADMIN_PASSCODE?.trim())
  };
  if (!diagnostics.databaseConfigured) {
    return sendJson(res, 200, {
      ok: true,
      diagnostics,
      orders: [],
      databaseError: "Add SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or DATABASE_URL) in Vercel environment variables."
    });
  }
  try {
    const orders = await listAdminReservations();
    return sendJson(res, 200, {
      ok: true,
      diagnostics,
      orders
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database query failed.";
    if (message === "SUPABASE_SCHEMA_MISSING") {
      return sendJson(res, 200, {
        ok: true,
        diagnostics,
        orders: [],
        databaseError: "Supabase is connected, but tables don't exist yet. Run supabase/schema.sql in your Supabase SQL Editor."
      });
    }
    console.error("[Admin Orders Error]", error);
    return sendJson(res, 500, {
      ok: false,
      diagnostics,
      orders: [],
      error: message
    });
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

// server/entries/admin-orders.ts
function handler(req, res) {
  return handleAdminOrdersRequest(req, res);
}
export {
  handler as default
};
