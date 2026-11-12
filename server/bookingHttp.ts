import crypto from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import {
  addWaitlistSignup,
  getGuestReservationStatus,
  getReservationByTicketId,
  isPostgresConfigured,
  listAdminReservations,
  markReservationApproved,
  recordTicketEmailOutcome,
  submitGuestReservation,
  toggleGuestCheckIn,
  updateReservationStatus,
} from "./bookingDb";
import {
  getResendFromEmail,
  isResendConfigured,
  sendApprovedTicketEmail,
} from "./emailService";

type NodeReq = IncomingMessage & { body?: unknown };
type NodeRes = ServerResponse;

function getAdminPasscode(): string {
  return (process.env.ADMIN_PASSCODE || "2340").trim();
}

function getSigningSecret(): string {
  return (
    process.env.ADMIN_TOKEN_SECRET ||
    process.env.MANUS_JWT_SECRET ||
    `ak-xmas-${getAdminPasscode()}-ledger-key`
  );
}

function safeEqualString(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf-8");
  const bufB = Buffer.from(b, "utf-8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createAdminToken(): string {
  const issuedAt = String(Date.now());
  const sig = crypto.createHmac("sha256", getSigningSecret()).update(issuedAt).digest("hex");
  return `${issuedAt}.${sig}`;
}

export function verifyAdminToken(token: string | null | undefined): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 2) return false;
  const [issuedAt, providedSig] = parts;
  const ts = Number(issuedAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  // Tokens remain valid for 24 hours.
  if (Date.now() - ts > 24 * 60 * 60 * 1000) return false;
  const expectedSig = crypto
    .createHmac("sha256", getSigningSecret())
    .update(issuedAt)
    .digest("hex");
  return safeEqualString(providedSig, expectedSig);
}

function isAuthorizedAdmin(req: NodeReq): boolean {
  const tokenHeader = req.headers["x-admin-token"];
  const passcodeHeader = req.headers["x-admin-passcode"];
  const token = Array.isArray(tokenHeader) ? tokenHeader[0] : tokenHeader;
  const passcode = Array.isArray(passcodeHeader) ? passcodeHeader[0] : passcodeHeader;

  if (verifyAdminToken(token)) return true;
  if (passcode && safeEqualString(passcode.trim(), getAdminPasscode())) return true;
  return false;
}

async function readJsonBody(req: NodeReq): Promise<Record<string, unknown>> {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) {
    return req.body as Record<string, unknown>;
  }
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function getQueryParams(req: NodeReq): URLSearchParams {
  const url = new URL(req.url || "/", "http://localhost");
  return url.searchParams;
}

function getRequestOrigin(req: NodeReq): string | undefined {
  const protoHeader = req.headers["x-forwarded-proto"];
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || "https";
  const host = Array.isArray(hostHeader) ? hostHeader[0] : hostHeader;
  if (!host) return undefined;
  return `${proto}://${host}`;
}

function sendJson(res: NodeRes, statusCode: number, payload: unknown) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function handleErrorResponse(res: NodeRes, error: unknown, fallbackMessage: string) {
  const message = error instanceof Error ? error.message : fallbackMessage;
  if (message === "DATABASE_NOT_CONFIGURED") {
    return sendJson(res, 503, {
      ok: false,
      code: "DATABASE_NOT_CONFIGURED",
      error: "Reservation database is not configured yet. Please connect Neon or Supabase Postgres via DATABASE_URL.",
    });
  }
  console.error("[Booking API Error]", error);
  return sendJson(res, 500, {
    ok: false,
    code: "INTERNAL_ERROR",
    error: message || fallbackMessage,
  });
}

const reserveSchema = z.object({
  name: z.string().trim().min(2, "Please enter your full name.").max(160),
  email: z.string().trim().email("Please enter a valid email address.").max(320),
  paymentReference: z.string().trim().max(160).optional(),
});

const waitlistSchema = z.object({
  name: z.string().trim().min(2, "Please add your name.").max(160),
  email: z.string().trim().email("Please use a valid email.").max(320),
});

export async function handleReservationsRequest(req: NodeReq, res: NodeRes) {
  if (req.method === "GET") {
    try {
      if (!isPostgresConfigured()) {
        return sendJson(res, 503, {
          ok: false,
          code: "DATABASE_NOT_CONFIGURED",
          error: "Reservation database is not configured yet.",
        });
      }
      const params = getQueryParams(req);
      const email = params.get("email")?.trim() ?? "";
      const ticketId = params.get("ticketId")?.trim() ?? "";
      if (!email || !ticketId) {
        return sendJson(res, 400, {
          ok: false,
          error: "Both email and ticketId are required to check pass status.",
        });
      }
      const reservation = await getGuestReservationStatus({ email, ticketId });
      if (!reservation) {
        return sendJson(res, 404, {
          ok: false,
          error: "No reservation found matching those details.",
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
          error: "Reservation database is not connected yet. Add DATABASE_URL in Vercel to accept live bookings.",
        });
      }
      const body = await readJsonBody(req);
      const parsed = reserveSchema.safeParse(body);
      if (!parsed.success) {
        return sendJson(res, 400, {
          ok: false,
          error: parsed.error.issues[0]?.message || "Please enter a valid name and email.",
        });
      }
      const result = await submitGuestReservation(parsed.data);
      return sendJson(res, result.alreadyExists ? 200 : 201, {
        ok: true,
        alreadyExists: result.alreadyExists,
        reservation: result.reservation,
      });
    } catch (error) {
      return handleErrorResponse(res, error, "Could not log your reservation right now.");
    }
  }

  return sendJson(res, 405, { ok: false, error: "Method not allowed" });
}

export async function handleWaitlistRequest(req: NodeReq, res: NodeRes) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }
  try {
    if (!isPostgresConfigured()) {
      return sendJson(res, 503, {
        ok: false,
        code: "DATABASE_NOT_CONFIGURED",
        error: "Guest list database is not connected yet.",
      });
    }
    const body = await readJsonBody(req);
    const parsed = waitlistSchema.safeParse(body);
    if (!parsed.success) {
      return sendJson(res, 400, {
        ok: false,
        error: parsed.error.issues[0]?.message || "Please enter a valid name and email.",
      });
    }
    const result = await addWaitlistSignup(parsed.data);
    return sendJson(res, 200, { ok: true, alreadyJoined: result.alreadyJoined });
  } catch (error) {
    return handleErrorResponse(res, error, "Could not save your guest list entry.");
  }
}

export async function handleAdminOrdersRequest(req: NodeReq, res: NodeRes) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed" });
  }
  if (!isAuthorizedAdmin(req)) {
    return sendJson(res, 401, { ok: false, error: "Admin passcode required." });
  }

  const diagnostics = {
    databaseConfigured: isPostgresConfigured(),
    resendConfigured: isResendConfigured(),
    resendFromEmail: getResendFromEmail(),
    customPasscodeConfigured: Boolean(process.env.ADMIN_PASSCODE?.trim()),
  };

  if (!diagnostics.databaseConfigured) {
    return sendJson(res, 200, {
      ok: true,
      diagnostics,
      orders: [],
      databaseError: "DATABASE_URL is not configured yet.",
    });
  }

  try {
    const orders = await listAdminReservations();
    return sendJson(res, 200, {
      ok: true,
      diagnostics,
      orders,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Database query failed.";
    console.error("[Admin Orders Error]", error);
    return sendJson(res, 500, {
      ok: false,
      diagnostics,
      orders: [],
      error: message,
    });
  }
}

const adminActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), passcode: z.string().min(1).max(64) }),
  z.object({ action: z.literal("approve"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("resend"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("reject"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("reopen"), ticketId: z.string().min(4).max(40) }),
  z.object({ action: z.literal("checkin"), ticketId: z.string().min(4).max(40) }),
]);

export async function handleAdminActionRequest(req: NodeReq, res: NodeRes) {
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
      error: "Database is not connected yet. Add DATABASE_URL in Vercel first.",
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
            approvedAt: approved.approvedAt,
          },
          recipientEmail: approved.attendeeEmail,
          originUrl,
        });
        const finalOrder = await recordTicketEmailOutcome({
          ticketId: approved.ticketId,
          status: "sent",
          messageId: emailResult.messageId,
          error: null,
        });
        return sendJson(res, 200, {
          ok: true,
          order: finalOrder ?? approved,
          emailSent: true,
          messageId: emailResult.messageId,
        });
      } catch (emailErr) {
        const errorMessage =
          emailErr instanceof Error ? emailErr.message : "Failed to send email via Resend.";
        const finalOrder = await recordTicketEmailOutcome({
          ticketId: approved.ticketId,
          status: "failed",
          error: errorMessage,
        });
        return sendJson(res, 200, {
          ok: true,
          order: finalOrder ?? approved,
          emailSent: false,
          emailError: errorMessage,
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
          error: "Approve payment first before sending the entry ticket.",
        });
      }
      try {
        const emailResult = await sendApprovedTicketEmail({
          ticket: {
            ticketId: existing.ticketId,
            attendeeName: existing.attendeeName,
            attendeeEmail: existing.attendeeEmail,
            approvedAt: existing.approvedAt,
          },
          recipientEmail: existing.attendeeEmail,
          originUrl,
        });
        const finalOrder = await recordTicketEmailOutcome({
          ticketId: existing.ticketId,
          status: "sent",
          messageId: emailResult.messageId,
          error: null,
        });
        return sendJson(res, 200, {
          ok: true,
          order: finalOrder ?? existing,
          emailSent: true,
          messageId: emailResult.messageId,
        });
      } catch (emailErr) {
        const errorMessage =
          emailErr instanceof Error ? emailErr.message : "Failed to resend email via Resend.";
        const finalOrder = await recordTicketEmailOutcome({
          ticketId: existing.ticketId,
          status: "failed",
          error: errorMessage,
        });
        return sendJson(res, 200, {
          ok: true,
          order: finalOrder ?? existing,
          emailSent: false,
          emailError: errorMessage,
        });
      }
    }

    if (payload.action === "reject") {
      const updated = await updateReservationStatus({
        ticketId: payload.ticketId,
        paymentStatus: "rejected",
      });
      if (!updated) return sendJson(res, 404, { ok: false, error: "Reservation not found." });
      return sendJson(res, 200, { ok: true, order: updated });
    }

    if (payload.action === "reopen") {
      const updated = await updateReservationStatus({
        ticketId: payload.ticketId,
        paymentStatus: "pending",
      });
      if (!updated) return sendJson(res, 404, { ok: false, error: "Reservation not found." });
      return sendJson(res, 200, { ok: true, order: updated });
    }

    if (payload.action === "checkin") {
      const updated = await toggleGuestCheckIn(payload.ticketId);
      if (!updated) {
        return sendJson(res, 400, {
          ok: false,
          error: "Only approved passes can be checked in at the door.",
        });
      }
      return sendJson(res, 200, { ok: true, order: updated });
    }

    return sendJson(res, 400, { ok: false, error: "Unknown action." });
  } catch (error) {
    return handleErrorResponse(res, error, "Admin action failed.");
  }
}
