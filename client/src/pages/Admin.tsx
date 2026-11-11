import { ArrowLeft, Check, Mail, ShieldCheck, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";

const ADMIN_PASSCODE = "2340";
const PAYMENT_LINK = "https://monzo.me/joenkemakosi?h=5WqWwn&account_type=personal";
type Order = { name: string; email: string; ticketId?: string; createdAt: string; paymentStatus: "pending" | "approved"; confirmationStatus: "not_sent" | "ready" };

function loadOrders(): Order[] {
  try {
    const raw = localStorage.getItem("afro-kravings-admin-orders");
    const saved = raw ? JSON.parse(raw) : [];
    const pending = localStorage.getItem("afro-kravings-pending-order");
    if (pending) {
      const next = JSON.parse(pending) as Order;
      if (!saved.some((item: Order) => item.email === next.email)) saved.unshift(next);
    }
    return saved;
  } catch { return []; }
}

export default function Admin() {
  const [passcode, setPasscode] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [orders, setOrders] = useState<Order[]>([]);

  useEffect(() => { if (sessionStorage.getItem("afro-kravings-admin-unlocked") === "yes") { setUnlocked(true); setOrders(loadOrders()); } }, []);
  const unlock = (event: React.FormEvent) => {
    event.preventDefault();
    if (passcode === ADMIN_PASSCODE) { sessionStorage.setItem("afro-kravings-admin-unlocked", "yes"); setUnlocked(true); setOrders(loadOrders()); toast.success("Admin staging panel unlocked"); }
    else toast.error("That passcode is not correct");
  };
  const save = (next: Order[]) => { setOrders(next); localStorage.setItem("afro-kravings-admin-orders", JSON.stringify(next)); };
  const approve = (email: string) => { save(orders.map(order => order.email === email ? { ...order, paymentStatus: "approved", confirmationStatus: "ready" } : order)); toast.success("Payment approved", { description: "Confirmation is ready to send when Resend is connected." }); };
  const markReady = (email: string) => { save(orders.map(order => order.email === email ? { ...order, confirmationStatus: "ready" } : order)); toast.success("Confirmation marked ready"); };

  if (!unlocked) return <main className="admin-gate"><div className="admin-gate-card"><span className="admin-eyebrow"><ShieldCheck size={15} /> Afro Kravings / Admin</span><h1>Private<br /><em>back office.</em></h1><p>Enter the admin passcode to review payment confirmations. This is a lightweight staging panel until Firestore and Resend are connected.</p><form onSubmit={unlock}><label>Passcode<input autoFocus inputMode="numeric" value={passcode} onChange={event => setPasscode(event.target.value)} placeholder="••••" maxLength={4} /></label><button type="submit">Open dashboard</button></form><Link href="/">← Back to public site</Link></div></main>;

  return <main className="admin-shell"><header className="admin-header"><div><span className="admin-eyebrow"><ShieldCheck size={15} /> Afro Kravings / Admin</span><h1>Payment<br /><em>approvals.</em></h1></div><Link href="/" className="admin-back"><ArrowLeft size={15} /> Public site</Link></header><section className="admin-notice"><Wallet size={18} /><div><strong>Manual approval mode</strong><p>Guests pay through Monzo. Firestore storage and Resend email delivery are not connected yet, so this panel stores its demo queue in this browser only.</p></div></section><section className="admin-toolbar"><div><span>EVENT</span><strong>Jingle Bells with Joe · 20 December 2026</strong></div><a href={PAYMENT_LINK} target="_blank" rel="noreferrer">Open Monzo <ArrowLeft size={14} /></a></section><section className="admin-table"><div className="admin-table-heading"><span>Guest</span><span>Payment</span><span>Confirmation</span><span>Action</span></div>{orders.length === 0 ? <div className="admin-empty"><Mail size={20} /><strong>No reservations in this browser yet.</strong><p>Guest reservations will appear here after a reservation is made on this same device. Connect Firestore for shared admin records.</p></div> : orders.map(order => <article className="admin-row" key={order.email}><div><strong>{order.name}</strong><small>{order.email}</small><small>{new Date(order.createdAt).toLocaleString()}</small></div><span className={`status-pill ${order.paymentStatus}`}>{order.paymentStatus === "approved" ? <Check size={13} /> : null}{order.paymentStatus === "approved" ? "Approved" : "Pending"}</span><span className={`status-pill ${order.confirmationStatus}`}>{order.confirmationStatus === "ready" ? "Ready to send" : "Not sent"}</span><div className="admin-actions">{order.paymentStatus === "pending" ? <button onClick={() => approve(order.email)}>Approve £30</button> : <button className="secondary-action" onClick={() => markReady(order.email)}>Prepare email</button>}<small>Resend pending</small></div></article>)}</section><footer className="admin-footer">Basic admin scaffold · Passcode protection is client-side only and must be replaced with server authentication before handling live payment records.</footer></main>;
}
