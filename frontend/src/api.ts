export type Role = 'patient' | 'student' | 'researcher' | 'doctor';
export type User = { id: number; username: string; role: Role; approved: boolean };
export type Health = { status: string; service: string; prediction_available: boolean };
export type Feature = { name: string; label: string; group: string; description: string; minimum: number; unit: string | null };
export type FeatureSchema = { feature_order: string[]; groups: { id: string; label: string; description: string }[]; features: Feature[]; disclaimer: string };
export type Resource = { id: string; audience: string[]; category: string; title: string; summary: string; body: string[]; source: { label: string; url: string }; reading_minutes: number; tags: string[] };
export type Payload = { sample_id: string | null; features: Record<string, number> };
export type Validation = { status: 'valid'; sample_id: string | null; feature_count: number; features: Record<string, number>; feature_order: string[] };
export type Prediction = { status: 'completed'; prediction: 'benign' | 'malignant'; probability: number | null; sample_id: string | null };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const base = (import.meta.env?.VITE_API_BASE_URL || '').replace(/\/$/, '');

const TOKEN_KEY = 'cellscope_token';
export const getToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
const setToken = (token: string | null) => {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch { /* storage unavailable */ }
};

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const requestToken = getToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${base}/api/v1${path}`, {
      credentials: 'include',
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}),
        ...options.headers,
      },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401 && path !== '/auth/login' && getToken() === requestToken) setToken(null);

      const detail = data?.detail;
      const message = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((item: { msg: string }) => item.msg).join('; ')
        : detail?.message || 'The request could not be completed.';
      throw new ApiError(message, response.status, detail?.code);
    }
    if (data === null) throw new ApiError('The service returned an unreadable response. Please try again later.', response.status);

    if (path === '/auth/login' && (data as { access_token?: string }).access_token) {
      setToken((data as { access_token: string }).access_token);
    }
    if (path === '/auth/logout') setToken(null);
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(controller.signal.aborted
      ? 'The server took too long to respond. Please try again.'
      : 'We could not reach the service. Please try again shortly.', 0);
  } finally {
    window.clearTimeout(timeout);
  }
}

export function canAssess(user: User | null): boolean {
  return !!user && user.role !== 'patient' && user.approved;
}

export function canPredict(user: User | null): boolean {
  return !!user && user.approved && (user.role === 'doctor' || user.role === 'researcher');
}

export function validateValues(values: Record<string, string>, schema: FeatureSchema): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of schema.features) {
    const raw = values[field.name]?.trim() ?? '';
    const value = Number(raw);
    if (!raw) errors[field.name] = 'Enter a measurement.';
    else if (!Number.isFinite(value) || value < field.minimum) errors[field.name] = 'Use a finite, non-negative number.';
  }
  return errors;
}

export function parseImport(text: string, schema: FeatureSchema): { sample_id: string; values: Record<string, string> } {
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data) || !data.features || typeof data.features !== 'object' || Array.isArray(data.features)) {
    throw new Error('Use a JSON object with a features object and an optional sample_id.');
  }
  if (Object.keys(data).some((key) => !['features', 'sample_id'].includes(key))) throw new Error('The file contains unexpected top-level fields.');
  const keys = Object.keys(data.features);
  if (keys.length !== schema.feature_order.length || keys.some((key) => !schema.feature_order.includes(key))) {
    throw new Error(`The file must contain exactly ${schema.feature_order.length} named measurements.`);
  }
  const values: Record<string, string> = {};
  for (const field of schema.features) {
    const value = data.features[field.name];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < field.minimum) throw new Error(`Invalid value for ${field.name}.`);
    values[field.name] = String(value);
  }
  const sample = data.sample_id;
  if (sample != null && (typeof sample !== 'string' || sample.length > 80)) throw new Error('Case reference must be a string of at most 80 characters.');
  return { sample_id: sample || '', values };
}

export function downloadJson(payload: Payload, filename = 'breast-cancer-assessment.json') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function upload<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const token = getToken();
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch(`${base}/api/v1${path}`, {
      method: 'POST',
      body, // no Content-Type: the browser sets the multipart boundary
      credentials: 'include',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const detail = data?.detail;
      const message = typeof detail === 'string' ? detail
        : Array.isArray(detail) ? detail.map((item: { msg: string }) => item.msg).join('; ')
        : detail?.message || 'The request could not be completed.';
      throw new ApiError(message, response.status, detail?.code);
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('We could not reach the service. Please try again shortly.', 0);
  } finally {
    window.clearTimeout(timeout);
  }
}
