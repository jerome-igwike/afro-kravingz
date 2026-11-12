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
async function getReservationByTicketId(ticketId) {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `SELECT * FROM buffet_reservations WHERE UPPER(ticket_id) = $1 LIMIT 1`,
    [ticketId.trim().toUpperCase()]
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}
async function markReservationApproved(ticketId) {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `UPDATE buffet_reservations
     SET payment_status = 'approved',
         approved_at = COALESCE(approved_at, NOW()),
         updated_at = NOW()
     WHERE UPPER(ticket_id) = $1
     RETURNING *`,
    [ticketId.trim().toUpperCase()]
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}
async function recordTicketEmailOutcome(input) {
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
      input.ticketId.trim().toUpperCase()
    ]
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}
async function updateReservationStatus(input) {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `UPDATE buffet_reservations
     SET payment_status = $1,
         approved_at = CASE WHEN $1 = 'approved' THEN COALESCE(approved_at, NOW()) WHEN $1 = 'pending' THEN NULL ELSE approved_at END,
         updated_at = NOW()
     WHERE UPPER(ticket_id) = $2
     RETURNING *`,
    [input.paymentStatus, input.ticketId.trim().toUpperCase()]
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}
async function toggleGuestCheckIn(ticketId) {
  await ensureBookingSchema();
  const db = getPgPool();
  const result = await db.query(
    `UPDATE buffet_reservations
     SET checked_in_at = CASE WHEN checked_in_at IS NULL THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE UPPER(ticket_id) = $1 AND payment_status = 'approved'
     RETURNING *`,
    [ticketId.trim().toUpperCase()]
  );
  return result.rows[0] ? mapReservationRow(result.rows[0]) : null;
}

// server/emailService.ts
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import QRCode from "qrcode";
import { Resend } from "resend";

// shared/ticketTemplate.ts
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const map = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return map[character] ?? character;
  });
}
function buildCoreTicketCardMarkup(params) {
  const { ticket, qrSrc, logoSrc, forEmail = false } = params;
  const attendeeName = escapeHtml(ticket.attendeeName);
  const attendeeEmail = escapeHtml(ticket.attendeeEmail ?? "Guest on file");
  const ticketId = escapeHtml(ticket.ticketId);
  const approvedLabel = ticket.approvedAt ? escapeHtml(
    new Date(ticket.approvedAt).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric"
    })
  ) : "Verified & Paid";
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto;background-color:#fffaf3;border:2px solid #241014;${forEmail ? "" : "box-shadow:14px 14px 0 #efbe84;"}">
    <!-- Dark Ink Header Band with Official Afro Kravings Logo -->
    <tr>
      <td style="background-color:#241014;padding:26px 32px;border-bottom:3px solid #efbe84;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td valign="middle" align="left">
              <img src="${logoSrc}" alt="Afro Kravings" width="168" style="display:block;width:168px;max-width:100%;height:auto;border:0;" />
            </td>
            <td valign="middle" align="right" style="padding-left:16px;">
              <span style="display:inline-block;padding:6px 12px;border:1px solid #efbe84;background-color:#54151e;color:#efbe84;font-family:'Courier New',Courier,monospace;font-size:11px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase;white-space:nowrap;">
                AK-026 \xB7 ADMIT ONE
              </span>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Burgundy Editorial Banner -->
    <tr>
      <td style="background-color:#54151e;padding:28px 32px 26px;border-bottom:1px solid #3c0e15;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:2.2px;text-transform:uppercase;color:#efbe84;margin-bottom:8px;">
          The Afro Kravingz Presents \xB7 Official Entry Pass
        </div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:1.05;font-weight:700;color:#fffaf3;margin:0;">
          Jingle Bells <span style="color:#efbe84;font-style:italic;font-weight:400;">with Joe.</span>
        </div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ebd7c7;margin-top:8px;">
          Saturday, 19 December 2026 &nbsp;\xB7&nbsp; Bradford BD1 2BA
        </div>
      </td>
    </tr>

    <!-- QR Entry Verification Stub -->
    <tr>
      <td style="padding:28px 32px;background-color:#fffaf3;border-bottom:2px dashed #cdb9a3;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td valign="middle" align="left" style="padding-right:20px;">
              <div style="display:inline-block;padding:5px 11px;background-color:#dce8d6;color:#2f4c27;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:12px;">
                &#10003; Payment Confirmed \xB7 \xA325
              </div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:24px;line-height:1.18;font-weight:700;color:#241014;margin:0 0 8px 0;">
                Your seat at the table is confirmed.
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#5c3b31;margin:0 0 14px 0;">
                Show this QR pass on your phone or printed sheet at the door for express entry.
              </div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#8d604c;">
                Ticket Reference
              </div>
              <div style="font-family:'Courier New',Courier,monospace;font-size:16px;font-weight:700;letter-spacing:1px;color:#cf4035;margin-top:3px;">
                ${ticketId}
              </div>
            </td>
            <td valign="middle" align="right" width="164" style="width:164px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;border:2px solid #241014;padding:8px;">
                <tr>
                  <td align="center">
                    <img src="${qrSrc}" alt="QR Entry Code ${ticketId}" width="138" height="138" style="display:block;width:138px;height:138px;border:0;" />
                  </td>
                </tr>
                <tr>
                  <td align="center" style="padding-top:6px;font-family:'Courier New',Courier,monospace;font-size:9px;font-weight:700;letter-spacing:1px;color:#241014;text-transform:uppercase;">
                    Scan at door
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Event & Guest Ledger Details -->
    <tr>
      <td style="padding:10px 32px 6px;background-color:#fffaf3;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td width="50%" valign="top" style="padding:14px 12px 14px 0;border-bottom:1px solid #eadfd2;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#8d604c;">Guest Name</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;color:#241014;margin-top:4px;">${attendeeName}</div>
            </td>
            <td width="50%" valign="top" style="padding:14px 0 14px 12px;border-bottom:1px solid #eadfd2;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#8d604c;">Pass Tier</div>
              <div style="font-family:Georgia,'Times New Roman',serif;font-size:18px;font-weight:700;color:#241014;margin-top:4px;">The Complete Buffet Pass</div>
            </td>
          </tr>
          <tr>
            <td width="50%" valign="top" style="padding:14px 12px 14px 0;border-bottom:1px solid #eadfd2;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#8d604c;">Date &amp; Time</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#241014;margin-top:4px;">Sat, 19 December 2026</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5c3b31;margin-top:2px;">Doors 2:00 PM \xB7 Buffet 3:00 PM</div>
            </td>
            <td width="50%" valign="top" style="padding:14px 0 14px 12px;border-bottom:1px solid #eadfd2;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#8d604c;">Venue</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#241014;margin-top:4px;">1 High Point, New John Street</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5c3b31;margin-top:2px;">Bradford BD1 2BA</div>
            </td>
          </tr>
          <tr>
            <td width="50%" valign="top" style="padding:14px 12px 14px 0;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#8d604c;">Registered Email</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:#241014;margin-top:4px;word-break:break-word;">${attendeeEmail}</div>
            </td>
            <td width="50%" valign="top" style="padding:14px 0 14px 12px;">
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:#8d604c;">Approved</div>
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:#2f4c27;margin-top:4px;">${approvedLabel} \xB7 \xA325 Paid</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <!-- Buffet Highlights Strip -->
    <tr>
      <td style="padding:16px 32px;background-color:#f6e3cd;border-top:1px solid #dfc6a7;border-bottom:1px solid #dfc6a7;">
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#cf4035;margin-bottom:5px;">
          Included In Your Pass
        </div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.55;color:#3d2219;">
          Jollof, Fried, Native &amp; White Rice &nbsp;\xB7&nbsp; Bitterleaf, Fisherman Okro &amp; Nsala Soup &nbsp;\xB7&nbsp; Abacha, Nkwobi &amp; Moi-Moi &nbsp;\xB7&nbsp; Chicken, Turkey, Croaker Fish &amp; Assorted Meats &nbsp;\xB7&nbsp; Spiced Zobo Welcome &amp; Live Highlife
        </div>
      </td>
    </tr>

    <!-- Footer House Policy -->
    <tr>
      <td style="padding:18px 32px;background-color:#241014;color:#d8baa8;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td align="left" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#d8baa8;">
              <strong style="color:#efbe84;">No-kids buffet:</strong> Adults &amp; parents warmly invited \u2014 please keep kids at home or with guardians.
            </td>
            <td align="right" valign="middle" style="padding-left:16px;font-family:Georgia,'Times New Roman',serif;font-size:13px;font-style:italic;color:#efbe84;white-space:nowrap;">
              Come hungry. Leave glowing.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}
function buildPrintableTicketHtml(params) {
  const { ticket, qrDataUrl, logoSrc } = params;
  const ticketId = escapeHtml(ticket.ticketId);
  const card = buildCoreTicketCardMarkup({
    ticket,
    qrSrc: qrDataUrl,
    logoSrc,
    forEmail: false
  });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${ticketId} \u2014 Afro Kravings \xB7 Jingle Bells with Joe</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 36px 18px 56px;
        background: #f4eadc;
        color: #241014;
        font-family: Arial, Helvetica, sans-serif;
        -webkit-font-smoothing: antialiased;
      }
      .actions {
        max-width: 640px;
        margin: 0 auto 18px;
        display: flex;
        justify-content: flex-end;
        gap: 10px;
      }
      .print-btn {
        border: 2px solid #241014;
        background: #cf4035;
        color: #fffaf3;
        padding: 10px 18px;
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        cursor: pointer;
        box-shadow: 4px 4px 0 #241014;
      }
      @media print {
        body { padding: 0; background: #fff; }
        .actions { display: none !important; }
        table { box-shadow: none !important; }
      }
    </style>
  </head>
  <body>
    <div class="actions">
      <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>
    ${card}
  </body>
</html>`;
}
function buildTicketEmailHtml(params) {
  const { ticket, qrCid, logoCid } = params;
  const attendeeName = escapeHtml(ticket.attendeeName);
  const card = buildCoreTicketCardMarkup({
    ticket,
    qrSrc: `cid:${qrCid}`,
    logoSrc: `cid:${logoCid}`,
    forEmail: true
  });
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your Afro Kravings Entry Pass \u2014 ${escapeHtml(ticket.ticketId)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4eadc;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4eadc;padding:28px 14px 40px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto 16px;">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#241014;padding:0 4px;">
                Hello <strong>${attendeeName}</strong>,<br />
                Your <strong>\xA325</strong> payment has been verified and confirmed. Here is your official entry pass for <strong>Jingle Bells with Joe</strong> on <strong>Saturday, 19 December 2026</strong> \u2014 we\u2019ve also attached a printable copy to this email.
              </td>
            </tr>
          </table>
          ${card}
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:18px auto 0;">
            <tr>
              <td align="center" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.5;color:#724c3a;">
                Need anything before the evening? Simply reply on our website live chat and our team will look after you.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// server/emailService.ts
var cachedLogoBuffer = null;
function getResendFromEmail() {
  return (process.env.RESEND_FROM_EMAIL || "Afro Kravings <onboarding@resend.dev>").trim();
}
async function loadTicketLogoBuffer(originUrl) {
  if (cachedLogoBuffer) return cachedLogoBuffer;
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidatePaths = [
    path.resolve(process.cwd(), "client/public/assets/afro-kravings-logo-ticket.png"),
    path.resolve(process.cwd(), "dist/public/assets/afro-kravings-logo-ticket.png"),
    path.resolve(moduleDir, "../client/public/assets/afro-kravings-logo-ticket.png"),
    path.resolve(moduleDir, "../../client/public/assets/afro-kravings-logo-ticket.png")
  ];
  for (const filePath of candidatePaths) {
    try {
      const buffer = await fs.readFile(filePath);
      if (buffer.length > 0) {
        cachedLogoBuffer = buffer;
        return buffer;
      }
    } catch {
    }
  }
  if (originUrl) {
    try {
      const response = await fetch(`${originUrl.replace(/\/$/, "")}/assets/afro-kravings-logo-ticket.png`);
      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 0) {
          cachedLogoBuffer = buffer;
          return buffer;
        }
      }
    } catch {
    }
  }
  return null;
}
async function sendApprovedTicketEmail(params) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured in environment variables.");
  }
  const qrBuffer = await QRCode.toBuffer(params.ticket.ticketId, {
    width: 340,
    margin: 2,
    color: { dark: "#241014", light: "#ffffff" }
  });
  const qrDataUrl = `data:image/png;base64,${qrBuffer.toString("base64")}`;
  const logoBuffer = await loadTicketLogoBuffer(params.originUrl);
  const logoDataUrl = logoBuffer ? `data:image/png;base64,${logoBuffer.toString("base64")}` : `${(params.originUrl || "").replace(/\/$/, "")}/assets/afro-kravings-logo-ticket.png`;
  const qrCid = "ticket-qr";
  const logoCid = "ak-logo";
  const emailHtml = buildTicketEmailHtml({
    ticket: params.ticket,
    qrCid,
    logoCid
  });
  const printableHtml = buildPrintableTicketHtml({
    ticket: params.ticket,
    qrDataUrl,
    logoSrc: logoDataUrl
  });
  const attachments = [
    {
      filename: `${params.ticket.ticketId}-qr.png`,
      content: qrBuffer,
      contentType: "image/png",
      contentId: qrCid
    },
    {
      filename: `${params.ticket.ticketId}-afro-kravings-pass.html`,
      content: Buffer.from(printableHtml, "utf-8"),
      contentType: "text/html"
    }
  ];
  if (logoBuffer) {
    attachments.unshift({
      filename: "afro-kravings-logo.png",
      content: logoBuffer,
      contentType: "image/png",
      contentId: logoCid
    });
  }
  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: getResendFromEmail(),
    to: [params.recipientEmail],
    subject: `Your Official Pass \xB7 Jingle Bells with Joe (${params.ticket.ticketId})`,
    html: emailHtml,
    attachments
  });
  if (error || !data?.id) {
    throw new Error(error?.message || "Resend failed to dispatch the ticket email.");
  }
  return { messageId: data.id };
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
function createAdminToken() {
  const issuedAt = String(Date.now());
  const sig = crypto.createHmac("sha256", getSigningSecret()).update(issuedAt).digest("hex");
  return `${issuedAt}.${sig}`;
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
function getRequestOrigin(req) {
  const protoHeader = req.headers["x-forwarded-proto"];
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || "https";
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host) return void 0;
  return `${proto}://${host}`;
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
var adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), passcode: z.string().min(1).max(64) }),
  z.object({ action: z.literal("approve"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("resend"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("reject"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("reopen"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("checkin"), ticketId: z.string().min(4).max(40) })
]);
async function handleAdminActionRequest(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }
  const body = await readJsonBody(req);
  const parsed = adminActionSchema.safeParse(body);
  if (!parsed.success) {
    return sendJson(res, 400, { ok: false, error: "Invalid admin action payload." });
  }
  const payload = parsed.data;
  if (payload.action === "login") {
    if (!safeEqualString(payload.passcode.trim(), getAdminPasscode())) {
      return sendJson(res, 401, { ok: false, error: "That passcode is not correct." });
    }
    return sendJson(res, 200, { ok: true, token: createAdminToken() });
  }
  if (!isAuthorizedAdmin(req)) {
    return sendJson(res, 401, { ok: false, error: "Session expired. Please sign in again." });
  }
  if (!isPostgresConfigured()) {
    return sendJson(res, 503, {
      ok: false,
      code: "DATABASE_NOT_CONFIGURED",
      error: "Database is not connected yet. Add DATABASE_URL in Vercel first."
    });
  }
  try {
    const originUrl = getRequestOrigin(req);
    if (payload.action === "approve") {
      const approved = await markReservationApproved(payload.ticketId);
      if (!approved) {
        return sendJson(res, 404, { ok: false, error: "Reservation not found." });
      }
      try {
        const emailResult = await sendApprovedTicketEmail({
          ticket: {
            ticketId: approved.ticketId,
            attendeeName: approved.attendeeName,
            attendeeEmail: approved.attendeeEmail,
            approvedAt: approved.approvedAt
          },
          recipientEmail: approved.attendeeEmail,
          originUrl
        });
        const finalOrder = await recordTicketEmailOutcome({
          ticketId: approved.ticketId,
          status: "sent",
          messageId: emailResult.messageId,
          error: null
        });
        return sendJson(res, 200, {
          ok: true,
          order: finalOrder ?? approved,
          emailSent: true,
          messageId: emailResult.messageId
        });
      } catch (emailErr) {
        const errorMessage = emailErr instanceof Error ? emailErr.message : "Failed to send email via Resend.";
        const finalOrder = await recordTicketEmailOutcome({
          ticketId: approved.ticketId,
          status: "failed",
          error: errorMessage
        });
        return sendJson(res, 200, {
          ok: true,
          order: finalOrder ?? approved,
          emailSent: false,
          emailError: errorMessage
        });
      }
    }
    if (payload.action === "resend") {
      const existing = await getReservationByTicketId(payload.ticketId);
      if (!existing) {
        return sendJson(res, 404, { ok: false, error: "Reservation not found." });
      }
      if (existing.paymentStatus !== "approved") {
        return sendJson(res, 400, {
          ok: false,
          error: "Approve payment first before sending the entry ticket."
        });
      }
      try {
        const emailResult = await sendApprovedTicketEmail({
          ticket: {
            ticketId: existing.ticketId,
            attendeeName: existing.attendeeName,
            attendeeEmail: existing.attendeeEmail,
            approvedAt: existing.approvedAt
          },
          recipientEmail: existing.attendeeEmail,
          originUrl
        });
        const finalOrder = await recordTicketEmailOutcome({
          ticketId: existing.ticketId,
          status: "sent",
          messageId: emailResult.messageId,
          error: null
        });
        return sendJson(res, 200, {
          ok: true,
          order: finalOrder ?? existing,
          emailSent: true,
          messageId: emailResult.messageId
        });
      } catch (emailErr) {
        const errorMessage = emailErr instanceof Error ? emailErr.message : "Failed to resend email via Resend.";
        const finalOrder = await recordTicketEmailOutcome({
          ticketId: existing.ticketId,
          status: "failed",
          error: errorMessage
        });
        return sendJson(res, 200, {
          ok: true,
          order: finalOrder ?? existing,
          emailSent: false,
          emailError: errorMessage
        });
      }
    }
    if (payload.action === "reject") {
      const updated = await updateReservationStatus({
        ticketId: payload.ticketId,
        paymentStatus: "rejected"
      });
      if (!updated) return sendJson(res, 404, { ok: false, error: "Reservation not found." });
      return sendJson(res, 200, { ok: true, order: updated });
    }
    if (payload.action === "reopen") {
      const updated = await updateReservationStatus({
        ticketId: payload.ticketId,
        paymentStatus: "pending"
      });
      if (!updated) return sendJson(res, 404, { ok: false, error: "Reservation not found." });
      return sendJson(res, 200, { ok: true, order: updated });
    }
    if (payload.action === "checkin") {
      const updated = await toggleGuestCheckIn(payload.ticketId);
      if (!updated) {
        return sendJson(res, 400, {
          ok: false,
          error: "Only approved passes can be checked in at the door."
        });
      }
      return sendJson(res, 200, { ok: true, order: updated });
    }
    return sendJson(res, 400, { ok: false, error: "Unknown action." });
  } catch (error) {
    return handleErrorResponse(res, error, "Admin action failed.");
  }
}

// server/entries/admin-action.ts
function handler(req, res) {
  return handleAdminActionRequest(req, res);
}
export {
  handler as default
};
