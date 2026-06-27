export type User = {
  id: string;
  email: string;
  display_name: string;
  company_name: string;
  role: string;
  created_at: string;
};

export type Subscription = {
  plan_name: string;
  monthly_file_limit: number;
  files_used_this_period: number;
  period_started_at: string;
  period_ends_at: string;
  status: string;
};

export type Project = {
  id: string;
  name: string;
  vehicle_label: string;
  ecu_label: string;
  source_filename: string;
  source_sha256: string;
  requested_options: Record<string, unknown>;
  last_build_id: string | null;
  created_at: string;
  updated_at: string;
};

export type BuildJob = {
  id: string;
  project_id: string | null;
  source_filename: string;
  source_sha256: string;
  source_size_bytes: number;
  vehicle_label: string;
  ecu_label: string;
  base_tune: string;
  requested_options: { addon_keys?: string[] };
  status: 'queued' | 'scanning' | 'building' | 'ready' | 'failed' | string;
  progress: number;
  current_stage: string;
  strategy: string | null;
  result_filename: string | null;
  result_sha256: string | null;
  revtech_payload: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

export type BuildMatch = {
  matched: boolean;
  message: string;
  source_filename: string;
  source_sha256: string;
  source_size_bytes: number;
  project_name: string;
  vehicle_label: string;
  ecu_label: string;
  base_tunes: string[];
  addon_keys: string[];
};

export type IntegrationStatus = {
  mode: string;
  configured: boolean;
  revtech_api_base_url: string;
  health: Record<string, unknown> | null;
  message: string | null;
};

type AuthResponse = { token: string; user: User };

const DEFAULT_API_BASE_URL = import.meta.env.DEV
  ? 'http://127.0.0.1:8787/api'
  : 'https://apex-files-backend-production.up.railway.app/api';
const API_BASE_URL = String(import.meta.env.VITE_API_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/+$/, '');
const TOKEN_KEY = 'apex-files-token';

export function readToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function writeToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function downloadUrl(jobId: string) {
  return `${API_BASE_URL}/builds/${encodeURIComponent(jobId)}/download`;
}

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = readToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', headers.get('Content-Type') || 'application/json');
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers,
  });
  const contentType = response.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');

  if (!response.ok) {
    let message = response.statusText;
    if (isJson) {
      const data = await response.json().catch(() => null);
      if (Array.isArray(data?.detail)) {
        message = data.detail
          .map((item: { msg?: string } | string) => (typeof item === 'string' ? item : item?.msg))
          .filter(Boolean)
          .join(' ');
      } else {
        message = String(data?.detail || data?.message || message);
      }
    } else {
      message = (await response.text().catch(() => '')) || message;
    }
    if (response.status >= 500 && /internal server error/i.test(message)) {
      message = 'Something went wrong while processing the request. Please try again.';
    }
    throw new Error(message);
  }

  if (response.status === 204) return null as T;
  return (isJson ? response.json() : response.text()) as Promise<T>;
}

export async function login(email: string, password: string) {
  const data = await apiFetch<AuthResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  writeToken(data.token);
  return data.user;
}

export async function register(input: {
  email: string;
  password: string;
  display_name: string;
  company_name: string;
}) {
  const data = await apiFetch<AuthResponse>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(input),
  });
  writeToken(data.token);
  return data.user;
}

export const getMe = () => apiFetch<User>('/auth/me');
export const getSubscription = () => apiFetch<Subscription>('/subscription');
export const listProjects = () => apiFetch<Project[]>('/projects');
export const listBuilds = () => apiFetch<{ items: BuildJob[] }>('/builds');
export const getBuild = (jobId: string) => apiFetch<BuildJob>(`/builds/${encodeURIComponent(jobId)}`);
export const getIntegrationStatus = () => apiFetch<IntegrationStatus>('/integrations/revtech');

export async function findBuildMatch(file: File) {
  const form = new FormData();
  form.append('file', file);
  return apiFetch<BuildMatch>('/builds/match', { method: 'POST', body: form });
}

export async function createBuild(input: {
  file: File;
  base_tune: string;
  addon_keys: string[];
  vehicle_label: string;
  ecu_label: string;
  project_id?: string;
  save_project: boolean;
  project_name: string;
}) {
  const form = new FormData();
  form.append('file', input.file);
  form.append('base_tune', input.base_tune);
  form.append('addon_keys', JSON.stringify(input.addon_keys));
  form.append('vehicle_label', input.vehicle_label);
  form.append('ecu_label', input.ecu_label);
  form.append('save_project', input.save_project ? 'true' : 'false');
  form.append('project_name', input.project_name);
  if (input.project_id) form.append('project_id', input.project_id);
  return apiFetch<BuildJob>('/builds', { method: 'POST', body: form });
}

export async function downloadBuild(jobId: string, filename?: string | null) {
  const token = readToken();
  const response = await fetch(downloadUrl(jobId), {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  if (!response.ok) throw new Error(await response.text());
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename || 'apex-file.bin';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
