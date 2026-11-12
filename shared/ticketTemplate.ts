export interface TicketPassData {
  ticketId: string;
  attendeeName: string;
  attendeeEmail: string | null;
  approvedAt?: string | null;
}

export function escapeHtml(value: string | null | undefined): string {
  return String(value ?? "").replace(/[&<>"']/g, character => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[character] ?? character;
  });
}

function buildCoreTicketCardMarkup(params: {
  ticket: TicketPassData;
  qrSrc: string;
  logoSrc: string;
  forEmail?: boolean;
}) {
  const { ticket, qrSrc, logoSrc, forEmail = false } = params;
  const attendeeName = escapeHtml(ticket.attendeeName);
  const attendeeEmail = escapeHtml(ticket.attendeeEmail ?? "Guest on file");
  const ticketId = escapeHtml(ticket.ticketId);
  const approvedLabel = ticket.approvedAt
    ? escapeHtml(
        new Date(ticket.approvedAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
      )
    : "Verified & Paid";

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
                AK-026 · ADMIT ONE
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
          The Afro Kravingz Presents · Official Entry Pass
        </div>
        <div style="font-family:Georgia,'Times New Roman',serif;font-size:38px;line-height:1.05;font-weight:700;color:#fffaf3;margin:0;">
          Jingle Bells <span style="color:#efbe84;font-style:italic;font-weight:400;">with Joe.</span>
        </div>
        <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#ebd7c7;margin-top:8px;">
          Saturday, 19 December 2026 &nbsp;·&nbsp; Bradford BD1 2BA
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
                &#10003; Payment Confirmed · £25
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
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#5c3b31;margin-top:2px;">Doors 2:00 PM · Buffet 3:00 PM</div>
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
              <div style="font-family:Arial,Helvetica,sans-serif;font-size:13px;font-weight:600;color:#2f4c27;margin-top:4px;">${approvedLabel} · £25 Paid</div>
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
          Jollof, Fried, Native &amp; White Rice &nbsp;·&nbsp; Bitterleaf, Fisherman Okro &amp; Nsala Soup &nbsp;·&nbsp; Abacha, Nkwobi &amp; Moi-Moi &nbsp;·&nbsp; Chicken, Turkey, Croaker Fish &amp; Assorted Meats &nbsp;·&nbsp; Spiced Zobo Welcome &amp; Live Highlife
        </div>
      </td>
    </tr>

    <!-- Footer House Policy -->
    <tr>
      <td style="padding:18px 32px;background-color:#241014;color:#d8baa8;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tr>
            <td align="left" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;color:#d8baa8;">
              <strong style="color:#efbe84;">No-kids buffet:</strong> Adults &amp; parents warmly invited — please keep kids at home or with guardians.
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

export function buildPrintableTicketHtml(params: {
  ticket: TicketPassData;
  qrDataUrl: string;
  logoSrc: string;
}): string {
  const { ticket, qrDataUrl, logoSrc } = params;
  const ticketId = escapeHtml(ticket.ticketId);
  const card = buildCoreTicketCardMarkup({
    ticket,
    qrSrc: qrDataUrl,
    logoSrc,
    forEmail: false,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${ticketId} — Afro Kravings · Jingle Bells with Joe</title>
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

export function buildTicketEmailHtml(params: {
  ticket: TicketPassData;
  qrCid: string;
  logoCid: string;
}): string {
  const { ticket, qrCid, logoCid } = params;
  const attendeeName = escapeHtml(ticket.attendeeName);
  const card = buildCoreTicketCardMarkup({
    ticket,
    qrSrc: `cid:${qrCid}`,
    logoSrc: `cid:${logoCid}`,
    forEmail: true,
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Your Afro Kravings Entry Pass — ${escapeHtml(ticket.ticketId)}</title>
  </head>
  <body style="margin:0;padding:0;background-color:#f4eadc;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f4eadc;padding:28px 14px 40px;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:640px;margin:0 auto 16px;">
            <tr>
              <td style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#241014;padding:0 4px;">
                Hello <strong>${attendeeName}</strong>,<br />
                Your <strong>£25</strong> payment has been verified and confirmed. Here is your official entry pass for <strong>Jingle Bells with Joe</strong> on <strong>Saturday, 19 December 2026</strong> — we’ve also attached a printable copy to this email.
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
