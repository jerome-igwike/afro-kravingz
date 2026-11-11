import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { ArrowRight, Check, ChevronDown, Download, Menu, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

const eventDetails = { date: "Sunday, 20 December 2026", time: "Doors 2:00 PM · Buffet 3:00 PM", place: "1 High Point, New John Street, Bradford BD1 2BA", price: "£30" };
const paymentLink = "https://monzo.me/joenkemakosi?h=5WqWwn&account_type=personal";
function initials(name: string) { return name.split(" ").map(part => part[0]).join("").slice(0, 2).toUpperCase(); }
function escapeHtml(value: string | null | undefined) { return String(value ?? "").replace(/[&<>\"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character); }

function ticketMarkup(ticket: { ticketId: string; attendeeName: string; attendeeEmail: string | null }, qrDataUrl: string) {
  const attendeeName = escapeHtml(ticket.attendeeName), attendeeEmail = escapeHtml(ticket.attendeeEmail ?? "On file"), ticketId = escapeHtml(ticket.ticketId);
  return `<!doctype html><html><head><meta charset="utf-8"/><title>${ticketId} — Jingle Bells with Joe · Pass</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Plus+Jakarta+Sans:wght@500;700;800&family=JetBrains+Mono:wght@600&display=swap" rel="stylesheet"><style>body{margin:0;background:#f5eee5;color:#241014;font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,sans-serif;padding:32px;-webkit-font-smoothing:antialiased}.ticket{max-width:720px;margin:auto;background:#fffdf8;border:2px solid #241014;overflow:hidden;box-shadow:0 24px 60px rgba(36,16,20,.14)}.top{padding:38px 42px;background:#48151a;color:#fffdf8;display:flex;justify-content:space-between;align-items:center;gap:20px}.seal{width:62px;height:62px;background:#cf4035;border:2px solid #efbe84;color:#fffdf8;display:grid;place-items:center;font-weight:800;font-size:20px;letter-spacing:.05em}.eyebrow{letter-spacing:.18em;text-transform:uppercase;font-size:12px;font-weight:700;color:#efbe84}.h1{font-size:44px;line-height:1.06;margin:8px 0 0;font-family:'Playfair Display',Georgia,serif;font-weight:700}.body{padding:34px 42px}.entry{display:flex;align-items:center;justify-content:space-between;gap:25px;padding-bottom:26px;border-bottom:1.5px solid #eadfd2}.entry img{width:136px;height:136px;padding:8px;background:#fff;border:1.5px solid #241014}.row{display:flex;justify-content:space-between;gap:20px;padding:18px 0;border-bottom:1px solid #eadfd2}.label{font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#724c3a}.value{font-size:17px;font-weight:700;margin-top:5px;color:#241014}.id{font-family:'JetBrains Mono',monospace;letter-spacing:.06em;color:#cf4035;font-size:16px}.footer{padding:24px 42px;background:#f2e9dc;color:#5c3b31;font-size:13px;font-weight:600;line-height:1.5;display:flex;justify-content:space-between;align-items:center}</style></head><body><main class="ticket"><div class="top"><div><div class="eyebrow">The Afro Kravingz presents</div><div class="h1">Jingle Bells<br/>with Joe.</div></div><div class="seal">AK</div></div><div class="body"><div class="entry"><div><div class="label">Official Entry Pass</div><div class="value">Show this QR code at the door</div></div><img src="${qrDataUrl}" alt="Entry QR code" /></div><div class="row"><div><div class="label">Guest</div><div class="value">${attendeeName}</div></div><div><div class="label">Pass type</div><div class="value">Nigerian Buffet Experience</div></div></div><div class="row"><div><div class="label">Date</div><div class="value">Sunday, 20 December 2026</div></div><div><div class="label">Time</div><div class="value">Doors 2:00 PM · Buffet 3:00 PM</div></div></div><div class="row"><div><div class="label">Email</div><div class="value">${attendeeEmail}</div></div><div><div class="label">Ticket ID</div><div class="value id">${ticketId}</div></div></div></div><div class="footer"><span>Keep this pass handy on your device or in print.</span><strong>Afro Kravings · Bradford BD1 2BA</strong></div></main></body></html>`;
}

export default function Home() {
  const reserveMutation = trpc.event.reserveGuestPass.useMutation();
  const guestListMutation = trpc.waitlist.join.useMutation();
  const [selectedPackage, setSelectedPackage] = useState("jollof");
  const [guestPass, setGuestPass] = useState<Awaited<ReturnType<typeof reserveMutation.mutateAsync>> | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestListDone, setGuestListDone] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveError, setReserveError] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const ticket = guestPass?.ticket ?? null;
  const chosenPackage = { name: "The Complete Nigerian Buffet Pass", price: "£30" };

  useEffect(() => {
    if (!ticket) { setQrCodeUrl(""); return; }
    QRCode.toDataURL(ticket.ticketId, { width: 220, margin: 1, color: { dark: "#321d18", light: "#fffdf8" } }).then(setQrCodeUrl).catch(() => setQrCodeUrl(""));
  }, [ticket]);
  const ticketUrl = useMemo(() => {
    if (!ticket || !qrCodeUrl) return null;
    return URL.createObjectURL(new Blob([ticketMarkup(ticket, qrCodeUrl)], { type: "text/html" }));
  }, [ticket, qrCodeUrl]);

  const handleGuestList = async (event: React.FormEvent) => {
    event.preventDefault();
    try { await guestListMutation.mutateAsync({ name: guestName, email: guestEmail }); setGuestListDone(true); } catch { /* inline error remains visible */ }
  };
  const handleReserve = async () => {
    if (!guestName.trim() || !guestEmail.trim()) { setReserveError("Add your name and email so we can create your QR pass."); return; }
    try {
      setReserveError("");
      const result = await reserveMutation.mutateAsync({ name: guestName, email: guestEmail });
      localStorage.setItem("afro-kravings-pending-order", JSON.stringify({ name: guestName.trim(), email: guestEmail.trim().toLowerCase(), ticketId: result.ticket?.ticketId ?? "", createdAt: new Date().toISOString(), paymentStatus: "pending", confirmationStatus: "not_sent" }));
      toast.success("Reservation received", { description: "Please complete the £30 Monzo payment. We’ll confirm your place by email after approval." });
      setGuestPass(result);
      setReserveOpen(false);
      setTimeout(() => document.getElementById("my-pass")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch (error) {
      setReserveError(error instanceof Error ? error.message : "We couldn’t create your entry pass just now. Please try again.");
    }
  };
  const downloadTicket = () => { if (!ticketUrl || !ticket) return; const anchor = document.createElement("a"); anchor.href = ticketUrl; anchor.download = `${ticket.ticketId}-afro-kravings-buffet.html`; anchor.click(); };
  const downloadQrImage = () => { if (!qrCodeUrl || !ticket) return; const anchor = document.createElement("a"); anchor.href = qrCodeUrl; anchor.download = `${ticket.ticketId}-entry-qr.png`; anchor.click(); };

  return <div className="site-shell reference-site">
    <header className="reference-header"><a className="reference-brand" href="#top"><img className="reference-logo" src="/assets/afro-kravings-logo-trimmed.png" alt="Afro Kravings" /></a><span className="nav-context">JINGLE BELLS WITH JOE<br /><strong>20 DEC · BRADFORD</strong></span><nav className={mobileOpen ? "reference-nav is-open" : "reference-nav"}><a href="#packages"><span>01</span> The menu</a><a href="#how-it-works"><span>02</span> The day</a><a href="#order"><span>03</span> The pass</a><a href="#details"><span>04</span> Find us</a></nav><div className="reference-actions"><a className="reference-login" href="#order">£30 / Take a seat</a><button className="mobile-menu reference-menu" onClick={() => setMobileOpen(open => !open)} aria-label="Toggle navigation">{mobileOpen ? <X size={20} /> : <Menu size={20} />}</button></div></header>
    <main id="top">
      <section className="studio-opening" aria-label="Afro Kravings Jingle Bells with Joe Nigerian Buffet">
        <div className="opening-topline">
          <span>THE AFRO KRAVINGZ / AK-026</span>
          <span className="topline-center"><img src="/assets/holiday/holly-pine-bow.png" alt="Christmas Holly" className="topline-holly" /> JINGLE BELLS WITH JOE</span>
          <span>ONE EQUAL PASS · £30</span>
        </div>
        <div className="studio-opening-grid">
          <div className="studio-opening-copy">
            <span className="reference-kicker">The Afro Kravingz presents</span>
            <div className="title-with-hat">
              <img src="/assets/holiday/santa-hat.png" alt="Santa Hat" className="festive-santa-hat" />
              <h1>Jingle Bells<br /><em>with Joe.</em></h1>
            </div>
            <div className="event-date-lockup">
              <span>SUNDAY</span>
              <strong>20 DECEMBER 2026</strong>
              <small>DOORS 2:00 PM · BUFFET 3:00 PM</small>
            </div>
            <p>A joyful Nigerian buffet made for sharing: generous plates, comforting soups, and the flavours of home. Come hungry and settle in around the table.</p>
            <div className="opening-actions">
              <a className="opening-link" href="#order">Take your seat <ArrowRight size={15} /></a>
              <a className="opening-text-link" href="#packages">Read the menu</a>
            </div>
          </div>
          <div className="pass-marker">
            <span className="pass-marker-label">ENTRY / 01</span>
            <div className="pass-marker-price">£30</div>
            <strong>ONE-TIME<br />BUFFET PASS</strong>
            <div className="pass-marker-rule" />
            <span>RICE · SOUPS<br />& MORE</span>
            <span>DOORS 14:00<br />BUFFET 15:00</span>
            <div className="pass-marker-stamp">AK<br /><small>BRADFORD</small></div>
          </div>
        </div>
        <div className="opening-ticker">
          <span>JOLLOF RICE</span>
          <span>BITTERLEAF SOUP</span>
          <span>FISHERMAN OKRO</span>
          <span>NKWOBI</span>
          <span>MOI-MOI</span>
        </div>
      </section>

      <section className="feast-index" aria-label="A taste of the Nigerian buffet">
        <div className="feast-index-heading">
          <span>02 / A taste of the table</span>
          <p>Real plates. Big flavour.<br />A little preview of what’s coming.</p>
        </div>
        <div className="feast-photo-rail">
          <figure><img src="/assets/menu/02-food-reference.webp" alt="Grilled assorted meats with onions and spice" /><figcaption><strong>01</strong> Assorted meats</figcaption></figure>
          <figure><img src="/assets/menu/03-food-reference.webp" alt="Grilled croaker fish with plantain" /><figcaption><strong>02</strong> Croaker fish</figcaption></figure>
          <figure><img src="/assets/menu/04-food-reference.webp" alt="White rice with vegetable sauce and chicken" /><figcaption><strong>03</strong> Rice & sauce</figcaption></figure>
          <figure><img src="/assets/menu/05-food-reference.webp" alt="Fried rice with grilled chicken" /><figcaption><strong>04</strong> Fried rice</figcaption></figure>
        </div>
      </section>

      <section className="reference-steps" id="how-it-works">
        <div><span className="step-icon">♜</span><span><strong>Claim One Equal Pass</strong><small>£30 per guest. One generous Nigerian buffet experience.</small></span></div>
        <div><span className="step-icon">▤</span><span><strong>Come To The Table</strong><small>Rice dishes, traditional soups, proteins and more.</small></span></div>
        <div><span className="step-icon">▣</span><span><strong>Get Your QR Pass</strong><small>Show your digital entry pass at 1 High Point, Bradford.</small></span></div>
      </section>

      <section className="buffet-list-section" id="packages">
        <div className="reference-section-heading buffet-heading-flex">
          <div>
            <span className="reference-kicker dark-kicker">01 / The menu</span>
            <h2>Nigerian buffet.<br /><em>One pass.</em></h2>
          </div>
          <div className="festive-cloche-wrap">
            <img src="/assets/holiday/golden-cloche.png" alt="Grand Nigerian Feast Cloche" className="festive-cloche-img" />
          </div>
          <p>Everything listed is included in your £30 buffet pass. From fragrant rice dishes to deep, comforting soups and classic Nigerian favourites.</p>
        </div>
        <div className="buffet-list">
          <article><span>RICE</span><div><h3>Nigerian Jollof Rice</h3><p>Rich, smoky and warmly spiced.</p></div><b>RICE DISHES</b></article>
          <article><span>RICE</span><div><h3>Fried Rice</h3><p>Colourful, savoury and generously packed.</p></div><b>RICE DISHES</b></article>
          <article><span>RICE</span><div><h3>Native Rice</h3><p>Traditional Nigerian flavour in every spoonful.</p></div><b>RICE DISHES</b></article>
          <article><span>RICE</span><div><h3>White Rice & Vegetable Sauce</h3><p>A comforting classic with a fresh, rich sauce.</p></div><b>RICE DISHES</b></article>
          <article><span>SOUP</span><div><h3>Bitterleaf Soup (Onugbu)</h3><p>Served with pounded yam or semovita.</p></div><b>TRADITIONAL SOUP</b></article>
          <article><span>SOUP</span><div><h3>Oha Soup</h3><p>Served with pounded yam or semovita.</p></div><b>TRADITIONAL SOUP</b></article>
          <article><span>SOUP</span><div><h3>Egusi Soup</h3><p>Served with pounded yam or semovita.</p></div><b>TRADITIONAL SOUP</b></article>
          <article><span>SOUP</span><div><h3>Fisherman Okro Soup</h3><p>Served with pounded yam or semovita.</p></div><b>SEAFOOD SPECIAL</b></article>
          <article><span>SOUP</span><div><h3>Nsala Soup</h3><p>Served with pounded yam or semovita.</p></div><b>TRADITIONAL SOUP</b></article>
          <article><span>MORE</span><div><h3>Abacha · Ukwa · Nkwobi</h3><p>Beloved Nigerian favourites, ready for the table.</p></div><b>CLASSICS</b></article>
          <article><span>MORE</span><div><h3>Proteins</h3><p>Chicken, turkey, croaker fish and assorted meats.</p></div><b>FROM THE KITCHEN</b></article>
          <article><span>MORE</span><div><h3>Moi-Moi</h3><p>Soft, savoury and made for a generous helping.</p></div><b>FAVOURITE</b></article>
        </div>
      </section>

      <section className="order-section" id="order">
        <div className="order-shell">
          <div className="order-copy">
            <div className="order-copy-top">
              <span className="reference-kicker">03 / Reserve your table</span>
              <img src="/assets/holiday/gift-box.png" alt="Christmas gift pass" className="festive-gift-img" />
            </div>
            <h2>Place your<br /><em>order.</em></h2>
            <p>One payment reserves your place at The Afro Kravingz presents Jingle Bells with Joe Nigerian Buffet. No tiers, no account, no fuss.</p>
            <div className="order-date">
              <span>Event details</span>
              <strong>{eventDetails.date}</strong>
              <small>{eventDetails.time}</small>
              <small>{eventDetails.place}</small>
            </div>
          </div>
          <div className="order-panel">
            <div className="order-panel-heading"><span>One equal buffet pass</span><span>£30 per guest</span></div>
            <div className="order-options">
              <div className="pass-option">
                <span className="pass-option-number">AK / 01</span>
                <span className="order-option-copy"><strong>The Complete Nigerian Buffet Pass</strong><small>Rice, soups, proteins & Nigerian favourites</small></span>
                <b>£30</b>
              </div>
            </div>
            <div className="order-summary">
              <span><small>One equal pass includes</small><strong>Full Nigerian buffet + live music</strong></span>
              <span><small>Total</small><strong>£30 / guest</strong></span>
            </div>
            <button className="reference-primary order-button" onClick={() => { setReserveError(""); setReserveOpen(true); }} disabled={reserveMutation.isPending}>{reserveMutation.isPending ? "Creating your pass…" : "Reserve my £30 pass"} <ArrowRight size={15} /></button>
            <div className="payment-card">
              <div>
                <span className="payment-kicker">STEP 02 / PAY AFTER RESERVING</span>
                <h3>Send £30 via Monzo</h3>
                <p>Use the link or scan the QR. Put your name in the payment note so we can match it to your reservation.</p>
                <a href={paymentLink} target="_blank" rel="noreferrer">Open Monzo payment link <ArrowRight size={14} /></a>
              </div>
              <img src="/assets/payment/monzo-qr.jpg" alt="Scan to pay £30 via Monzo to joenkemakosi" />
            </div>
            <small className="order-note">Your place is confirmed after payment verification. Show your digital QR pass at the entrance on the day.</small>
          </div>
        </div>
      </section>

      <section className="facts-section" id="details">
        <div className="facts-heading">
          <div className="facts-heading-left">
            <span className="reference-kicker dark-kicker">What your £30 includes</span>
            <h2>One table.<br /><em>Everyone equal.</em></h2>
          </div>
          <div className="festive-bauble-wrap">
            <img src="/assets/holiday/christmas-bauble.png" alt="Christmas Ornament" className="festive-bauble-img" />
          </div>
        </div>
        <div className="facts-grid">
          <div><strong>RICE</strong><span>rice dishes, soups<br />and Nigerian favourites</span></div>
          <div><strong>02:00</strong><span>doors open with<br />spiced Zobo mocktail</span></div>
          <div><strong>LIVE</strong><span>Highlife, carols<br />and acoustic music</span></div>
          <div><strong>SOUP</strong><span>served with pounded yam<br />or semovita</span></div>
          <div><strong>U5</strong><span>children under five<br />attend free with adult</span></div>
          <div><strong>BD1</strong><span>1 High Point, New<br />John Street, Bradford</span></div>
        </div>
      </section>

      <section className="guest-list-section">
        <div className="guest-list-header">
          <div>
            <span className="reference-kicker dark-kicker">Before you arrive</span>
            <h2>Come hungry.<br /><em>Leave glowing.</em></h2>
          </div>
          <div className="festive-gingerbread-wrap">
            <img src="/assets/holiday/gingerbread-man.png" alt="Gingerbread Festive Treat" className="festive-gingerbread-img" />
          </div>
        </div>
        {guestListDone ? (
          <div className="guest-success">
            <Check size={18} />
            <strong>You’re on the guest list.</strong>
            <span>We’ll send Afro Kravings buffet updates to your inbox.</span>
          </div>
        ) : (
          <form className="guest-form" onSubmit={handleGuestList}>
            <Input value={guestName} onChange={event => setGuestName(event.target.value)} placeholder="Your name" required />
            <Input type="email" value={guestEmail} onChange={event => setGuestEmail(event.target.value)} placeholder="Your email" required />
            <Button type="submit" disabled={guestListMutation.isPending}>{guestListMutation.isPending ? "Saving…" : "Join guest list"} <ArrowRight size={15} /></Button>
            {guestListMutation.error ? <small>{guestListMutation.error.message}</small> : null}
          </form>
        )}
      </section>

      {ticket ? <section className="pass-section reference-pass" id="my-pass"><div className="pass-heading"><div><span className="reference-kicker dark-kicker">Your order</span><h2>Your pass is<br /><em>ready.</em></h2></div><p>Show this QR code at the door. No account needed.</p></div><div className="ticket-confirmation reference-ticket"><div className="confirmation-top"><span className="success-badge"><Check size={14} /> Confirmed</span><span className="ticket-id">{ticket.ticketId}</span></div><div className="ticket-content"><div><h3>Jingle Bells with Joe · Nigerian Buffet Pass</h3><p>Reserved for {ticket.attendeeName}. Your unique entry code is ready to use.</p></div>{qrCodeUrl ? <div className="qr-preview"><img src={qrCodeUrl} alt="Your unique entry QR code" /><span><QrCode size={13} /> Scan to enter</span></div> : null}</div><div className="ticket-actions"><button className="reference-primary" onClick={downloadTicket} disabled={!ticketUrl}><Download size={16} /> Download ticket</button><button className="reference-secondary dark-button" onClick={downloadQrImage} disabled={!qrCodeUrl}><QrCode size={16} /> Save QR image</button></div></div></section> : null}
    </main>

    <footer className="reference-footer"><a className="reference-brand" href="#top"><img className="reference-logo" src="/assets/afro-kravings-logo-trimmed.png" alt="Afro Kravings" /></a><p>Come hungry. Leave glowing.</p><div><a href="#details">Guest information <ArrowRight size={14} /></a></div></footer>
    {reserveOpen ? <div className="modal-backdrop" role="presentation" onClick={() => setReserveOpen(false)}><div className="reserve-modal reference-modal" role="dialog" aria-modal="true" aria-labelledby="reserve-title" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setReserveOpen(false)} aria-label="Close"><X size={18} /></button><span className="reference-kicker dark-kicker">One equal pass</span><h2 id="reserve-title">Claim your<br /><em>place.</em></h2><p>Enter your details and we’ll create your digital QR entry pass immediately.</p><div className="modal-summary"><span><small>Pass</small>The Complete Buffet Pass</span><span><small>Total</small>£30 / guest</span></div><div className="guest-fields"><label>Your name<Input value={guestName} onChange={event => setGuestName(event.target.value)} placeholder="e.g. Samuel Adeyemi" /></label><label>Your email<Input type="email" value={guestEmail} onChange={event => setGuestEmail(event.target.value)} placeholder="e.g. samuel@example.com" /></label></div><p className="modal-note">One payment covers the full Nigerian buffet, rice dishes, traditional soups, proteins, and dessert treats, and your QR entry pass.</p>{reserveError ? <p className="modal-error">{reserveError}</p> : null}<Button className="form-submit" onClick={handleReserve} disabled={reserveMutation.isPending}>{reserveMutation.isPending ? "Creating your pass…" : "Create my QR pass"} <ArrowRight size={17} /></Button></div></div> : null}
  </div>;
}
