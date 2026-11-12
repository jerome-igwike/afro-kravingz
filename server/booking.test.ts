import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPrintableTicketHtml, buildTicketEmailHtml } from "../shared/ticketTemplate";
import {
  createAdminToken,
  handleAdminActionRequest,
  handleAdminOrdersRequest,
  handleReservationsRequest,
  verifyAdminToken,
} from "./bookingHttp";

function mockRequest(options: {
  method: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}) {
  const req = new EventEmitter() as IncomingMessage & {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  req.method = options.method;
  req.url = options.url ?? "/";
  req.headers = options.headers ?? {};
  req.body = options.body;
  return req;
}

function mockResponse() {
  let body = "";
  const headers: Record<string, string> = {};
  const res = {
    statusCode: 200,
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value;
    },
    end(chunk?: string | Buffer) {
      if (chunk) body += chunk.toString();
    },
  } as unknown as ServerResponse;

  return {
    res,
    getStatus: () => res.statusCode,
    getJson: () => JSON.parse(body),
    getHeaders: () => headers,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ticket template & branding", () => {
  it("renders Afro Kravings logo, QR code, and escapes untrusted fields", () => {
    const html = buildPrintableTicketHtml({
      ticket: {
        ticketId: "AKXMAS-2026-ABCD1234",
        attendeeName: 'Ada <script>alert("xss")</script>',
        attendeeEmail: "ada@example.com",
        approvedAt: "2026-12-01T12:00:00.000Z",
      },
      qrDataUrl: "data:image/png;base64,QRDATA",
      logoSrc: "/assets/afro-kravings-logo-ticket.png",
    });

    expect(html).toContain("/assets/afro-kravings-logo-ticket.png");
    expect(html).toContain("data:image/png;base64,QRDATA");
    expect(html).toContain("AKXMAS-2026-ABCD1234");
    expect(html).toContain("Sat, 19 December 2026");
    expect(html).toContain("£25");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
  });

  it("uses CID attachments for email clients", () => {
    const emailHtml = buildTicketEmailHtml({
      ticket: {
        ticketId: "AKXMAS-2026-99887766",
        attendeeName: "Chidi Okafor",
        attendeeEmail: "chidi@example.com",
        approvedAt: "2026-12-02T14:30:00.000Z",
      },
      qrCid: "ticket-qr",
      logoCid: "ak-logo",
    });

    expect(emailHtml).toContain('src="cid:ak-logo"');
    expect(emailHtml).toContain('src="cid:ticket-qr"');
    expect(emailHtml).toContain("Chidi Okafor");
    expect(emailHtml).toContain("Bradford BD1 2BA");
  });
});

describe("admin auth & booking endpoint safeguards", () => {
  it("issues and verifies signed admin tokens cleanly", () => {
    vi.stubEnv("ADMIN_PASSCODE", "9876");
    const token = createAdminToken();
    expect(verifyAdminToken(token)).toBe(true);
    expect(verifyAdminToken(`${token}tampered`)).toBe(false);
    expect(verifyAdminToken("")).toBe(false);
  });

  it("authenticates admin passcode and blocks unauthorized orders requests", async () => {
    vi.stubEnv("ADMIN_PASSCODE", "2340");

    const unauthReq = mockRequest({ method: "GET", url: "/api/admin/orders" });
    const unauthRes = mockResponse();
    await handleAdminOrdersRequest(unauthReq, unauthRes.res);
    expect(unauthRes.getStatus()).toBe(401);

    const badLoginReq = mockRequest({
      method: "POST",
      body: { action: "login", passcode: "0000" },
    });
    const badLoginRes = mockResponse();
    await handleAdminActionRequest(badLoginReq, badLoginRes.res);
    expect(badLoginRes.getStatus()).toBe(401);

    const goodLoginReq = mockRequest({
      method: "POST",
      body: { action: "login", passcode: "2340" },
    });
    const goodLoginRes = mockResponse();
    await handleAdminActionRequest(goodLoginReq, goodLoginRes.res);
    expect(goodLoginRes.getStatus()).toBe(200);
    expect(typeof goodLoginRes.getJson().token).toBe("string");
  });

  it("returns explicit 503 error instead of faking a ticket when Postgres is unconfigured", async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("POSTGRES_URL", "");
    vi.stubEnv("SUPABASE_DB_URL", "");

    const req = mockRequest({
      method: "POST",
      body: { name: "Ngozi Obi", email: "ngozi@example.com" },
    });
    const res = mockResponse();
    await handleReservationsRequest(req, res.res);
    expect(res.getStatus()).toBe(503);
    expect(res.getJson().code).toBe("DATABASE_NOT_CONFIGURED");
  });
});
