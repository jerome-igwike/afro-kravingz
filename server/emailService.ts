import fs from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { Resend } from "resend";
import {
  buildPrintableTicketHtml,
  buildTicketEmailHtml,
  type TicketPassData,
} from "../shared/ticketTemplate";

let cachedLogoBuffer: Buffer | null = null;

export function getResendFromEmail(): string {
  return (
    process.env.RESEND_FROM_EMAIL ||
    "Afro Kravings <onboarding@resend.dev>"
  ).trim();
}

export function isResendConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

async function loadTicketLogoBuffer(originUrl?: string): Promise<Buffer | null> {
  if (cachedLogoBuffer) return cachedLogoBuffer;

  const candidatePaths = [
    path.resolve(process.cwd(), "client/public/assets/afro-kravings-logo-ticket.png"),
    path.resolve(process.cwd(), "dist/public/assets/afro-kravings-logo-ticket.png"),
    path.resolve(import.meta.dirname, "../client/public/assets/afro-kravings-logo-ticket.png"),
    path.resolve(import.meta.dirname, "../../client/public/assets/afro-kravings-logo-ticket.png"),
  ];

  for (const filePath of candidatePaths) {
    try {
      const buffer = await fs.readFile(filePath);
      if (buffer.length > 0) {
        cachedLogoBuffer = buffer;
        return buffer;
      }
    } catch {
      /* try next candidate path */
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
      /* fallback below */
    }
  }

  return null;
}

export async function sendApprovedTicketEmail(params: {
  ticket: TicketPassData;
  recipientEmail: string;
  originUrl?: string;
}): Promise<{ messageId: string }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured in environment variables.");
  }

  const qrBuffer = await QRCode.toBuffer(params.ticket.ticketId, {
    width: 340,
    margin: 2,
    color: { dark: "#241014", light: "#ffffff" },
  });
  const qrDataUrl = `data:image/png;base64,${qrBuffer.toString("base64")}`;

  const logoBuffer = await loadTicketLogoBuffer(params.originUrl);
  const logoDataUrl = logoBuffer
    ? `data:image/png;base64,${logoBuffer.toString("base64")}`
    : `${(params.originUrl || "").replace(/\/$/, "")}/assets/afro-kravings-logo-ticket.png`;

  const qrCid = "ticket-qr";
  const logoCid = "ak-logo";

  const emailHtml = buildTicketEmailHtml({
    ticket: params.ticket,
    qrCid,
    logoCid,
  });

  const printableHtml = buildPrintableTicketHtml({
    ticket: params.ticket,
    qrDataUrl,
    logoSrc: logoDataUrl,
  });

  const attachments: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
    contentId?: string;
  }> = [
    {
      filename: `${params.ticket.ticketId}-qr.png`,
      content: qrBuffer,
      contentType: "image/png",
      contentId: qrCid,
    },
    {
      filename: `${params.ticket.ticketId}-afro-kravings-pass.html`,
      content: Buffer.from(printableHtml, "utf-8"),
      contentType: "text/html",
    },
  ];

  if (logoBuffer) {
    attachments.unshift({
      filename: "afro-kravings-logo.png",
      content: logoBuffer,
      contentType: "image/png",
      contentId: logoCid,
    });
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from: getResendFromEmail(),
    to: [params.recipientEmail],
    subject: `Your Official Pass · Jingle Bells with Joe (${params.ticket.ticketId})`,
    html: emailHtml,
    attachments,
  });

  if (error || !data?.id) {
    throw new Error(error?.message || "Resend failed to dispatch the ticket email.");
  }

  return { messageId: data.id };
}
