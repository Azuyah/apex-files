export type AdminSessionUser = {
  id: string;
  email: string;
  display_name: string;
  role: string;
};

export type AdminSubscription = {
  id?: string;
  plan_name: string;
  package_key?: string;
  monthly_file_limit: number;
  files_used_this_period: number;
  period_started_at: string;
  period_ends_at: string;
  status: string;
};

export type AdminUserStats = {
  projects_total: number;
  builds_total: number;
  builds_ready: number;
  builds_failed: number;
  purchases_total: number;
  paid_by_currency: Array<{ currency: string; amount_minor: number; count: number }>;
  last_build_at: string | null;
};

export type AdminPurchase = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  description: string;
  amount_minor: number;
  currency: string;
  provider: string;
  external_reference?: string | null;
  status: string;
  receipt_number: string;
  purchased_at: string;
  created_at?: string;
};

export type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  company_name: string;
  vat_number: string;
  phone_number: string;
  country: string;
  selected_package: string;
  role: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  subscription: AdminSubscription | null;
  stats: AdminUserStats;
  recent_purchases?: AdminPurchase[];
};

export type AdminAuditEvent = {
  id: string;
  action: string;
  actor_user_id?: string | null;
  actor_email?: string;
  target_user_id?: string | null;
  target_email?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
};

export type AdminOverview = {
  total_users: number;
  active_users: number;
  disabled_users: number;
  active_subscriptions: number;
  files_delivered: number;
  builds_this_month: number;
  purchases_total: number;
  revenue_minor: number;
  currency: string;
  revenue_by_currency: Array<{ currency: string; amount_minor: number; count: number }>;
  plans: Array<{ plan_name: string; user_count: number; percentage: number }>;
  activity: Array<{ date: string; builds: number; users: number; revenue_minor: number }>;
  recent_users: AdminUser[];
  recent_purchases: AdminPurchase[];
  recent_audit_events?: AdminAuditEvent[];
};

export type AdminSubscriptionListItem = AdminSubscription & {
  user: {
    id: string;
    email: string;
    display_name: string;
    company_name: string;
  };
  is_active: boolean;
  selected_package: string;
  usage_percent: number;
};

export type AdminPage<T> = {
  items: T[];
  total: number;
  page: number;
  page_size: number;
  pages: number;
};

export type AdminUserQuery = {
  search?: string;
  status?: 'all' | 'active' | 'disabled';
  plan?: string;
  role?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
};

export type AdminPurchaseQuery = {
  search?: string;
  status?: string;
  user_id?: string;
  provider?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
};

export type AdminSubscriptionQuery = {
  search?: string;
  status?: string;
  plan?: string;
  page?: number;
  page_size?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
};

export type CreateAdminUserInput = {
  email: string;
  password: string;
  display_name: string;
  company_name: string;
  vat_number: string;
  phone_number: string;
  country: string;
  package_key: 'free' | 'lite' | 'pro';
  role: 'tuner' | 'admin';
};

export type CreateAdminPurchaseInput = {
  user_id: string;
  amount_minor: number;
  currency: string;
  description: string;
  provider?: string;
  external_reference?: string;
  idempotency_key?: string;
  status?: string;
  purchased_at?: string;
  notes?: string;
};

const DEFAULT_ADMIN_API_BASE_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:8787/api'
  : 'https://apex-files-backend-production.up.railway.app/api';
export const ADMIN_API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || DEFAULT_ADMIN_API_BASE_URL).replace(/\/+$/, '');
const ADMIN_TOKEN_KEY = 'apex-files-admin-token';

export function readAdminToken() {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY) || '';
}

export function clearAdminToken() {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

function writeAdminToken(token: string) {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

function queryString(values: Record<string, string | number | undefined>) {
  const query = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value === undefined || value === '' || value === 'all') return;
    query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

async function adminFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = readAdminToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(options.body instanceof FormData)) headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, { ...options, headers });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  if (!response.ok) {
    let message = response.statusText || 'Request failed';
    if (isJson) {
      const data = await response.json().catch(() => null);
      message = String(data?.detail || data?.message || message);
    } else {
      message = (await response.text().catch(() => '')) || message;
    }
    if (response.status === 401) {
      clearAdminToken();
      window.dispatchEvent(new Event('apex-admin-auth-expired'));
    }
    throw new Error(message);
  }
  if (response.status === 204) return null as T;
  return (isJson ? response.json() : response.text()) as Promise<T>;
}

type RawAdminStats = {
  project_count: number;
  total_builds: number;
  ready_builds: number;
  failed_builds: number;
  processing_builds: number;
  last_build_at: string | null;
  purchase_count: number;
  paid_by_currency: Array<{ currency: string; amount_minor: number; count: number }>;
};

type RawAdminUser = Omit<AdminUser, 'stats' | 'recent_purchases'> & {
  stats: RawAdminStats;
  recent_purchases?: RawAdminPurchase[];
};

type RawAdminPurchase = Omit<AdminPurchase, 'user_email' | 'user_name'> & {
  user: { id: string; email: string; display_name: string; company_name: string };
};

type RawAdminOverview = {
  users: { total: number; active: number; disabled: number; new: number };
  subscriptions: {
    by_status: Record<string, number>;
    by_plan: Record<string, number>;
    files_used_this_period: number;
    file_limit_total: number;
  };
  builds: { total: number; by_status: Record<string, number>; period_total: number; success_rate: number };
  purchases: {
    total: number;
    period_total: number;
    by_status: Record<string, number>;
    paid_by_currency: Array<{ currency: string; amount_minor: number; count: number }>;
  };
  activity: Array<{
    date: string;
    users_created: number;
    builds_total: number;
    builds_ready: number;
    builds_failed: number;
    purchases: number;
  }>;
  recent_audit_events: AdminAuditEvent[];
};

function normalizePurchase(item: RawAdminPurchase): AdminPurchase {
  return {
    ...item,
    user_email: item.user.email,
    user_name: item.user.display_name || item.user.company_name,
  };
}

function normalizeUser(item: RawAdminUser): AdminUser {
  return {
    ...item,
    stats: {
      projects_total: item.stats.project_count,
      builds_total: item.stats.total_builds,
      builds_ready: item.stats.ready_builds,
      builds_failed: item.stats.failed_builds,
      purchases_total: item.stats.purchase_count,
      paid_by_currency: item.stats.paid_by_currency || [],
      last_build_at: item.stats.last_build_at,
    },
    recent_purchases: item.recent_purchases?.map(normalizePurchase),
  };
}

export async function adminLogin(email: string, password: string) {
  const data = await adminFetch<{ token: string; user: AdminSessionUser }>('/admin/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (data.user.role !== 'admin') throw new Error('This account does not have administrator access.');
  writeAdminToken(data.token);
  return data.user;
}

export const getAdminMe = () => adminFetch<AdminSessionUser>('/admin/auth/me');
export async function getAdminOverview(days = 30): Promise<AdminOverview> {
  const data = await adminFetch<RawAdminOverview>(`/admin/overview?days=${days}`);
  const paid = data.purchases.paid_by_currency[0];
  const totalPlans = Object.values(data.subscriptions.by_plan).reduce((sum, value) => sum + value, 0);
  return {
    total_users: data.users.total,
    active_users: data.users.active,
    disabled_users: data.users.disabled,
    active_subscriptions: data.subscriptions.by_status.active || 0,
    files_delivered: data.builds.by_status.ready || 0,
    builds_this_month: data.builds.period_total,
    purchases_total: data.purchases.total,
    revenue_minor: paid?.amount_minor || 0,
    currency: paid?.currency || 'EUR',
    revenue_by_currency: data.purchases.paid_by_currency,
    plans: Object.entries(data.subscriptions.by_plan).map(([key, value]) => ({
      plan_name: key,
      user_count: value,
      percentage: totalPlans ? (value / totalPlans) * 100 : 0,
    })),
    activity: data.activity.map((item) => ({
      date: item.date,
      builds: item.builds_total,
      users: item.users_created,
      revenue_minor: 0,
    })),
    recent_users: [],
    recent_purchases: [],
    recent_audit_events: data.recent_audit_events,
  };
}
export async function listAdminUsers(input: AdminUserQuery = {}): Promise<AdminPage<AdminUser>> {
  const data = await adminFetch<AdminPage<RawAdminUser>>(`/admin/users${queryString(input)}`);
  return { ...data, items: data.items.map(normalizeUser) };
}
export async function getAdminUser(userId: string) {
  return normalizeUser(await adminFetch<RawAdminUser>(`/admin/users/${encodeURIComponent(userId)}`));
}
export async function createAdminUser(input: CreateAdminUserInput) {
  return normalizeUser(await adminFetch<RawAdminUser>('/admin/users', { method: 'POST', body: JSON.stringify(input) }));
}
export async function setAdminUserStatus(userId: string, isActive: boolean) {
  return normalizeUser(await adminFetch<RawAdminUser>(`/admin/users/${encodeURIComponent(userId)}/status`, { method: 'PATCH', body: JSON.stringify({ is_active: isActive }) }));
}
export const resetAdminUserPassword = (userId: string, temporaryPassword: string) =>
  adminFetch<{ temporary_password: string; message: string; session_version: number }>(`/admin/users/${encodeURIComponent(userId)}/password-reset`, {
    method: 'POST',
    body: JSON.stringify({ temporary_password: temporaryPassword }),
  });
export const updateAdminUserSubscription = (
  userId: string,
  input: Partial<Pick<AdminSubscription, 'package_key' | 'plan_name' | 'monthly_file_limit' | 'files_used_this_period' | 'period_started_at' | 'period_ends_at' | 'status'>>,
) => adminFetch<AdminSubscription>(`/admin/users/${encodeURIComponent(userId)}/subscription`, { method: 'PATCH', body: JSON.stringify(input) });
export const listAdminSubscriptions = (input: AdminSubscriptionQuery = {}) =>
  adminFetch<AdminPage<AdminSubscriptionListItem>>(`/admin/subscriptions${queryString(input)}`);
export async function listAdminPurchases(input: AdminPurchaseQuery = {}): Promise<AdminPage<AdminPurchase>> {
  const data = await adminFetch<AdminPage<RawAdminPurchase>>(`/admin/purchases${queryString(input)}`);
  return { ...data, items: data.items.map(normalizePurchase) };
}
export async function createAdminPurchase(input: CreateAdminPurchaseInput) {
  return normalizePurchase(await adminFetch<RawAdminPurchase>('/admin/purchases', { method: 'POST', body: JSON.stringify(input) }));
}

export async function downloadAdminReceipt(purchaseId: string, fallbackName: string) {
  const token = readAdminToken();
  const response = await fetch(`${ADMIN_API_BASE_URL}/admin/purchases/${encodeURIComponent(purchaseId)}/receipt`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (response.status === 401) {
    clearAdminToken();
    window.dispatchEvent(new Event('apex-admin-auth-expired'));
  }
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(String(data?.detail || data?.message || response.statusText));
  }
  const blob = await response.blob();
  const disposition = response.headers.get('content-disposition') || '';
  const match = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  const filename = match ? decodeURIComponent(match[1].replace(/"/g, '')) : fallbackName;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
