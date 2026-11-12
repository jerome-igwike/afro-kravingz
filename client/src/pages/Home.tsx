import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { buildPrintableTicketHtml } from "@shared/ticketTemplate";
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Maximize2,
  Menu,
  QrCode,
  RefreshCw,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type PaymentStatus = "pending" | "approved" | "rejected";
type ConfirmationStatus = "not_sent" | "sent" | "failed";

interface ReservationRecord {
  id: number;
  ticketId: string;
  attendeeName: string;
  attendeeEmail: string;
  amountPence: number;
  paymentReference: string | null;
  paymentStatus: PaymentStatus;
  confirmationStatus: ConfirmationStatus;
  approvedAt: string | null;
  emailSentAt: string | null;
  createdAt: string;
}

const LAST_RESERVATION_STORAGE_KEY = "afro-kravings-last-reservation";

const eventDetails = {
  date: "Saturday, 19 December 2026",
  time: "Doors 2:00 PM · Buffet 3:00 PM",
  place: "1 High Point, New John Street, Bradford BD1 2BA",
  price: "£25",
};
const paymentLink = "https://monzo.me/joenkemakosi?h=5WqWwn&account_type=personal";
const feastPreviews = [
  {
    id: "01",
    src: "/assets/menu/02-food-reference.webp",
    title: "Assorted meats",
    alt: "Grilled assorted meats with onions and spice",
    caption: "Charred assorted beef cuts finished with sliced red onions and warm suya spice.",
  },
  {
    id: "02",
    src: "/assets/menu/03-food-reference.webp",
    title: "Croaker fish",
    alt: "Grilled croaker fish with plantain",
    caption: "Whole grilled croaker glazed in rich pepper sauce with sweet fried plantain.",
  },
  {
    id: "03",
    src: "/assets/menu/04-food-reference.webp",
    title: "Rice & sauce",
    alt: "White rice with vegetable sauce and chicken",
    caption: "Fluffy white rice paired with slow-simmered tomato pepper sauce and spiced chicken.",
  },
  {
    id: "04",
    src: "/assets/menu/05-food-reference.webp",
    title: "Fried rice",
    alt: "Fried rice with grilled chicken",
    caption: "Seasoned Nigerian fried rice served with smoky grilled chicken and fresh slaw.",
  },
] as const;

async function fetchLogoDataUrl(): Promise<string> {
  const fallback = `${window.location.origin}/assets/afro-kravings-logo-ticket.png`;
  try {
    const response = await fetch("/assets/afro-kravings-logo-ticket.png");
    if (!response.ok) return fallback;
    const blob = await response.blob();
    return await new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : fallback);
      reader.onerror = () => resolve(fallback);
      reader.readAsDataURL(blob);
    });
  } catch {
    return fallback;
  }
}

export default function Home() {
  const [reservation, setReservation] = useState<ReservationRecord | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [paymentNote, setPaymentNote] = useState("");
  const [reservePending, setReservePending] = useState(false);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const [guestListPending, setGuestListPending] = useState(false);
  const [guestListDone, setGuestListDone] = useState(false);
  const [guestListError, setGuestListError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [reserveOpen, setReserveOpen] = useState(false);
  const [reserveError, setReserveError] = useState("");
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const activePreview = previewIndex !== null ? feastPreviews[previewIndex] : null;
  const hasBlockingOverlay = previewIndex !== null || reserveOpen || mobileOpen;
  const smartsuppHiddenRef = useRef(false);

  useEffect(() => {
    const win = window as Window & { smartsupp?: (...args: unknown[]) => void };
    if (hasBlockingOverlay) {
      win.smartsupp?.("chat:hide");
      smartsuppHiddenRef.current = true;
    } else if (smartsuppHiddenRef.current) {
      win.smartsupp?.("chat:show");
      smartsuppHiddenRef.current = false;
    }
  }, [hasBlockingOverlay]);

  useEffect(() => {
    const modalOpen = previewIndex !== null || reserveOpen;
    if (!modalOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [previewIndex, reserveOpen]);

  useEffect(() => {
    if (!reserveOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReserveOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [reserveOpen]);

  useEffect(() => {
    if (previewIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewIndex(null);
      else if (event.key === "ArrowRight") setPreviewIndex(idx => (idx === null ? 0 : (idx + 1) % feastPreviews.length));
      else if (event.key === "ArrowLeft") setPreviewIndex(idx => (idx === null ? 0 : (idx - 1 + feastPreviews.length) % feastPreviews.length));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [previewIndex]);

  const refreshReservationStatus = useCallback(
    async (email: string, ticketId: string, silent = false) => {
      if (!silent) setCheckingStatus(true);
      try {
        const params = new URLSearchParams({ email, ticketId });
        const response = await fetch(`/api/reservations?${params.toString()}`, {
          cache: "no-store",
        });
        const data = (await response.json()) as {
          ok?: boolean;
          reservation?: ReservationRecord;
          error?: string;
        };
        if (response.ok && data.ok && data.reservation) {
          setReservation(prev => {
            if (prev?.paymentStatus !== "approved" && data.reservation?.paymentStatus === "approved" && !silent) {
              toast.success("Payment approved!", {
                description: `Your official QR pass (${data.reservation.ticketId}) is unlocked and ready.`,
              });
            }
            return data.reservation ?? null;
          });
          return data.reservation;
        }
        if (response.status === 404) {
          localStorage.removeItem(LAST_RESERVATION_STORAGE_KEY);
          setReservation(null);
        } else if (!silent && data.error) {
          toast.error(data.error);
        }
      } catch {
        if (!silent) toast.error("Could not reach the server to check status.");
      } finally {
        if (!silent) setCheckingStatus(false);
      }
      return null;
    },
    [],
  );

  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_RESERVATION_STORAGE_KEY);
      if (!saved) return;
      const parsed = JSON.parse(saved) as { email?: string; ticketId?: string };
      if (parsed.email && parsed.ticketId) {
        void refreshReservationStatus(parsed.email, parsed.ticketId, true);
      }
    } catch {
      /* ignore malformed storage */
    }
  }, [refreshReservationStatus]);

  useEffect(() => {
    if (!reservation || reservation.paymentStatus !== "approved") {
      setQrCodeUrl("");
      return;
    }
    QRCode.toDataURL(reservation.ticketId, {
      width: 280,
      margin: 2,
      color: { dark: "#241014", light: "#ffffff" },
    })
      .then(setQrCodeUrl)
      .catch(() => setQrCodeUrl(""));
  }, [reservation]);

  const handleGuestList = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = guestName.trim();
    const normalizedEmail = guestEmail.trim().toLowerCase();
    if (trimmedName.length < 2) {
      setGuestListError("Please add your name.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setGuestListError("Please use a valid email.");
      return;
    }
    setGuestListError("");
    setGuestListPending(true);
    try {
      const response = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: normalizedEmail }),
      });
      const data = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !data.ok) {
        setGuestListError(data.error || "Could not save your details right now.");
        return;
      }
      setGuestListDone(true);
      toast.success("You’re on the guest list");
    } catch {
      setGuestListError("Could not reach the server right now. Please try again.");
    } finally {
      setGuestListPending(false);
    }
  };

  const handleReserve = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const trimmedName = guestName.trim();
    const normalizedEmail = guestEmail.trim().toLowerCase();
    if (trimmedName.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setReserveError("Add a valid name and email so we can log your seat and email your pass once verified.");
      return;
    }
    setReserveError("");
    setReservePending(true);
    try {
      const response = await fetch("/api/reservations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          email: normalizedEmail,
          paymentReference: paymentNote.trim() || undefined,
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        alreadyExists?: boolean;
        reservation?: ReservationRecord;
        error?: string;
      };
      if (!response.ok || !data.ok || !data.reservation) {
        setReserveError(data.error || "We couldn’t log your reservation just now. Please try again.");
        return;
      }
      const next = data.reservation;
      localStorage.setItem(
        LAST_RESERVATION_STORAGE_KEY,
        JSON.stringify({ email: next.attendeeEmail, ticketId: next.ticketId }),
      );
      setReservation(next);
      setReserveOpen(false);
      if (next.paymentStatus === "approved") {
        toast.success("Welcome back — your £25 pass is already approved!", {
          description: `Reference ${next.ticketId} is unlocked below.`,
        });
      } else {
        toast.success("Reservation logged as pending", {
          description: `Complete the £25 Monzo transfer with ref ${next.ticketId}. Once confirmed, we’ll email your QR pass.`,
        });
      }
      setTimeout(() => document.getElementById("my-pass")?.scrollIntoView({ behavior: "smooth" }), 80);
    } catch {
      setReserveError("Network error while logging reservation. Please try again.");
    } finally {
      setReservePending(false);
    }
  };

  const downloadTicket = async () => {
    if (!reservation || reservation.paymentStatus !== "approved" || !qrCodeUrl) return;
    const logoSrc = await fetchLogoDataUrl();
    const html = buildPrintableTicketHtml({
      ticket: {
        ticketId: reservation.ticketId,
        attendeeName: reservation.attendeeName,
        attendeeEmail: reservation.attendeeEmail,
        approvedAt: reservation.approvedAt,
      },
      qrDataUrl: qrCodeUrl,
      logoSrc,
    });
    const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    const anchor = document.createElement("a");
    anchor.href = blobUrl;
    anchor.download = `${reservation.ticketId}-afro-kravings-pass.html`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 2500);
  };

  const downloadQrImage = () => {
    if (!qrCodeUrl || !reservation || reservation.paymentStatus !== "approved") return;
    const anchor = document.createElement("a");
    anchor.href = qrCodeUrl;
    anchor.download = `${reservation.ticketId}-entry-qr.png`;
    anchor.click();
  };

  return (
    <div className="site-shell reference-site">
      <header className="reference-header">
        <a className="reference-brand" href="#top">
          <img className="reference-logo" src="/assets/afro-kravings-logo-trimmed.png" alt="Afro Kravings" />
        </a>
        <span className="nav-context">
          JINGLE BELLS WITH JOE
          <br />
          <strong>19 DEC · BRADFORD</strong>
        </span>
        <nav className={mobileOpen ? "reference-nav is-open" : "reference-nav"}>
          <a href="#packages" onClick={() => setMobileOpen(false)}>
            <span>01</span> The menu
          </a>
          <a href="#how-it-works" onClick={() => setMobileOpen(false)}>
            <span>02</span> The day
          </a>
          <a href="#order" onClick={() => setMobileOpen(false)}>
            <span>03</span> The pass
          </a>
          <a href="#details" onClick={() => setMobileOpen(false)}>
            <span>04</span> Find us
          </a>
        </nav>
        <div className="reference-actions">
          <a className="reference-login" href="#order">
            £25 / Take a seat
          </a>
          <button
            className="mobile-menu reference-menu"
            onClick={() => setMobileOpen(open => !open)}
            aria-label="Toggle navigation"
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </header>

      <main id="top">
        <section className="studio-opening" aria-label="Afro Kravings Jingle Bells with Joe Nigerian Buffet">
          <div className="opening-topline">
            <span>THE AFRO KRAVINGZ / AK-026</span>
            <span className="topline-center">
              <img src="/assets/holiday/holly-pine-bow.png" alt="Christmas Holly" className="topline-holly" /> JINGLE BELLS WITH JOE
            </span>
            <span>ONE EQUAL PASS · £25</span>
          </div>
          <div className="studio-opening-grid">
            <div className="studio-opening-copy">
              <span className="reference-kicker">The Afro Kravingz presents</span>
              <div className="title-with-hat">
                <img src="/assets/holiday/santa-hat.png" alt="Santa Hat" className="festive-santa-hat" />
                <h1>
                  Jingle Bells
                  <br />
                  <em>
                    with <span className="hero-joe">Joe.</span>
                  </em>
                </h1>
              </div>
              <div className="event-date-lockup">
                <span>SATURDAY</span>
                <strong>19 DECEMBER 2026</strong>
                <small>DOORS 2:00 PM · BUFFET 3:00 PM</small>
              </div>
              <p>
                A joyful Nigerian buffet made for sharing: generous plates, comforting soups, and the flavours of home.
                Come hungry and settle in around the table.
              </p>
              <div className="opening-actions">
                <a className="opening-link" href="#order">
                  Take your seat <ArrowRight size={15} />
                </a>
                <a className="opening-text-link" href="#packages">
                  Read the menu
                </a>
              </div>
            </div>
            <div className="pass-marker">
              <span className="pass-marker-label">ENTRY / 01</span>
              <div className="pass-marker-price">£25</div>
              <strong>
                ONE-TIME
                <br />
                BUFFET PASS
              </strong>
              <div className="pass-marker-rule" />
              <span>
                RICE · SOUPS
                <br />
                &amp; MORE
              </span>
              <span>
                DOORS 14:00
                <br />
                BUFFET 15:00
              </span>
              <div className="pass-marker-stamp">
                AK
                <br />
                <small>BRADFORD</small>
              </div>
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
            <div>
              <span>02 / A taste of the table</span>
              <h3>
                Real plates. <em>Big flavour.</em>
              </h3>
            </div>
            <p>
              The dishes pictured below are a preview of what’s coming to the buffet. Tap any plate to inspect it up
              close.
            </p>
          </div>
          <div className="feast-photo-rail">
            {feastPreviews.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className="feast-photo-card"
                onClick={() => setPreviewIndex(index)}
                aria-label={`Preview ${item.title}`}
              >
                <figure>
                  <img src={item.src} alt={item.alt} />
                  <span className="feast-photo-expand" aria-hidden="true">
                    <Maximize2 size={13} />
                  </span>
                  <figcaption>
                    <strong>{item.id}</strong> {item.title}
                  </figcaption>
                </figure>
              </button>
            ))}
          </div>
        </section>

        <section className="reference-steps" id="how-it-works">
          <div>
            <span className="step-icon">♜</span>
            <span>
              <strong>1. Reserve Your Seat</strong>
              <small>Log your name &amp; email. Your spot enters as pending.</small>
            </span>
          </div>
          <div>
            <span className="step-icon">▤</span>
            <span>
              <strong>2. Send £25 via Monzo</strong>
              <small>Include your name or reference in your Monzo transfer note.</small>
            </span>
          </div>
          <div>
            <span className="step-icon">▣</span>
            <span>
              <strong>3. Receive QR Pass by Email</strong>
              <small>Once our team confirms payment, your official pass lands in your inbox.</small>
            </span>
          </div>
        </section>

        <section className="buffet-list-section" id="packages">
          <div className="reference-section-heading buffet-heading-flex">
            <div>
              <span className="reference-kicker dark-kicker">01 / The menu</span>
              <h2>
                Nigerian buffet.
                <br />
                <em>One pass.</em>
              </h2>
            </div>
            <div className="festive-cloche-wrap">
              <img src="/assets/holiday/golden-cloche.png" alt="Grand Nigerian Feast Cloche" className="festive-cloche-img" />
            </div>
            <p>
              Everything listed is included in your £25 buffet pass. From fragrant rice dishes to deep, comforting soups
              and classic Nigerian favourites.
            </p>
          </div>
          <div className="buffet-list">
            <article>
              <span>RICE</span>
              <div>
                <h3>Nigerian Jollof Rice</h3>
                <p>Rich, smoky and warmly spiced.</p>
              </div>
              <b>RICE DISHES</b>
            </article>
            <article>
              <span>RICE</span>
              <div>
                <h3>Fried Rice</h3>
                <p>Colourful, savoury and generously packed.</p>
              </div>
              <b>RICE DISHES</b>
            </article>
            <article>
              <span>RICE</span>
              <div>
                <h3>Native Rice</h3>
                <p>Traditional Nigerian flavour in every spoonful.</p>
              </div>
              <b>RICE DISHES</b>
            </article>
            <article>
              <span>RICE</span>
              <div>
                <h3>White Rice &amp; Vegetable Sauce</h3>
                <p>A comforting classic with a fresh, rich sauce.</p>
              </div>
              <b>RICE DISHES</b>
            </article>
            <article>
              <span>SOUP</span>
              <div>
                <h3>Bitterleaf Soup (Onugbu)</h3>
                <p>Served with pounded yam or semovita.</p>
              </div>
              <b>TRADITIONAL SOUP</b>
            </article>
            <article>
              <span>SOUP</span>
              <div>
                <h3>Fisherman Okro Soup</h3>
                <p>Served with pounded yam or semovita.</p>
              </div>
              <b>SEAFOOD SPECIAL</b>
            </article>
            <article>
              <span>SOUP</span>
              <div>
                <h3>Nsala Soup</h3>
                <p>Served with pounded yam or semovita.</p>
              </div>
              <b>TRADITIONAL SOUP</b>
            </article>
            <article>
              <span>MORE</span>
              <div>
                <h3>Abacha · Nkwobi</h3>
                <p>Beloved Nigerian favourites, ready for the table.</p>
              </div>
              <b>CLASSICS</b>
            </article>
            <article>
              <span>MORE</span>
              <div>
                <h3>Proteins</h3>
                <p>Chicken, turkey, croaker fish and assorted meats.</p>
              </div>
              <b>FROM THE KITCHEN</b>
            </article>
            <article>
              <span>MORE</span>
              <div>
                <h3>Moi-Moi</h3>
                <p>Soft and savoury.</p>
              </div>
              <b>FAVOURITE</b>
            </article>
          </div>
        </section>

        <section className="order-section" id="order">
          <div className="order-shell">
            <div className="order-copy">
              <div className="order-copy-top">
                <span className="reference-kicker">03 / Reserve your table</span>
                <img src="/assets/holiday/gift-box.png" alt="Christmas gift pass" className="festive-gift-img" />
              </div>
              <h2>
                Place your
                <br />
                <em>order.</em>
              </h2>
              <p>
                Reserve your seat for The Afro Kravingz presents Jingle Bells with Joe, complete your £25 Monzo
                transfer, and receive your official QR entry pass by email once approved.
              </p>
              <div className="order-date">
                <span>Event details</span>
                <strong>{eventDetails.date}</strong>
                <small>{eventDetails.time}</small>
                <small>{eventDetails.place}</small>
              </div>
            </div>
            <div className="order-panel">
              <div className="order-panel-heading">
                <span>One equal buffet pass</span>
                <span>£25 per guest</span>
              </div>
              <div className="order-options">
                <div className="pass-option">
                  <span className="pass-option-number">AK / 01</span>
                  <span className="order-option-copy">
                    <strong>The Complete Nigerian Buffet Pass</strong>
                    <small>Rice, soups, proteins &amp; Nigerian favourites</small>
                  </span>
                  <b>£25</b>
                </div>
              </div>
              <div className="order-summary">
                <span>
                  <small>One equal pass includes</small>
                  <strong>Full Nigerian buffet + live music</strong>
                </span>
                <span>
                  <small>Total</small>
                  <strong>£25 / guest</strong>
                </span>
              </div>
              <button
                className="reference-primary order-button"
                onClick={() => {
                  setReserveError("");
                  setReserveOpen(true);
                }}
                disabled={reservePending}
              >
                {reservePending ? "Logging reservation…" : "Reserve my £25 pass"} <ArrowRight size={15} />
              </button>
              <div className="payment-card">
                <div>
                  <span className="payment-kicker">STEP 02 / PAY AFTER RESERVING</span>
                  <h3>Send £25 via Monzo</h3>
                  <p>
                    Use the link or scan the QR. Put your name or booking reference in the payment note so we can verify
                    and issue your pass fast.
                  </p>
                  <a href={paymentLink} target="_blank" rel="noreferrer">
                    Open Monzo payment link <ArrowRight size={14} />
                  </a>
                </div>
                <img src="/assets/payment/monzo-qr.jpg" alt="Scan to pay £25 via Monzo to joenkemakosi" />
              </div>
              <small className="order-note">
                No-kids-allowed buffet: parents and adults are warmly invited to come have fun, with kids kept at home
                or with guardians. QR passes are issued strictly after manual payment verification.
              </small>
            </div>
          </div>
        </section>

        {reservation ? (
          <section className="pass-section reference-pass" id="my-pass">
            {reservation.paymentStatus === "approved" ? (
              <>
                <div className="pass-heading">
                  <div>
                    <span className="reference-kicker dark-kicker">Approved &amp; Confirmed</span>
                    <h2>
                      Your pass is
                      <br />
                      <em>ready.</em>
                    </h2>
                  </div>
                  <p>
                    Payment confirmed. Present this official Afro Kravings pass or the copy in your email at 1 High
                    Point, Bradford.
                  </p>
                </div>

                <div className="sleek-pass-card">
                  <div className="sleek-pass-top">
                    <img
                      src="/assets/afro-kravings-logo-ticket.png"
                      alt="Afro Kravings"
                      className="sleek-pass-logo"
                    />
                    <span className="sleek-pass-chip">AK-026 · ADMIT ONE</span>
                  </div>
                  <div className="sleek-pass-banner">
                    <span>THE AFRO KRAVINGZ PRESENTS · OFFICIAL ENTRY PASS</span>
                    <h3>
                      Jingle Bells <em>with Joe.</em>
                    </h3>
                    <small>Saturday, 19 December 2026 · Doors 2:00 PM · Buffet 3:00 PM</small>
                  </div>
                  <div className="sleek-pass-body">
                    <div className="sleek-pass-info">
                      <span className="success-badge">
                        <Check size={14} /> Payment Confirmed · £25
                      </span>
                      <div className="sleek-pass-grid">
                        <div>
                          <small>Guest</small>
                          <strong>{reservation.attendeeName}</strong>
                        </div>
                        <div>
                          <small>Ticket ID</small>
                          <strong className="sleek-pass-id">{reservation.ticketId}</strong>
                        </div>
                        <div>
                          <small>Email</small>
                          <strong>{reservation.attendeeEmail}</strong>
                        </div>
                        <div>
                          <small>Venue</small>
                          <strong>1 High Point, Bradford BD1 2BA</strong>
                        </div>
                      </div>
                      <div className="ticket-actions">
                        <button className="reference-primary" onClick={downloadTicket} disabled={!qrCodeUrl}>
                          <Download size={16} /> Download official pass
                        </button>
                        <button className="reference-secondary sleek-pass-outline" onClick={downloadQrImage} disabled={!qrCodeUrl}>
                          <QrCode size={16} /> Save QR image
                        </button>
                      </div>
                    </div>
                    {qrCodeUrl ? (
                      <div className="qr-preview sleek-qr-frame">
                        <img src={qrCodeUrl} alt={`Entry QR code ${reservation.ticketId}`} />
                        <span>
                          <QrCode size={13} /> Scan at door
                        </span>
                      </div>
                    ) : null}
                  </div>
                  <div className="sleek-pass-footer">
                    <span>No-kids buffet · Adults &amp; parents welcome</span>
                    <strong>
                      {reservation.confirmationStatus === "sent"
                        ? `Emailed to ${reservation.attendeeEmail}`
                        : "Ready for door scan"}
                    </strong>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="pass-heading">
                  <div>
                    <span className="reference-kicker dark-kicker">Step 02 · Payment verification</span>
                    <h2>
                      {reservation.paymentStatus === "rejected" ? (
                        <>
                          Payment <em>not matched.</em>
                        </>
                      ) : (
                        <>
                          Awaiting <em>approval.</em>
                        </>
                      )}
                    </h2>
                  </div>
                  <p>
                    {reservation.paymentStatus === "rejected"
                      ? "We couldn’t match a £25 transfer to this booking yet. Complete payment below or reach us on live chat."
                      : "Your reservation is logged in our ledger. Once you send £25 via Monzo and our team confirms it, your QR ticket unlocks here and arrives by email."}
                  </p>
                </div>

                <div className="pending-pass-card">
                  <div className="pending-pass-top">
                    <img
                      src="/assets/afro-kravings-logo-ticket.png"
                      alt="Afro Kravings"
                      className="sleek-pass-logo"
                    />
                    <span className={`pending-status-pill is-${reservation.paymentStatus}`}>
                      <Clock size={13} />{" "}
                      {reservation.paymentStatus === "rejected"
                        ? "Payment Not Verified"
                        : "Pending Payment Verification"}
                    </span>
                  </div>
                  <div className="pending-pass-body">
                    <div className="pending-pass-meta">
                      <div>
                        <small>Guest</small>
                        <strong>{reservation.attendeeName}</strong>
                      </div>
                      <div>
                        <small>Booking Reference</small>
                        <strong className="sleek-pass-id">{reservation.ticketId}</strong>
                      </div>
                      <div>
                        <small>Ticket Email</small>
                        <strong>{reservation.attendeeEmail}</strong>
                      </div>
                      <div>
                        <small>Amount Due</small>
                        <strong>£25.00 via Monzo</strong>
                      </div>
                    </div>
                    <div className="pending-pass-instructions">
                      <p>
                        Transfer <strong>£25</strong> using your Monzo link and write{" "}
                        <strong>{reservation.attendeeName}</strong> or <strong>{reservation.ticketId}</strong> in the
                        reference note. As soon as we verify the payment, your official branded QR pass will be emailed
                        to <strong>{reservation.attendeeEmail}</strong>.
                      </p>
                      <div className="pending-pass-actions">
                        <a className="reference-primary" href={paymentLink} target="_blank" rel="noreferrer">
                          Pay £25 on Monzo <ArrowRight size={15} />
                        </a>
                        <button
                          type="button"
                          className="pending-refresh-btn"
                          onClick={() => void refreshReservationStatus(reservation.attendeeEmail, reservation.ticketId)}
                          disabled={checkingStatus}
                        >
                          <RefreshCw size={15} className={checkingStatus ? "animate-spin" : ""} />{" "}
                          {checkingStatus ? "Checking…" : "Check approval status"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}
          </section>
        ) : null}

        <section className="facts-section" id="details">
          <div className="facts-heading">
            <div className="facts-heading-left">
              <span className="reference-kicker dark-kicker">What your £25 includes</span>
              <h2>
                One table.
                <br />
                <em>Everyone equal.</em>
              </h2>
            </div>
            <div className="festive-bauble-wrap">
              <img src="/assets/holiday/christmas-bauble.png" alt="Christmas Ornament" className="festive-bauble-img" />
            </div>
          </div>
          <div className="facts-grid">
            <div>
              <strong>RICE</strong>
              <span>Rice dishes, proteins and Nigerian favourites</span>
            </div>
            <div>
              <strong>SOUP</strong>
              <span>Served with pounded yam or semovita</span>
            </div>
            <div>
              <strong>02:00</strong>
              <span>Doors open with spiced Zobo mocktail</span>
            </div>
            <div>
              <strong>LIVE</strong>
              <span>Highlife, carols and acoustic music</span>
            </div>
            <div>
              <strong>NO KIDS</strong>
              <span>Adults &amp; parents welcome — keep kids at home or with guardians</span>
            </div>
            <div>
              <strong>BD1</strong>
              <span>1 High Point, New John Street, Bradford</span>
            </div>
          </div>
        </section>

        <section className="guest-list-section">
          <div className="guest-list-header">
            <div>
              <span className="reference-kicker dark-kicker">Before you arrive</span>
              <h2>
                Come hungry.
                <br />
                <em>Leave glowing.</em>
              </h2>
            </div>
            <div className="festive-gingerbread-wrap">
              <img
                src="/assets/holiday/gingerbread-man.png"
                alt="Gingerbread Festive Treat"
                className="festive-gingerbread-img"
              />
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
              <Input
                value={guestName}
                onChange={event => setGuestName(event.target.value)}
                placeholder="Your name"
                required
              />
              <Input
                type="email"
                value={guestEmail}
                onChange={event => setGuestEmail(event.target.value)}
                placeholder="Your email"
                required
              />
              <Button type="submit" disabled={guestListPending}>
                {guestListPending ? "Saving…" : "Join guest list"} <ArrowRight size={15} />
              </Button>
              {guestListError ? <small>{guestListError}</small> : null}
            </form>
          )}
        </section>
      </main>

      <footer className="reference-footer">
        <a className="reference-brand" href="#top">
          <img className="reference-logo" src="/assets/afro-kravings-logo-trimmed.png" alt="Afro Kravings" />
        </a>
        <p>Come hungry. Leave glowing.</p>
        <div>
          <a href="#details">
            Guest information <ArrowRight size={14} />
          </a>
        </div>
      </footer>

      {reserveOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setReserveOpen(false)}>
          <form
            className="reserve-modal reference-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="reserve-title"
            onClick={event => event.stopPropagation()}
            onSubmit={handleReserve}
          >
            <button
              type="button"
              className="modal-close"
              onClick={() => setReserveOpen(false)}
              aria-label="Close"
            >
              <X size={18} />
            </button>
            <span className="reference-kicker dark-kicker">One equal pass</span>
            <h2 id="reserve-title">
              Claim your
              <br />
              <em>place.</em>
            </h2>
            <p>
              Log your seat now. We’ll hold your booking as pending until your £25 Monzo transfer is verified, then email
              your official QR entry pass automatically.
            </p>
            <div className="modal-summary">
              <span>
                <small>Pass</small>The Complete Buffet Pass
              </span>
              <span>
                <small>Total</small>£25 / guest
              </span>
            </div>
            <div className="guest-fields">
              <label>
                Your full name
                <Input
                  value={guestName}
                  onChange={event => setGuestName(event.target.value)}
                  placeholder="e.g. Samuel Adeyemi"
                  required
                />
              </label>
              <label>
                Your email (ticket sent here once approved)
                <Input
                  type="email"
                  value={guestEmail}
                  onChange={event => setGuestEmail(event.target.value)}
                  placeholder="e.g. samuel@example.com"
                  required
                />
              </label>
              <label>
                Monzo sender name or note (optional)
                <Input
                  value={paymentNote}
                  onChange={event => setPaymentNote(event.target.value)}
                  placeholder="Only if paying from a different account name"
                />
              </label>
            </div>
            <p className="modal-note">
              No-kids-allowed buffet — parents and adults are welcome to come have fun, so please keep kids at home or
              with guardians. QR entry passes are released strictly after £25 payment approval.
            </p>
            {reserveError ? <p className="modal-error">{reserveError}</p> : null}
            <Button type="submit" className="form-submit" disabled={reservePending}>
              {reservePending ? "Logging your reservation…" : "Reserve seat & get payment ref"}{" "}
              <ArrowRight size={17} />
            </Button>
          </form>
        </div>
      ) : null}

      {activePreview && previewIndex !== null ? (
        <div className="modal-backdrop feast-lightbox-backdrop" role="presentation" onClick={() => setPreviewIndex(null)}>
          <div
            className="feast-lightbox"
            role="dialog"
            aria-modal="true"
            aria-labelledby="feast-preview-title"
            onClick={event => event.stopPropagation()}
          >
            <div className="feast-lightbox-bar">
              <span className="feast-lightbox-index">
                PLATE {activePreview.id} / 0{feastPreviews.length}
              </span>
              <button
                type="button"
                className="feast-lightbox-close"
                onClick={() => setPreviewIndex(null)}
                aria-label="Close preview"
              >
                <X size={18} />
              </button>
            </div>
            <div className="feast-lightbox-stage">
              <button
                type="button"
                className="feast-lightbox-nav prev"
                onClick={() => setPreviewIndex((previewIndex - 1 + feastPreviews.length) % feastPreviews.length)}
                aria-label="Previous dish"
              >
                <ChevronLeft size={20} />
              </button>
              <img src={activePreview.src} alt={activePreview.alt} />
              <button
                type="button"
                className="feast-lightbox-nav next"
                onClick={() => setPreviewIndex((previewIndex + 1) % feastPreviews.length)}
                aria-label="Next dish"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <div className="feast-lightbox-meta">
              <div>
                <h3 id="feast-preview-title">{activePreview.title}</h3>
                <p>{activePreview.caption}</p>
              </div>
              <div className="feast-lightbox-thumbs" aria-label="Choose dish preview">
                {feastPreviews.map((item, idx) => (
                  <button
                    key={item.id}
                    type="button"
                    className={idx === previewIndex ? "is-active" : ""}
                    onClick={() => setPreviewIndex(idx)}
                    aria-label={`View ${item.title}`}
                  >
                    {item.id}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
