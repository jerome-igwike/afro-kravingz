import { buildPrintableTicketHtml } from "@shared/ticketTemplate";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Eye,
  LogOut,
  Mail,
  QrCode,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Wallet,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Link } from "wouter";

type PaymentStatus = "pending" | "approved" | "rejected";
type ConfirmationStatus = "not_sent" | "sent" | "failed";
type FilterTab = "all" | "pending" | "approved" | "rejected";

interface AdminOrder {
  id: number;
  ticketId: string;
  attendeeName: string;
  attendeeEmail: string;
  amountPence: number;
  paymentReference: string | null;
  paymentStatus: PaymentStatus;
  confirmationStatus: ConfirmationStatus;
  emailMessageId: string | null;
  emailError: string | null;
  approvedAt: string | null;
  emailSentAt: string | null;
  checkedInAt: string | null;
  createdAt: string;
}

interface Diagnostics {
  databaseConfigured: boolean;
  databaseMode?: "postgres" | "supabase_rest" | "none";
  resendConfigured: boolean;
  resendFromEmail: string;
  customPasscodeConfigured: boolean;
}

const ADMIN_TOKEN_STORAGE_KEY = "afro-kravings-admin-token";
const PAYMENT_LINK = "https://monzo.me/joenkemakosi?h=5WqWwn&account_type=personal";

async function readJsonSafely<T>(response: Response): Promise<T | null> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export default function Admin() {
  const [passcode, setPasscode] = useState("");
  const [token, setToken] = useState<string>(() => sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "");
  const [loggingIn, setLoggingIn] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [busyTicketId, setBusyTicketId] = useState<string | null>(null);
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [dbError, setDbError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewTicketId, setPreviewTicketId] = useState<string | null>(null);

  useEffect(() => {
    const win = window as Window & { smartsupp?: (...args: unknown[]) => void };
    win.smartsupp?.("chat:hide");
    return () => {
      win.smartsupp?.("chat:show");
    };
  }, []);

  const signOut = useCallback(() => {
    sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    setToken("");
    setOrders([]);
  }, []);

  const fetchOrders = useCallback(
    async (activeToken: string, silent = false) => {
      if (!activeToken) return;
      if (!silent) setLoadingOrders(true);
      try {
        const response = await fetch("/api/admin/orders", {
          headers: { "x-admin-token": activeToken },
          cache: "no-store",
        });
        if (response.status === 401) {
          signOut();
          if (!silent) toast.error("Admin session expired — please enter passcode again.");
          return;
        }
        const data = await readJsonSafely<{
          ok?: boolean;
          orders?: AdminOrder[];
          diagnostics?: Diagnostics;
          databaseError?: string;
          error?: string;
        }>(response);
        if (!data) {
          setDbError(`Server returned status ${response.status} (non-JSON response).`);
          return;
        }
        if (data.diagnostics) setDiagnostics(data.diagnostics);
        setDbError(data.databaseError || data.error || null);
        if (Array.isArray(data.orders)) setOrders(data.orders);
      } catch {
        toast.error("Could not load reservations from the server.");
      } finally {
        if (!silent) setLoadingOrders(false);
      }
    },
    [signOut],
  );

  useEffect(() => {
    if (token) {
      void fetchOrders(token);
    }
  }, [token, fetchOrders]);

  const unlock = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passcode.trim()) return;
    setLoggingIn(true);
    try {
      const response = await fetch("/api/admin/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", passcode }),
      });
      const data = await readJsonSafely<{ ok?: boolean; token?: string; error?: string }>(response);
      if (!response.ok || !data?.ok || !data.token) {
        toast.error(data?.error || (response.ok ? "Invalid server response." : `Server error (${response.status})`));
        return;
      }
      sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, data.token);
      setToken(data.token);
      setPasscode("");
      toast.success("Admin ledger unlocked");
    } catch {
      toast.error("Could not reach the admin endpoint.");
    } finally {
      setLoggingIn(false);
    }
  };

  const runAction = async (
    action: "approve" | "resend" | "reject" | "reopen" | "checkin",
    ticketId: string,
  ) => {
    if (!token) return;
    setBusyTicketId(ticketId);
    try {
      const response = await fetch("/api/admin/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-admin-token": token,
        },
        body: JSON.stringify({ action, ticketId }),
      });
      if (response.status === 401) {
        signOut();
        toast.error("Session expired — please sign in again.");
        return;
      }
      const data = await readJsonSafely<{
        ok?: boolean;
        order?: AdminOrder;
        emailSent?: boolean;
        emailError?: string;
        error?: string;
      }>(response);
      if (!response.ok || !data?.ok || !data.order) {
        toast.error(data?.error || `Server error (${response.status})`);
        return;
      }
      const updatedOrder = data.order;
      setOrders(prev => prev.map(item => (item.ticketId === updatedOrder.ticketId ? updatedOrder : item)));

      if (action === "approve") {
        if (data.emailSent) {
          toast.success(`Approved & ticket emailed to ${updatedOrder.attendeeEmail}`, {
            description: `Reference ${updatedOrder.ticketId}`,
          });
        } else {
          toast.warning("Payment marked Approved, but email did not send", {
            description: data.emailError || "Check RESEND_API_KEY / sender domain and click Resend.",
          });
        }
      } else if (action === "resend") {
        if (data.emailSent) {
          toast.success(`Ticket resent to ${updatedOrder.attendeeEmail}`);
        } else {
          toast.error("Resend failed", { description: data.emailError });
        }
      } else if (action === "checkin") {
        toast.success(
          updatedOrder.checkedInAt
            ? `${updatedOrder.attendeeName} checked in at the door`
            : `Check-in cleared for ${updatedOrder.attendeeName}`,
        );
      } else if (action === "reject") {
        toast.info(`Marked ${updatedOrder.attendeeName} as not confirmed`);
      } else if (action === "reopen") {
        toast.info(`Moved ${updatedOrder.attendeeName} back to pending`);
      }
    } catch {
      toast.error("Network error while updating reservation.");
    } finally {
      setBusyTicketId(null);
    }
  };

  const openTicketPreview = async (order: AdminOrder) => {
    try {
      const qrDataUrl = await QRCode.toDataURL(order.ticketId, {
        width: 280,
        margin: 2,
        color: { dark: "#241014", light: "#ffffff" },
      });
      const logoSrc = `${window.location.origin}/assets/afro-kravings-logo-ticket.png`;
      const html = buildPrintableTicketHtml({
        ticket: {
          ticketId: order.ticketId,
          attendeeName: order.attendeeName,
          attendeeEmail: order.attendeeEmail,
          approvedAt: order.approvedAt,
        },
        qrDataUrl,
        logoSrc,
      });
      setPreviewTicketId(order.ticketId);
      setPreviewHtml(html);
    } catch {
      toast.error("Could not generate ticket preview.");
    }
  };

  const counts = useMemo(() => {
    const pending = orders.filter(o => o.paymentStatus === "pending").length;
    const approved = orders.filter(o => o.paymentStatus === "approved").length;
    const rejected = orders.filter(o => o.paymentStatus === "rejected").length;
    const sent = orders.filter(o => o.confirmationStatus === "sent").length;
    return { total: orders.length, pending, approved, rejected, sent, revenue: approved * 25 };
  }, [orders]);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter(order => {
      if (filter !== "all" && order.paymentStatus !== filter) return false;
      if (!q) return true;
      return (
        order.attendeeName.toLowerCase().includes(q) ||
        order.attendeeEmail.toLowerCase().includes(q) ||
        order.ticketId.toLowerCase().includes(q) ||
        (order.paymentReference ?? "").toLowerCase().includes(q)
      );
    });
  }, [orders, filter, searchQuery]);

  if (!token) {
    return (
      <main className="admin-gate">
        <div className="admin-gate-card">
          <span className="admin-eyebrow">
            <ShieldCheck size={15} /> Afro Kravings / Admin
          </span>
          <h1>
            Private
            <br />
            <em>back office.</em>
          </h1>
          <p>
            Enter the admin passcode to verify £25 Monzo transfers, approve pending bookings, and automatically dispatch
            branded QR passes by email.
          </p>
          <form onSubmit={unlock}>
            <label>
              Passcode
              <input
                autoFocus
                type="password"
                inputMode="numeric"
                value={passcode}
                onChange={event => setPasscode(event.target.value)}
                placeholder="••••"
                maxLength={24}
              />
            </label>
            <button type="submit" disabled={loggingIn}>
              {loggingIn ? "Verifying…" : "Open dashboard"}
            </button>
          </form>
          <Link href="/">← Back to public site</Link>
        </div>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-header">
        <div>
          <span className="admin-eyebrow">
            <ShieldCheck size={15} /> Afro Kravings / Admin Ledger
          </span>
          <h1>
            Payment
            <br />
            <em>approvals.</em>
          </h1>
        </div>
        <div className="admin-header-links">
          <button
            type="button"
            className="admin-header-btn"
            onClick={() => void fetchOrders(token)}
            disabled={loadingOrders}
          >
            <RefreshCw size={14} className={loadingOrders ? "animate-spin" : ""} />{" "}
            {loadingOrders ? "Refreshing…" : "Refresh"}
          </button>
          <button type="button" className="admin-header-btn" onClick={signOut}>
            <LogOut size={14} /> Lock
          </button>
          <Link href="/" className="admin-back">
            <ArrowLeft size={15} /> Public site
          </Link>
        </div>
      </header>

      <section className={`admin-notice ${!diagnostics?.databaseConfigured || !diagnostics?.resendConfigured || dbError ? "is-warning" : ""}`}>
        {!diagnostics?.databaseConfigured || !diagnostics?.resendConfigured || dbError ? (
          <AlertCircle size={18} />
        ) : (
          <Wallet size={18} />
        )}
        <div>
          <strong>
            {diagnostics?.databaseConfigured && diagnostics?.resendConfigured && !dbError
              ? "Live reservation ledger & automatic Resend dispatch active"
              : "Setup required in Vercel / Supabase"}
          </strong>
          <p>
            Database:{" "}
            <b>
              {diagnostics?.databaseConfigured
                ? diagnostics.databaseMode === "supabase_rest"
                  ? "Connected (Supabase API)"
                  : "Connected (Postgres)"
                : "Missing SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (or DATABASE_URL)"}
            </b>{" "}
            · Resend Email:{" "}
            <b>
              {diagnostics?.resendConfigured
                ? `Connected (${diagnostics.resendFromEmail})`
                : "Missing RESEND_API_KEY"}
            </b>
            {dbError ? ` · Action needed: ${dbError}` : ""}
          </p>
        </div>
      </section>

      <section className="admin-stats-grid" aria-label="Booking summary">
        <div>
          <span>Total bookings</span>
          <strong>{counts.total}</strong>
        </div>
        <div className="is-pending">
          <span>Pending verification</span>
          <strong>{counts.pending}</strong>
        </div>
        <div className="is-approved">
          <span>Approved &amp; paid</span>
          <strong>
            {counts.approved} <small>(£{counts.revenue})</small>
          </strong>
        </div>
        <div>
          <span>Tickets emailed</span>
          <strong>
            {counts.sent} / {counts.approved}
          </strong>
        </div>
      </section>

      <section className="admin-toolbar">
        <div>
          <span>EVENT</span>
          <strong>Jingle Bells with Joe · Saturday, 19 December 2026</strong>
        </div>
        <a href={PAYMENT_LINK} target="_blank" rel="noreferrer">
          Open Monzo <ArrowLeft size={14} />
        </a>
      </section>

      <section className="admin-controls">
        <div className="admin-filter-tabs" role="tablist" aria-label="Filter reservations">
          {(
            [
              ["all", `All (${counts.total})`],
              ["pending", `Pending (${counts.pending})`],
              ["approved", `Approved (${counts.approved})`],
              ["rejected", `Declined (${counts.rejected})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={filter === key ? "is-active" : ""}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="admin-search-wrap">
          <Search size={15} />
          <input
            type="search"
            value={searchQuery}
            onChange={event => setSearchQuery(event.target.value)}
            placeholder="Search name, email, Monzo note, or AKXMAS ID…"
          />
        </div>
      </section>

      <section className="admin-table">
        <div className="admin-table-heading">
          <span>Guest &amp; Reference</span>
          <span>Payment</span>
          <span>Ticket Email</span>
          <span>Actions</span>
        </div>
        {filteredOrders.length === 0 ? (
          <div className="admin-empty">
            <Mail size={20} />
            <strong>
              {orders.length === 0 ? "No reservations logged yet." : "No bookings match your filter."}
            </strong>
            <p>
              {orders.length === 0
                ? "When a guest reserves on the site, their booking appears here immediately as Pending until you verify their £25 Monzo payment."
                : "Try switching tabs or clearing your search query."}
            </p>
          </div>
        ) : (
          filteredOrders.map(order => {
            const isBusy = busyTicketId === order.ticketId;
            return (
              <article className="admin-row" key={order.ticketId}>
                <div>
                  <strong>{order.attendeeName}</strong>
                  <small>{order.attendeeEmail}</small>
                  <small className="admin-ref-line">
                    <span className="admin-ticket-code">{order.ticketId}</span>
                    {order.paymentReference ? ` · Monzo note: ${order.paymentReference}` : ""}
                  </small>
                  <small>Logged {new Date(order.createdAt).toLocaleString("en-GB")}</small>
                </div>

                <div className="admin-status-col">
                  <span className={`status-pill ${order.paymentStatus}`}>
                    {order.paymentStatus === "approved" ? <Check size={13} /> : null}
                    {order.paymentStatus === "approved"
                      ? "Approved · £25"
                      : order.paymentStatus === "rejected"
                        ? "Declined"
                        : "Pending"}
                  </span>
                  {order.checkedInAt ? (
                    <span className="status-pill checked_in">
                      <QrCode size={12} /> Checked in
                    </span>
                  ) : null}
                </div>

                <div className="admin-status-col">
                  <span className={`status-pill ${order.confirmationStatus}`}>
                    {order.confirmationStatus === "sent" ? <Check size={13} /> : null}
                    {order.confirmationStatus === "sent"
                      ? "Ticket emailed"
                      : order.confirmationStatus === "failed"
                        ? "Email failed"
                        : "Not sent"}
                  </span>
                  {order.emailSentAt ? (
                    <small>Sent {new Date(order.emailSentAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</small>
                  ) : null}
                  {order.emailError ? <small className="admin-email-err">{order.emailError}</small> : null}
                </div>

                <div className="admin-actions">
                  {order.paymentStatus === "pending" ? (
                    <div className="admin-btn-group">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void runAction("approve", order.ticketId)}
                      >
                        <Send size={13} /> {isBusy ? "Sending…" : "Approve £25 & Email Ticket"}
                      </button>
                      <button
                        type="button"
                        className="subtle-action"
                        disabled={isBusy}
                        onClick={() => void runAction("reject", order.ticketId)}
                      >
                        Decline
                      </button>
                    </div>
                  ) : null}

                  {order.paymentStatus === "approved" ? (
                    <div className="admin-btn-group">
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={isBusy}
                        onClick={() => void runAction("resend", order.ticketId)}
                      >
                        <Send size={13} /> {isBusy ? "Sending…" : "Resend Email"}
                      </button>
                      <button
                        type="button"
                        className="outline-action"
                        onClick={() => void openTicketPreview(order)}
                      >
                        <Eye size={13} /> Preview Pass
                      </button>
                      <button
                        type="button"
                        className="subtle-action"
                        disabled={isBusy}
                        onClick={() => void runAction("checkin", order.ticketId)}
                      >
                        <QrCode size={13} /> {order.checkedInAt ? "Undo check-in" : "Check in"}
                      </button>
                    </div>
                  ) : null}

                  {order.paymentStatus === "rejected" ? (
                    <div className="admin-btn-group">
                      <button
                        type="button"
                        className="secondary-action"
                        disabled={isBusy}
                        onClick={() => void runAction("reopen", order.ticketId)}
                      >
                        Restore to Pending
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })
        )}
      </section>

      <footer className="admin-footer">
        Afro Kravings ledger · Set <code>ADMIN_PASSCODE</code>, <code>DATABASE_URL</code>,{" "}
        <code>RESEND_API_KEY</code>, and <code>RESEND_FROM_EMAIL</code> in Vercel Environment Variables.
      </footer>

      {previewHtml ? (
        <div
          className="admin-preview-backdrop"
          role="presentation"
          onClick={() => {
            setPreviewHtml(null);
            setPreviewTicketId(null);
          }}
        >
          <div
            className="admin-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label={`Ticket preview ${previewTicketId ?? ""}`}
            onClick={event => event.stopPropagation()}
          >
            <div className="admin-preview-bar">
              <span>TICKET PREVIEW · {previewTicketId}</span>
              <button
                type="button"
                onClick={() => {
                  setPreviewHtml(null);
                  setPreviewTicketId(null);
                }}
                aria-label="Close preview"
              >
                <X size={16} />
              </button>
            </div>
            <iframe title="Ticket preview" srcDoc={previewHtml} />
          </div>
        </div>
      ) : null}
    </main>
  );
}
