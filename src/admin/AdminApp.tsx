import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Copy,
  CreditCard,
  Download,
  Eye,
  FileCheck2,
  FileText,
  Gauge,
  KeyRound,
  LayoutDashboard,
  Loader2,
  LogIn,
  LogOut,
  Menu,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  UserCheck,
  UserPlus,
  Users,
  UserX,
  WalletCards,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import {
  adminLogin,
  clearAdminToken,
  createAdminPurchase,
  createAdminUser,
  downloadAdminReceipt,
  getAdminOverview,
  getAdminMe,
  getAdminUser,
  listAdminPurchases,
  listAdminSubscriptions,
  listAdminUsers,
  readAdminToken,
  resetAdminUserPassword,
  setAdminUserStatus,
  updateAdminUserSubscription,
  type AdminOverview,
  type AdminPage,
  type AdminPurchase,
  type AdminSubscription,
  type AdminSubscriptionListItem,
  type AdminSessionUser,
  type AdminUser,
} from '../lib/admin-api';

type AdminPageKey = 'overview' | 'users' | 'subscriptions' | 'purchases';
type Toast = { id: number; tone: 'success' | 'error'; message: string };

const EMPTY_PAGE = { items: [], total: 0, page: 1, page_size: 25, pages: 1 };
const PLAN_OPTIONS = [
  { key: 'free', label: 'Apex Free', limit: 1 },
  { key: 'lite', label: 'Apex Lite', limit: 20 },
  { key: 'pro', label: 'Apex Pro', limit: 9999 },
] as const;
const CUSTOMER_APP_URL = String(import.meta.env.VITE_CUSTOMER_APP_URL || 'https://apex-files-frontend-production.up.railway.app');

function money(cents: number | null | undefined, currency = 'USD') {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency || 'USD',
    maximumFractionDigits: 2,
  }).format((Number(cents) || 0) / 100);
}

function compactNumber(value: number | null | undefined) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value) || 0);
}

function dateLabel(value: string | null | undefined, includeTime = false) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', includeTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' });
}

function dateOnlyLabel(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function initials(user: Pick<AdminUser, 'display_name' | 'email'>) {
  const source = user.display_name.trim() || user.email.split('@')[0] || 'A';
  return source
    .split(/[\s._-]+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function planKey(subscription: AdminSubscription | null | undefined, selectedPackage = '') {
  const value = `${subscription?.plan_name || ''} ${selectedPackage}`.toLowerCase();
  if (value.includes('pro')) return 'pro';
  if (value.includes('lite')) return 'lite';
  return 'free';
}

function planName(value: string | null | undefined) {
  const key = String(value || '').toLowerCase();
  return PLAN_OPTIONS.find((plan) => key.includes(plan.key))?.label || value || 'No package';
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    'user.created': 'Account created',
    'user.status_changed': 'Account status changed',
    'user.password_reset': 'Password reset',
    'user.updated': 'Account updated',
    'subscription.updated': 'Subscription updated',
    'purchase.created': 'Purchase recorded',
  };
  return labels[action] || action.replace(/[._]/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function randomPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function useDebounced<T>(value: T, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

function LoadingBlock({ label = 'Loading data' }: { label?: string }) {
  return (
    <div className="admin-loading-block">
      <Loader2 className="admin-spin" size={23} />
      <span>{label}</span>
    </div>
  );
}

function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="admin-empty-state">
      <span className="admin-empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{body}</p>
      {action}
    </div>
  );
}

function StatusPill({ active, label }: { active: boolean; label?: string }) {
  return (
    <span className={clsx('admin-status-pill', active ? 'is-active' : 'is-inactive')}>
      <i />
      {label || (active ? 'Active' : 'Disabled')}
    </span>
  );
}

function PackagePill({ value }: { value: string | null | undefined }) {
  const key = value?.toLowerCase() || 'free';
  return <span className={clsx('admin-package-pill', key.includes('pro') && 'is-pro', key.includes('lite') && 'is-lite')}>{planName(value)}</span>;
}

function UserCell({ user }: { user: AdminUser }) {
  return (
    <div className="admin-user-cell">
      <span className="admin-avatar">{initials(user)}</span>
      <span>
        <strong>{user.display_name || 'Unnamed user'}</strong>
        <small>{user.email}</small>
      </span>
    </div>
  );
}

function ToastStack({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div className="admin-toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={clsx('admin-toast', toast.tone)} onClick={() => dismiss(toast.id)}>
          {toast.tone === 'success' ? <Check size={17} /> : <AlertTriangle size={17} />}
          <span>{toast.message}</span>
          <X size={14} />
        </button>
      ))}
    </div>
  );
}

function Modal({ title, eyebrow, onClose, children, wide = false }: { title: string; eyebrow?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className="admin-modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={clsx('admin-modal', wide && 'is-wide')} role="dialog" aria-modal="true" aria-label={title}>
        <header>
          <div>
            {eyebrow ? <span>{eyebrow}</span> : null}
            <h2>{title}</h2>
          </div>
          <button type="button" className="admin-icon-button" onClick={onClose} aria-label="Close">
            <X size={19} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}

function AdminLogin({ onAuthed }: { onAuthed: (user: AdminSessionUser) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await adminLogin(email.trim(), password);
      onAuthed(user);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-login">
      <div className="admin-login-glow" />
      <section className="admin-login-card">
        <img src="/logos/apex-files-wordmark-white.png" alt="Apex Files" />
        <div className="admin-login-heading">
          <span><ShieldCheck size={14} /> Secure administration</span>
          <h1>Admin portal</h1>
          <p>Sign in with an Apex administrator account.</p>
        </div>
        <form onSubmit={submit}>
          <label>
            <span>Email or account</span>
            <input type="text" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your administrator account" required />
          </label>
          <label>
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" required />
          </label>
          {error ? <div className="admin-form-error"><AlertTriangle size={16} />{error}</div> : null}
          <button className="admin-primary-button" type="submit" disabled={busy}>
            {busy ? <Loader2 className="admin-spin" size={17} /> : <LogIn size={17} />}
            Sign in to admin
          </button>
        </form>
        <a href={CUSTOMER_APP_URL}>Return to Apex Files</a>
      </section>
    </main>
  );
}

function DashboardPage({ onOpenUsers, onOpenPurchases }: { onOpenUsers: () => void; onOpenPurchases: () => void }) {
  const [data, setData] = useState<AdminOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setData(await getAdminOverview());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loading) return <LoadingBlock label="Loading dashboard" />;
  if (error || !data) {
    return <EmptyState icon={<AlertTriangle size={22} />} title="Dashboard unavailable" body={error || 'No dashboard data was returned.'} action={<button type="button" className="admin-secondary-button" onClick={() => void load()}><RefreshCw size={15} />Try again</button>} />;
  }

  const activity = data.activity || [];
  const maxBuilds = Math.max(1, ...activity.map((item) => item.builds));
  const maxPlanCount = Math.max(1, ...(data.plans || []).map((item) => item.user_count));

  return (
    <div className="admin-page-stack">
      <section className="admin-stat-grid">
        <article className="admin-stat-card is-orange">
          <div><span>Total users</span><Users size={19} /></div>
          <strong>{compactNumber(data.total_users)}</strong>
          <small><UserCheck size={14} /> {compactNumber(data.active_users)} active accounts</small>
        </article>
        <article className="admin-stat-card is-blue">
          <div><span>Subscriptions</span><CreditCard size={19} /></div>
          <strong>{compactNumber(data.active_subscriptions)}</strong>
          <small><Gauge size={14} /> Currently active</small>
        </article>
        <article className="admin-stat-card is-green">
          <div><span>Recorded revenue</span><CircleDollarSign size={19} /></div>
          <strong>{money(data.revenue_minor, data.currency)}</strong>
          <small><WalletCards size={14} /> {compactNumber(data.purchases_total)} purchases{data.revenue_by_currency.length > 1 ? ` · ${data.revenue_by_currency.length} currencies` : ''}</small>
        </article>
        <article className="admin-stat-card is-purple">
          <div><span>Files delivered</span><FileCheck2 size={19} /></div>
          <strong>{compactNumber(data.files_delivered)}</strong>
          <small><Activity size={14} /> {compactNumber(data.builds_this_month)} this month</small>
        </article>
      </section>

      <section className="admin-dashboard-grid">
        <article className="admin-panel admin-activity-panel">
          <header className="admin-panel-heading">
            <div><span>Usage</span><h2>File activity</h2></div>
            <span className="admin-panel-period">Last {activity.length || 0} days</span>
          </header>
          {activity.length ? (
            <div className="admin-bar-chart" aria-label="Daily file activity">
              {activity.map((item) => (
                <div className="admin-chart-column" key={item.date} title={`${dateLabel(item.date)}: ${item.builds} builds`}>
                  <span className="admin-chart-value">{item.builds}</span>
                  <i style={{ height: `${Math.max(5, (item.builds / maxBuilds) * 100)}%` }} />
                  <small>{new Date(item.date).toLocaleDateString('en-GB', { weekday: 'short' }).slice(0, 2)}</small>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<BarChart3 size={20} />} title="No file activity yet" body="Completed builds will appear here." />}
        </article>

        <article className="admin-panel admin-plan-panel">
          <header className="admin-panel-heading">
            <div><span>Accounts</span><h2>Package mix</h2></div>
          </header>
          {(data.plans || []).length ? (
            <div className="admin-plan-list">
              {data.plans.map((plan) => (
                <div key={plan.plan_name}>
                  <div><span>{planName(plan.plan_name)}</span><strong>{plan.user_count}</strong></div>
                  <span className="admin-progress"><i style={{ width: `${plan.percentage || (plan.user_count / maxPlanCount) * 100}%` }} /></span>
                  <small>{Math.round(plan.percentage || 0)}% of accounts</small>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<CreditCard size={19} />} title="No subscriptions yet" body="Package distribution will appear here." />}
        </article>
      </section>

      <section className="admin-dashboard-grid lower">
        <article className="admin-panel">
          <header className="admin-panel-heading">
            <div><span>Security log</span><h2>Recent admin activity</h2></div>
            <button type="button" className="admin-text-button" onClick={onOpenUsers}>View all <ArrowRight size={14} /></button>
          </header>
          {(data.recent_audit_events || []).length ? (
            <div className="admin-audit-list">
              {data.recent_audit_events?.slice(0, 6).map((event) => (
                <div key={event.id}>
                  <span className="admin-purchase-icon"><ShieldCheck size={16} /></span>
                  <span><strong>{auditActionLabel(event.action)}</strong><small>{event.target_email || event.actor_email || 'System event'}</small></span>
                  <small>{dateLabel(event.created_at, true)}</small>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<ShieldCheck size={19} />} title="No admin activity yet" body="Account and billing changes will be logged here." />}
        </article>

        <article className="admin-panel">
          <header className="admin-panel-heading">
            <div><span>Verified ledger</span><h2>Paid totals by currency</h2></div>
            <button type="button" className="admin-text-button" onClick={onOpenPurchases}>View all <ArrowRight size={14} /></button>
          </header>
          {data.revenue_by_currency.length ? (
            <div className="admin-revenue-list">
              {data.revenue_by_currency.map((entry) => (
                <div key={entry.currency}>
                  <span className="admin-purchase-icon"><CircleDollarSign size={17} /></span>
                  <span><strong>{entry.currency}</strong><small>{entry.count} paid {entry.count === 1 ? 'record' : 'records'}</small></span>
                  <strong>{money(entry.amount_minor, entry.currency)}</strong>
                </div>
              ))}
            </div>
          ) : <EmptyState icon={<FileText size={19} />} title="No purchases recorded" body="The purchase ledger is empty. Historical payment records are not fabricated." />}
        </article>
      </section>
    </div>
  );
}

function CreateUserModal({ onClose, onCreated, notify }: { onClose: () => void; onCreated: (user: AdminUser) => void; notify: (tone: Toast['tone'], message: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<AdminUser | null>(null);
  const [form, setForm] = useState({
    email: '', password: randomPassword(), display_name: '', company_name: '', vat_number: '', phone_number: '', country: '', package_key: 'free' as 'free' | 'lite' | 'pro', role: 'tuner' as 'tuner' | 'admin',
  });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const user = await createAdminUser(form);
      notify('success', `Account created for ${user.email}.`);
      setCreated(user);
      onCreated(user);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not create account.');
    } finally {
      setBusy(false);
    }
  }

  const set = (key: keyof typeof form, value: string) => setForm((current) => ({ ...current, [key]: value }));

  if (created) {
    return (
      <Modal title="Account created" eyebrow="One-time credentials" onClose={onClose}>
        <div className="admin-modal-form">
          <div className="admin-create-success"><span><UserCheck size={22} /></span><div><strong>{created.display_name || created.email}</strong><small>{created.email}</small></div></div>
          <p className="admin-modal-copy">Copy the temporary password now and share it securely. It is not shown again after this window closes.</p>
          <label className="admin-single-field"><span>Temporary password</span><div className="admin-input-action"><input value={form.password} readOnly /><button type="button" onClick={() => { void navigator.clipboard.writeText(form.password); notify('success', 'Temporary password copied.'); }}><Copy size={15} />Copy</button></div></label>
          <footer className="admin-modal-actions"><button type="button" className="admin-primary-button" onClick={onClose}>Done</button></footer>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Create account" eyebrow="Users" onClose={onClose} wide>
      <form className="admin-modal-form" onSubmit={submit}>
        <div className="admin-form-grid">
          <label><span>Full name</span><input value={form.display_name} onChange={(event) => set('display_name', event.target.value)} placeholder="John Doe" /></label>
          <label><span>Company</span><input value={form.company_name} onChange={(event) => set('company_name', event.target.value)} placeholder="Company Ltd" /></label>
          <label className="is-wide"><span>Email</span><input type="email" value={form.email} onChange={(event) => set('email', event.target.value)} placeholder="name@company.com" required /></label>
          <label className="is-wide">
            <span>Temporary password</span>
                <div className="admin-input-action"><input value={form.password} onChange={(event) => set('password', event.target.value)} minLength={12} required /><button type="button" onClick={() => set('password', randomPassword())}><RefreshCw size={15} />Generate</button></div>
          </label>
          <label><span>Package</span><select value={form.package_key} onChange={(event) => set('package_key', event.target.value)}>{PLAN_OPTIONS.map((plan) => <option key={plan.key} value={plan.key}>{plan.label}</option>)}</select></label>
          <label><span>Account role</span><select value={form.role} onChange={(event) => set('role', event.target.value)}><option value="tuner">Tuner</option><option value="admin">Administrator</option></select></label>
          <label><span>VAT number</span><input value={form.vat_number} onChange={(event) => set('vat_number', event.target.value)} placeholder="Optional" /></label>
          <label><span>Phone</span><input value={form.phone_number} onChange={(event) => set('phone_number', event.target.value)} placeholder="Optional" /></label>
          <label className="is-wide"><span>Country</span><input value={form.country} onChange={(event) => set('country', event.target.value)} placeholder="Country" /></label>
        </div>
        {error ? <div className="admin-form-error"><AlertTriangle size={15} />{error}</div> : null}
        <footer className="admin-modal-actions"><button type="button" className="admin-secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="admin-primary-button" disabled={busy}>{busy ? <Loader2 className="admin-spin" size={16} /> : <UserPlus size={16} />}Create account</button></footer>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, currentAdminId, onSelfReset, onClose, notify }: { user: AdminUser; currentAdminId: string; onSelfReset: () => void; onClose: () => void; notify: (tone: Toast['tone'], message: string) => void }) {
  const [password, setPassword] = useState(randomPassword());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await resetAdminUserPassword(user.id, password);
      if (user.id === currentAdminId) {
        clearAdminToken();
        onSelfReset();
        return;
      }
      setSaved(true);
      notify('success', `Password reset for ${user.email}.`);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not reset password.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Reset password" eyebrow={user.email} onClose={onClose}>
      <form className="admin-modal-form" onSubmit={submit}>
        <p className="admin-modal-copy">Set a temporary password and share it securely with the account owner.</p>
        <label className="admin-single-field"><span>Temporary password</span><div className="admin-input-action"><input value={password} onChange={(event) => { setPassword(event.target.value); setSaved(false); }} minLength={12} required /><button type="button" onClick={() => setPassword(randomPassword())}><RefreshCw size={15} />Generate</button></div></label>
        {saved ? <button type="button" className="admin-copy-result" onClick={() => void navigator.clipboard.writeText(password)}><Copy size={15} />Copy temporary password</button> : null}
        {error ? <div className="admin-form-error"><AlertTriangle size={15} />{error}</div> : null}
        <footer className="admin-modal-actions"><button type="button" className="admin-secondary-button" onClick={onClose}>{saved ? 'Done' : 'Cancel'}</button>{!saved ? <button type="submit" className="admin-primary-button" disabled={busy}>{busy ? <Loader2 className="admin-spin" size={16} /> : <KeyRound size={16} />}Reset password</button> : null}</footer>
      </form>
    </Modal>
  );
}

function UserDrawer({ userId, currentAdminId, onSelfReset, onClose, onChanged, notify }: { userId: string; currentAdminId: string; onSelfReset: () => void; onClose: () => void; onChanged: (user: AdminUser) => void; notify: (tone: Toast['tone'], message: string) => void }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [confirmStatus, setConfirmStatus] = useState(false);
  const [subscription, setSubscription] = useState({ package_key: 'free', plan_name: 'Apex Free', monthly_file_limit: 1, files_used_this_period: 0, period_ends_at: '', status: 'active' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getAdminUser(userId);
      setUser(data);
      const currentPlan = PLAN_OPTIONS.find((plan) => plan.key === planKey(data.subscription, data.selected_package)) || PLAN_OPTIONS[0];
      setSubscription({
        package_key: currentPlan.key,
        plan_name: data.subscription?.plan_name || currentPlan.label,
        monthly_file_limit: data.subscription?.monthly_file_limit ?? currentPlan.limit,
        files_used_this_period: data.subscription?.files_used_this_period ?? 0,
        period_ends_at: data.subscription?.period_ends_at?.slice(0, 10) || '',
        status: data.subscription?.status || 'active',
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load this user.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function saveSubscription(event: FormEvent) {
    event.preventDefault();
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      const updatedSubscription = await updateAdminUserSubscription(user.id, {
        ...subscription,
        package_key: subscription.package_key as 'free' | 'lite' | 'pro',
        period_ends_at: subscription.period_ends_at ? new Date(`${subscription.period_ends_at}T23:59:59Z`).toISOString() : undefined,
      });
      const updated = { ...user, selected_package: subscription.package_key, subscription: updatedSubscription };
      setUser(updated);
      onChanged(updated);
      notify('success', 'Subscription updated.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not update subscription.');
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus() {
    if (!user) return;
    setSaving(true);
    setError('');
    try {
      const updated = await setAdminUserStatus(user.id, !user.is_active);
      setUser(updated);
      onChanged(updated);
      setConfirmStatus(false);
      notify('success', updated.is_active ? 'Account activated.' : 'Account disabled.');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not change account status.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="admin-user-drawer" role="dialog" aria-modal="true" aria-label="User details">
        <header className="admin-drawer-header">
          <div><span>User profile</span><h2>{user?.display_name || user?.email || 'Account details'}</h2></div>
          <button type="button" className="admin-icon-button" onClick={onClose}><X size={19} /></button>
        </header>
        {loading ? <LoadingBlock label="Loading user" /> : error && !user ? <EmptyState icon={<AlertTriangle size={20} />} title="Could not load user" body={error} action={<button className="admin-secondary-button" type="button" onClick={() => void load()}><RefreshCw size={15} />Try again</button>} /> : user ? (
          <div className="admin-drawer-content">
            <section className="admin-profile-summary">
              <span className="admin-avatar is-large">{initials(user)}</span>
              <div><h3>{user.display_name || 'Unnamed user'}</h3><p>{user.email}</p><span><StatusPill active={user.is_active} /><PackagePill value={user.subscription?.plan_name || user.selected_package} /></span></div>
              <button type="button" className="admin-secondary-button" onClick={() => setPasswordOpen(true)}><KeyRound size={15} />Password</button>
            </section>

            <section className="admin-user-stat-grid">
              <div><span>Total builds</span><strong>{user.stats?.builds_total ?? 0}</strong><small>{user.stats?.builds_ready ?? 0} ready</small></div>
              <div><span>Projects</span><strong>{user.stats?.projects_total ?? 0}</strong><small>Saved projects</small></div>
              <div><span>Purchases</span><strong>{user.stats?.purchases_total ?? 0}</strong><small>{user.stats?.paid_by_currency?.length === 1 ? money(user.stats.paid_by_currency[0].amount_minor, user.stats.paid_by_currency[0].currency) : user.stats?.paid_by_currency?.length ? `${user.stats.paid_by_currency.length} currencies` : 'No paid records'}</small></div>
            </section>

            <section className="admin-drawer-section">
              <header><div><span>Account</span><h3>Contact details</h3></div><span className="admin-readonly-label"><Eye size={13} />Read only</span></header>
              <div className="admin-detail-grid">
                <div><span>Name</span><strong>{user.display_name || '—'}</strong></div>
                <div><span>Company</span><strong>{user.company_name || '—'}</strong></div>
                <div className="is-wide"><span>Email</span><strong>{user.email}</strong></div>
                <div><span>VAT number</span><strong>{user.vat_number || '—'}</strong></div>
                <div><span>Phone</span><strong>{user.phone_number || '—'}</strong></div>
                <div><span>Country</span><strong>{user.country || '—'}</strong></div>
                <div><span>Role</span><strong>{user.role === 'admin' ? 'Administrator' : 'Tuner'}</strong></div>
              </div>
            </section>

            <form className="admin-drawer-section" onSubmit={saveSubscription}>
              <header><div><span>Billing</span><h3>Subscription</h3></div><button className="admin-text-button" type="submit" disabled={saving}>{saving ? <Loader2 className="admin-spin" size={14} /> : <Check size={14} />}Save</button></header>
              <div className="admin-form-grid compact">
                <label><span>Package</span><select value={subscription.package_key} onChange={(event) => { const selected = PLAN_OPTIONS.find((plan) => plan.key === event.target.value) || PLAN_OPTIONS[0]; setSubscription({ ...subscription, package_key: selected.key, plan_name: selected.label, monthly_file_limit: selected.limit }); }}>{PLAN_OPTIONS.map((plan) => <option key={plan.key} value={plan.key}>{plan.label}</option>)}</select></label>
                <label><span>Status</span><select value={subscription.status} onChange={(event) => setSubscription({ ...subscription, status: event.target.value })}><option value="active">Active</option><option value="inactive">Inactive</option><option value="past_due">Past due</option><option value="cancelled">Cancelled</option></select></label>
                <label><span>Monthly limit</span><input type="number" min={0} value={subscription.monthly_file_limit} onChange={(event) => setSubscription({ ...subscription, monthly_file_limit: Number(event.target.value) })} /></label>
                <label><span>Files used</span><input type="number" min={0} value={subscription.files_used_this_period} onChange={(event) => setSubscription({ ...subscription, files_used_this_period: Number(event.target.value) })} /></label>
                <label className="is-wide"><span>Period ends</span><input type="date" value={subscription.period_ends_at} onChange={(event) => setSubscription({ ...subscription, period_ends_at: event.target.value })} /></label>
              </div>
            </form>

            {error ? <div className="admin-form-error"><AlertTriangle size={15} />{error}</div> : null}

            <section className="admin-danger-zone">
              <div><strong>{user.is_active ? 'Disable this account' : 'Reactivate this account'}</strong><p>{user.is_active ? 'The user will immediately lose access to Apex Files.' : 'Restore access to Apex Files for this user.'}</p></div>
              <button type="button" className={clsx('admin-danger-button', !user.is_active && 'is-activate')} onClick={() => setConfirmStatus(true)}>{user.is_active ? <UserX size={15} /> : <UserCheck size={15} />}{user.is_active ? 'Disable account' : 'Activate account'}</button>
            </section>
          </div>
        ) : null}
      </aside>
      {passwordOpen && user ? <ResetPasswordModal user={user} currentAdminId={currentAdminId} onSelfReset={onSelfReset} onClose={() => setPasswordOpen(false)} notify={notify} /> : null}
      {confirmStatus && user ? (
        <Modal title={user.is_active ? 'Disable account?' : 'Activate account?'} eyebrow={user.email} onClose={() => setConfirmStatus(false)}>
          <div className="admin-confirm-body"><span className={clsx('admin-confirm-icon', !user.is_active && 'is-positive')}>{user.is_active ? <UserX size={23} /> : <UserCheck size={23} />}</span><p>{user.is_active ? 'This blocks login and all API access immediately. Existing data remains available to administrators.' : 'This restores the user’s access immediately.'}</p><footer className="admin-modal-actions"><button type="button" className="admin-secondary-button" onClick={() => setConfirmStatus(false)}>Cancel</button><button type="button" className={user.is_active ? 'admin-danger-button' : 'admin-primary-button'} disabled={saving} onClick={() => void changeStatus()}>{saving ? <Loader2 className="admin-spin" size={16} /> : null}{user.is_active ? 'Disable account' : 'Activate account'}</button></footer></div>
        </Modal>
      ) : null}
    </div>
  );
}

function UsersPage({ notify, currentAdminId, onSelfReset, subscriptionsOnly = false }: { notify: (tone: Toast['tone'], message: string) => void; currentAdminId: string; onSelfReset: () => void; subscriptionsOnly?: boolean }) {
  const [users, setUsers] = useState<AdminPage<AdminUser>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [status, setStatus] = useState('all');
  const [plan, setPlan] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await listAdminUsers({ search: debouncedSearch, status: status as 'all' | 'active' | 'disabled', plan, page, page_size: 25, sort: 'created_at', direction: 'desc' }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load users.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, plan, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const maxPage = Math.max(1, users.pages || Math.ceil(users.total / users.page_size));

  return (
    <div className="admin-page-stack">
      {subscriptionsOnly ? (
        <section className="admin-mini-stat-grid">
          {PLAN_OPTIONS.map((item) => {
            const matches = users.items.filter((user) => planKey(user.subscription, user.selected_package) === item.key).length;
            return <article key={item.key}><span>{item.label}</span><strong>{matches}</strong><small>on this page</small></article>;
          })}
        </section>
      ) : null}
      <section className="admin-panel admin-table-panel">
        <header className="admin-table-toolbar">
          <div className="admin-search-field"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={subscriptionsOnly ? 'Search subscriptions…' : 'Search name, email or company…'} />{search ? <button type="button" onClick={() => { setSearch(''); setPage(1); }}><X size={14} /></button> : null}</div>
          <div className="admin-toolbar-filters">
            <label><SlidersHorizontal size={15} /><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="disabled">Disabled</option></select></label>
            <label><CreditCard size={15} /><select value={plan} onChange={(event) => { setPlan(event.target.value); setPage(1); }}><option value="all">All packages</option>{PLAN_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
            <button type="button" className="admin-icon-button" onClick={() => void load()} title="Refresh"><RefreshCw size={17} /></button>
            {!subscriptionsOnly ? <button type="button" className="admin-primary-button" onClick={() => setCreateOpen(true)}><Plus size={16} />Create account</button> : null}
          </div>
        </header>
        <div className="admin-table-summary"><span>{users.total} {subscriptionsOnly ? 'subscriptions' : 'users'}</span>{loading ? <Loader2 className="admin-spin" size={15} /> : null}</div>
        {error ? <div className="admin-inline-error"><AlertTriangle size={15} />{error}<button type="button" onClick={() => void load()}>Retry</button></div> : null}
        <div className="admin-table-scroll">
          <table className="admin-data-table">
            <thead><tr><th>User</th><th>{subscriptionsOnly ? 'Package' : 'Company'}</th><th>{subscriptionsOnly ? 'Usage' : 'Package'}</th><th>{subscriptionsOnly ? 'Renews' : 'Activity'}</th><th>Status</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {!loading && !users.items.length ? <tr><td colSpan={7}><EmptyState icon={subscriptionsOnly ? <CreditCard size={20} /> : <Users size={20} />} title={subscriptionsOnly ? 'No subscriptions found' : 'No users found'} body={search || status !== 'all' || plan !== 'all' ? 'Try changing your search or filters.' : subscriptionsOnly ? 'Subscriptions will appear when accounts are created.' : 'Create the first Apex account to get started.'} /></td></tr> : null}
              {users.items.map((user) => {
                const subscription = user.subscription;
                const limit = subscription?.monthly_file_limit ?? 0;
                const used = subscription?.files_used_this_period ?? 0;
                return (
                  <tr key={user.id} onClick={() => setSelectedUserId(user.id)}>
                    <td><UserCell user={user} /></td>
                    <td>{subscriptionsOnly ? <PackagePill value={subscription?.plan_name || user.selected_package} /> : <span className="admin-primary-cell">{user.company_name || '—'}</span>}</td>
                    <td>{subscriptionsOnly ? <div className="admin-usage-cell"><span><i style={{ width: `${Math.min(100, limit ? (used / limit) * 100 : 0)}%` }} /></span><small>{used} / {limit >= 9999 ? '∞' : limit}</small></div> : <PackagePill value={subscription?.plan_name || user.selected_package} />}</td>
                    <td>{subscriptionsOnly ? <span className="admin-primary-cell">{dateOnlyLabel(subscription?.period_ends_at)}</span> : <span className="admin-primary-cell">{user.stats?.builds_total ?? 0} builds</span>}</td>
                    <td><StatusPill active={user.is_active && (!subscriptionsOnly || subscription?.status === 'active')} label={subscriptionsOnly && subscription?.status !== 'active' ? subscription?.status : undefined} /></td>
                    <td><span className="admin-primary-cell">{dateLabel(user.created_at)}</span></td>
                    <td><button type="button" className="admin-icon-button admin-row-action" onClick={(event) => { event.stopPropagation(); setSelectedUserId(user.id); }}><MoreHorizontal size={17} /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="admin-pagination"><span>Page {page} of {maxPage}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} />Previous</button><button type="button" disabled={page >= maxPage} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight size={16} /></button></div></footer>
      </section>
      {createOpen ? <CreateUserModal onClose={() => setCreateOpen(false)} notify={notify} onCreated={() => { void load(); }} /> : null}
      {selectedUserId ? <UserDrawer userId={selectedUserId} currentAdminId={currentAdminId} onSelfReset={onSelfReset} onClose={() => setSelectedUserId(null)} notify={notify} onChanged={(updated) => setUsers((current) => ({ ...current, items: current.items.map((user) => user.id === updated.id ? updated : user) }))} /> : null}
    </div>
  );
}

function SubscriptionsPage({ notify, currentAdminId, onSelfReset }: { notify: (tone: Toast['tone'], message: string) => void; currentAdminId: string; onSelfReset: () => void }) {
  const [subscriptions, setSubscriptions] = useState<AdminPage<AdminSubscriptionListItem>>(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [status, setStatus] = useState('all');
  const [plan, setPlan] = useState('all');
  const [page, setPage] = useState(1);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSubscriptions(await listAdminSubscriptions({
        search: debouncedSearch,
        status,
        plan,
        page,
        page_size: 25,
        sort: 'period_ends_at',
        direction: 'asc',
      }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load subscriptions.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, plan, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const maxPage = Math.max(1, subscriptions.pages || Math.ceil(subscriptions.total / subscriptions.page_size));
  const pageCounts = PLAN_OPTIONS.map((item) => ({
    ...item,
    count: subscriptions.items.filter((subscription) => subscription.selected_package === item.key).length,
  }));

  return (
    <div className="admin-page-stack">
      <section className="admin-mini-stat-grid">
        {pageCounts.map((item) => (
          <article key={item.key}>
            <span>{item.label}</span>
            <strong>{item.count}</strong>
            <small>visible on this page</small>
          </article>
        ))}
      </section>
      <section className="admin-panel admin-table-panel">
        <header className="admin-table-toolbar">
          <div className="admin-search-field"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search subscriptions by customer…" />{search ? <button type="button" onClick={() => { setSearch(''); setPage(1); }}><X size={14} /></button> : null}</div>
          <div className="admin-toolbar-filters">
            <label><SlidersHorizontal size={15} /><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option><option value="past_due">Past due</option><option value="cancelled">Cancelled</option></select></label>
            <label><CreditCard size={15} /><select value={plan} onChange={(event) => { setPlan(event.target.value); setPage(1); }}><option value="all">All packages</option>{PLAN_OPTIONS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
            <button type="button" className="admin-icon-button" onClick={() => void load()} title="Refresh"><RefreshCw size={17} /></button>
          </div>
        </header>
        <div className="admin-table-summary"><span>{subscriptions.total} subscriptions</span>{loading ? <Loader2 className="admin-spin" size={15} /> : null}</div>
        {error ? <div className="admin-inline-error"><AlertTriangle size={15} />{error}<button type="button" onClick={() => void load()}>Retry</button></div> : null}
        <div className="admin-table-scroll">
          <table className="admin-data-table admin-subscriptions-table">
            <thead><tr><th>Customer</th><th>Package</th><th>Monthly usage</th><th>Period</th><th>Subscription</th><th>Account</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {!loading && !subscriptions.items.length ? (
                <tr><td colSpan={7}><EmptyState icon={<CreditCard size={20} />} title="No subscriptions found" body={search || status !== 'all' || plan !== 'all' ? 'Try changing your search or filters.' : 'Subscriptions will appear when accounts are provisioned.'} /></td></tr>
              ) : null}
              {subscriptions.items.map((subscription) => {
                const used = subscription.files_used_this_period;
                const limit = subscription.monthly_file_limit;
                const userForCell: AdminUser = {
                  id: subscription.user.id,
                  email: subscription.user.email,
                  display_name: subscription.user.display_name,
                  company_name: subscription.user.company_name,
                  vat_number: '', phone_number: '', country: '', selected_package: subscription.selected_package,
                  role: 'tuner', is_active: subscription.is_active, created_at: '', subscription,
                  stats: { projects_total: 0, builds_total: 0, builds_ready: 0, builds_failed: 0, purchases_total: 0, paid_by_currency: [], last_build_at: null },
                };
                return (
                  <tr key={subscription.id} onClick={() => setSelectedUserId(subscription.user.id)}>
                    <td><UserCell user={userForCell} /></td>
                    <td><PackagePill value={subscription.plan_name || subscription.selected_package} /></td>
                    <td><div className="admin-usage-cell"><span><i style={{ width: `${Math.min(100, subscription.usage_percent)}%` }} /></span><small>{used} / {limit >= 9999 ? '∞' : limit} ({Math.round(subscription.usage_percent)}%)</small></div></td>
                    <td><div className="admin-table-person"><strong>{dateOnlyLabel(subscription.period_ends_at)}</strong><small>Started {dateOnlyLabel(subscription.period_started_at)}</small></div></td>
                    <td><StatusPill active={subscription.status === 'active'} label={subscription.status.replace(/_/g, ' ')} /></td>
                    <td><StatusPill active={subscription.is_active} /></td>
                    <td><button type="button" className="admin-receipt-button" onClick={(event) => { event.stopPropagation(); setSelectedUserId(subscription.user.id); }}><Settings2 size={15} />Quick edit</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className="admin-pagination"><span>Page {page} of {maxPage}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} />Previous</button><button type="button" disabled={page >= maxPage} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight size={16} /></button></div></footer>
      </section>
      {selectedUserId ? <UserDrawer userId={selectedUserId} currentAdminId={currentAdminId} onSelfReset={onSelfReset} onClose={() => setSelectedUserId(null)} notify={notify} onChanged={() => void load()} /> : null}
    </div>
  );
}

function RecordPurchaseModal({ onClose, onCreated, notify }: { onClose: () => void; onCreated: (purchase: AdminPurchase) => void; notify: (tone: Toast['tone'], message: string) => void }) {
  const [userSearch, setUserSearch] = useState('');
  const debouncedSearch = useDebounced(userSearch, 250);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [userId, setUserId] = useState('');
  const [description, setDescription] = useState('Apex Files purchase');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [status, setStatus] = useState('paid');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!debouncedSearch.trim()) return;
    let stale = false;
    listAdminUsers({ search: debouncedSearch, page: 1, page_size: 8 })
      .then((result) => { if (!stale) setUsers(result.items); })
      .catch(() => { if (!stale) setUsers([]); });
    return () => { stale = true; };
  }, [debouncedSearch]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const cents = Math.round(Number(amount.replace(',', '.')) * 100);
      if (!Number.isFinite(cents) || cents < 0) throw new Error('Enter a valid amount.');
      const purchase = await createAdminPurchase({ user_id: userId, description, amount_minor: cents, currency, status, provider: 'manual', idempotency_key: idempotencyKey });
      notify('success', `Purchase ${purchase.receipt_number || ''} recorded.`.trim());
      onCreated(purchase);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not record purchase.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Record purchase" eyebrow="Purchase ledger" onClose={onClose} wide>
      <form className="admin-modal-form" onSubmit={submit}>
        <p className="admin-modal-copy">Record an external or manual payment. This creates a real ledger entry and printable payment record; no historical purchases are inferred.</p>
        <div className="admin-form-grid">
          <label className="is-wide admin-user-picker"><span>Customer</span><input value={userSearch} onChange={(event) => { setUserSearch(event.target.value); setUserId(''); setUsers([]); }} placeholder="Search user by name, email or company" required={!userId} />{users.length && !userId ? <div>{users.map((user) => <button type="button" key={user.id} onClick={() => { setUserId(user.id); setUserSearch(`${user.display_name || user.email} · ${user.email}`); setUsers([]); }}><UserCell user={user} /></button>)}</div> : null}</label>
          <label className="is-wide"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} required /></label>
          <label><span>Amount</span><input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
          <label><span>Currency</span><select value={currency} onChange={(event) => setCurrency(event.target.value)}><option value="USD">USD</option><option value="EUR">EUR</option><option value="SEK">SEK</option><option value="GBP">GBP</option></select></label>
          <label className="is-wide"><span>Payment status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="paid">Paid</option><option value="pending">Pending</option><option value="refunded">Refunded</option><option value="void">Void</option></select></label>
        </div>
        {error ? <div className="admin-form-error"><AlertTriangle size={15} />{error}</div> : null}
        <footer className="admin-modal-actions"><button type="button" className="admin-secondary-button" onClick={onClose}>Cancel</button><button type="submit" className="admin-primary-button" disabled={busy || !userId}>{busy ? <Loader2 className="admin-spin" size={16} /> : <FileText size={16} />}Record purchase</button></footer>
      </form>
    </Modal>
  );
}

function PurchasesPage({ notify }: { notify: (tone: Toast['tone'], message: string) => void }) {
  const [purchases, setPurchases] = useState<AdminPage<AdminPurchase>>(EMPTY_PAGE);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounced(search);
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recordOpen, setRecordOpen] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPurchases(await listAdminPurchases({ search: debouncedSearch, status, page, page_size: 25 }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not load purchases.');
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, page, status]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function receipt(purchase: AdminPurchase) {
    setDownloadingId(purchase.id);
    try {
      await downloadAdminReceipt(purchase.id, `${purchase.receipt_number || 'apex-payment-record'}.html`);
      notify('success', `Payment record ${purchase.receipt_number || ''} downloaded.`.trim());
    } catch (nextError) {
      notify('error', nextError instanceof Error ? nextError.message : 'Could not download payment record.');
    } finally {
      setDownloadingId(null);
    }
  }

  const maxPage = Math.max(1, purchases.pages || Math.ceil(purchases.total / purchases.page_size));
  const pageTotals = Object.entries(
    purchases.items
      .filter((purchase) => purchase.status === 'paid')
      .reduce<Record<string, number>>((totals, purchase) => {
        totals[purchase.currency] = (totals[purchase.currency] || 0) + purchase.amount_minor;
        return totals;
      }, {}),
  );

  return (
    <div className="admin-page-stack">
      <section className="admin-purchase-summary">
        <div><span>Entries shown</span><strong>{purchases.items.length}</strong><small>of {purchases.total} total</small></div>
        <div><span>Paid on this page</span><strong>{pageTotals.length ? pageTotals.map(([currency, amount]) => `${currency} ${money(amount, currency)}`).join(' · ') : '—'}</strong><small>Recorded ledger value by currency</small></div>
        <div className="admin-ledger-note"><FileText size={18} /><p><strong>Verified ledger only</strong><span>Purchases appear here only after they are explicitly recorded. No historical payment records are fabricated.</span></p></div>
      </section>
      <section className="admin-panel admin-table-panel">
        <header className="admin-table-toolbar">
          <div className="admin-search-field"><Search size={17} /><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Search record, customer or description…" />{search ? <button type="button" onClick={() => { setSearch(''); setPage(1); }}><X size={14} /></button> : null}</div>
          <div className="admin-toolbar-filters"><label><SlidersHorizontal size={15} /><select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="all">All statuses</option><option value="paid">Paid</option><option value="pending">Pending</option><option value="refunded">Refunded</option><option value="void">Void</option></select></label><button type="button" className="admin-icon-button" onClick={() => void load()}><RefreshCw size={17} /></button><button type="button" className="admin-primary-button" onClick={() => setRecordOpen(true)}><Plus size={16} />Record purchase</button></div>
        </header>
        <div className="admin-table-summary"><span>{purchases.total} ledger entries</span>{loading ? <Loader2 className="admin-spin" size={15} /> : null}</div>
        {error ? <div className="admin-inline-error"><AlertTriangle size={15} />{error}<button type="button" onClick={() => void load()}>Retry</button></div> : null}
        <div className="admin-table-scroll">
          <table className="admin-data-table admin-purchases-table">
            <thead><tr><th>Record</th><th>Customer</th><th>Description</th><th>Amount</th><th>Status</th><th>Date</th><th><span className="sr-only">Download</span></th></tr></thead>
            <tbody>
              {!loading && !purchases.items.length ? <tr><td colSpan={7}><EmptyState icon={<FileText size={21} />} title="No purchases recorded" body={search || status !== 'all' ? 'Try changing your search or status filter.' : 'Record a real external or manual payment to create the first payment record.'} action={!search && status === 'all' ? <button type="button" className="admin-primary-button" onClick={() => setRecordOpen(true)}><Plus size={15} />Record purchase</button> : undefined} /></td></tr> : null}
              {purchases.items.map((purchase) => (
                <tr key={purchase.id}>
                  <td><span className="admin-receipt-number"><FileText size={15} />{purchase.receipt_number || 'Pending'}</span></td>
                  <td><div className="admin-table-person"><strong>{purchase.user_name || 'Unnamed user'}</strong><small>{purchase.user_email}</small></div></td>
                  <td><span className="admin-primary-cell">{purchase.description}</span></td>
                  <td><strong className="admin-money-cell">{money(purchase.amount_minor, purchase.currency)}</strong></td>
                  <td><StatusPill active={purchase.status === 'paid'} label={purchase.status} /></td>
                  <td><span className="admin-primary-cell">{dateLabel(purchase.purchased_at || purchase.created_at)}</span></td>
                  <td><button type="button" className="admin-receipt-button" disabled={downloadingId === purchase.id} onClick={() => void receipt(purchase)}>{downloadingId === purchase.id ? <Loader2 className="admin-spin" size={15} /> : <Download size={15} />}Payment record</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <footer className="admin-pagination"><span>Page {page} of {maxPage}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} />Previous</button><button type="button" disabled={page >= maxPage} onClick={() => setPage((current) => current + 1)}>Next<ChevronRight size={16} /></button></div></footer>
      </section>
      {recordOpen ? <RecordPurchaseModal onClose={() => setRecordOpen(false)} notify={notify} onCreated={() => { setRecordOpen(false); void load(); }} /> : null}
    </div>
  );
}

function pageMeta(page: AdminPageKey) {
  if (page === 'users') return { eyebrow: 'Account management', title: 'Users', body: 'Search, create and manage every Apex Files account.' };
  if (page === 'subscriptions') return { eyebrow: 'Billing management', title: 'Subscriptions', body: 'Review package access, monthly usage and renewal periods.' };
  if (page === 'purchases') return { eyebrow: 'Financial records', title: 'Purchases & payment records', body: 'Track recorded purchases and retrieve printable payment records.' };
  return { eyebrow: 'Administration', title: 'Overview', body: 'A live view of accounts, subscriptions and file activity.' };
}

export default function AdminApp() {
  const [user, setUser] = useState<AdminSessionUser | null>(null);
  const [loading, setLoading] = useState(Boolean(readAdminToken()));
  const [activePage, setActivePage] = useState<AdminPageKey>('overview');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const accountRef = useRef<HTMLDivElement | null>(null);

  const notify = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, tone, message }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4500);
  }, []);

  useEffect(() => {
    if (!readAdminToken()) return;
    getAdminMe()
      .then((nextUser) => {
        if (nextUser.role !== 'admin') {
          clearAdminToken();
          return;
        }
        setUser(nextUser);
      })
      .catch(() => clearAdminToken())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const expired = () => setUser(null);
    window.addEventListener('apex-admin-auth-expired', expired);
    return () => window.removeEventListener('apex-admin-auth-expired', expired);
  }, []);

  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, []);

  function navigate(page: AdminPageKey) {
    setActivePage(page);
    setSidebarOpen(false);
  }

  function logout() {
    clearAdminToken();
    setUser(null);
    setAccountOpen(false);
  }

  if (loading) return <div className="admin-boot"><img src="/logos/apex-files-wordmark-white.png" alt="Apex Files" /><Loader2 className="admin-spin" size={23} /></div>;
  if (!user) return <AdminLogin onAuthed={setUser} />;

  const navItems: Array<{ key: AdminPageKey; label: string; icon: ReactNode }> = [
    { key: 'overview', label: 'Overview', icon: <LayoutDashboard size={19} /> },
    { key: 'users', label: 'Users', icon: <Users size={19} /> },
    { key: 'subscriptions', label: 'Subscriptions', icon: <CreditCard size={19} /> },
    { key: 'purchases', label: 'Purchases & records', icon: <FileText size={19} /> },
  ];
  const meta = pageMeta(activePage);

  return (
    <div className="admin-app">
      <aside className={clsx('admin-sidebar', sidebarOpen && 'is-open')}>
        <div className="admin-sidebar-brand"><img src="/logos/apex-files-wordmark-white.png" alt="Apex Files" /><span>Admin</span><button type="button" onClick={() => setSidebarOpen(false)}><X size={19} /></button></div>
        <div className="admin-sidebar-label">Workspace</div>
        <nav>
          {navItems.map((item) => <button type="button" key={item.key} className={clsx(activePage === item.key && 'is-active')} onClick={() => navigate(item.key)}>{item.icon}<span>{item.label}</span>{activePage === item.key ? <i /> : null}</button>)}
        </nav>
        <div className="admin-sidebar-foot">
          <div className="admin-system-status"><span><i />Systems operational</span><small>Administration portal</small></div>
          <a href={CUSTOMER_APP_URL}><ArrowDownRight size={16} /><span>Open customer app</span></a>
        </div>
      </aside>
      {sidebarOpen ? <button type="button" className="admin-sidebar-scrim" aria-label="Close navigation" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="admin-main-shell">
        <header className="admin-topbar">
          <button type="button" className="admin-mobile-menu" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <div className="admin-topbar-search"><Search size={16} /><button type="button" onClick={() => navigate('users')}>Search users, purchases…</button><kbd>⌘ K</kbd></div>
          <div className="admin-topbar-actions">
            <button type="button" className="admin-icon-button" aria-label="Notifications"><Bell size={18} /><i /></button>
            <div className="admin-account-menu" ref={accountRef}>
              <button type="button" onClick={() => setAccountOpen((current) => !current)}><span className="admin-avatar">{(user.display_name || user.email)[0]?.toUpperCase()}</span><span><strong>{user.display_name || 'Administrator'}</strong><small>{user.email}</small></span><ChevronDown size={15} /></button>
              {accountOpen ? <div><span>Signed in as administrator</span><a href={CUSTOMER_APP_URL}><ArrowUpRight size={15} />Customer app</a><button type="button" onClick={logout}><LogOut size={15} />Sign out</button></div> : null}
            </div>
          </div>
        </header>

        <main className="admin-workspace">
          <header className="admin-page-heading">
            <div><span>{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.body}</p></div>
            <div className="admin-page-heading-actions"><span><i />Live data</span>{activePage === 'users' ? <button type="button" className="admin-secondary-button" onClick={() => window.location.reload()}><RefreshCw size={15} />Refresh</button> : null}</div>
          </header>
          {activePage === 'overview' ? <DashboardPage onOpenUsers={() => navigate('users')} onOpenPurchases={() => navigate('purchases')} /> : null}
          {activePage === 'users' ? <UsersPage notify={notify} currentAdminId={user.id} onSelfReset={logout} /> : null}
          {activePage === 'subscriptions' ? <SubscriptionsPage notify={notify} currentAdminId={user.id} onSelfReset={logout} /> : null}
          {activePage === 'purchases' ? <PurchasesPage notify={notify} /> : null}
        </main>
      </div>
      <ToastStack toasts={toasts} dismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
