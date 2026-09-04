/**
 * Thin fetch wrapper — adds Authorization header from in-memory token
 * and handles auto-refresh on 401.
 *
 * Every transport below (JSON, save-to-disk, open-in-tab, object-URL) goes
 * through the SAME `authedFetch`, which owns the auth header and the
 * refresh-once-on-401 retry. They used to be four hand-copied variants of that
 * logic and `download()` had lost the retry branch in the copy: after the
 * access token expired, «Экспорт в XLSX» threw `Download failed: HTTP 401` and
 * only a page reload fixed it, even with a perfectly valid refresh cookie.
 */

import { getAccessToken, refresh } from './auth-store';
import { noteServerDate } from './clock';

const BASE = '/api/v1';

/**
 * Authenticated fetch with a single refresh-and-retry on 401.
 *
 * The retry is attempted only when a token was actually sent — an anonymous
 * 401 is a genuine authorization answer, not an expiry, and refreshing on it
 * would spend a round-trip to fail the same way. `retry` is consumed by the
 * recursive call so a server that answers 401 to the refreshed token too
 * terminates after exactly two requests instead of looping.
 */
async function authedFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = getAccessToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, { ...init, headers, credentials: 'include' });

  // S1 (kassa vaqti, 2026-09-04) — javobning `Date` sarlavhasidan server soati
  // bilan farqni yangilaydi. Qo'shimcha so'rov YO'Q, funksiya hech qachon
  // otmaydi va quyidagi 401-refresh shoxiga tegmaydi.
  noteServerDate(res);

  if (res.status === 401 && retry && token) {
    const refreshed = await refresh();
    if (refreshed) return authedFetch(path, init, false);
  }
  return res;
}

/** Content-Disposition filename, falling back to the caller's suggestion. */
function filenameFrom(res: Response, fallback: string): string {
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\s*=\s*"?([^";]+)"?/i.exec(disposition);
  return match?.[1] ?? fallback;
}

/** Turn a binary response into a browser save-dialog. */
async function saveBlobAs(res: Response, fallbackFilename: string): Promise<void> {
  const filename = filenameFrom(res, fallbackFilename);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await authedFetch(path, {
    ...init,
    headers: {
      Accept: 'application/json',
      // Only declare a JSON content-type when we actually send a body. A body-less
      // request (GET, DELETE) carrying `Content-Type: application/json` is rejected
      // by the Next.js rewrite proxy (undici) with a 400 "Body cannot be empty when
      // content-type is set to 'application/json'" — which silently broke every
      // `api.delete` in the browser. The backend itself does not require it.
      ...(init.body != null ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { message: text };
    }
    const err = new Error((parsed as { message?: string }).message ?? `HTTP ${res.status}`);
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { status?: number; body?: unknown }).body = parsed;
    throw err;
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Download a binary response (XLSX, PDF, etc.) using the same auth as
 * `request`. Triggers a browser save dialog and resolves once kicked off.
 * Honours the server's Content-Disposition filename when present.
 */
async function download(path: string, fallbackFilename: string): Promise<void> {
  const res = await authedFetch(path);
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  await saveBlobAs(res, fallbackFilename);
}

/**
 * POST a JSON body and download the binary response (PDF, XLSX...).
 * Used by bulk-print and other server-rendered file endpoints.
 */
async function postDownload(path: string, body: unknown, fallbackFilename: string): Promise<void> {
  const res = await authedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`POST download failed: HTTP ${res.status} ${text}`);
  }
  await saveBlobAs(res, fallbackFilename);
}

/**
 * POST a JSON body and open the binary response (PDF) INLINE in a new browser
 * tab — moysklad's «Открыть в браузере» print behaviour (vs `postDownload`'s
 * save-to-disk). The blob URL is revoked after a delay so the opened tab has
 * time to load it.
 */
async function postOpenInBrowser(path: string, body: unknown): Promise<void> {
  const res = await authedFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Print failed: HTTP ${res.status} ${text}`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  // Give the new tab time to fetch the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Sherset KEEP (debts receipt-viewer / telegram media) — B3. Fetches a protected
// file as an object URL. Caller MUST URL.revokeObjectURL(url) when done.
async function blobUrl(path: string): Promise<{ url: string; mime: string }> {
  const res = await authedFetch(path);
  if (!res.ok) throw new Error(`Faylni yuklab bo'lmadi: HTTP ${res.status}`);
  const blob = await res.blob();
  return { url: URL.createObjectURL(blob), mime: blob.type };
}

export const api = {
  // `signal` — react-query'ning queryFn-signali shu yerdan fetch'ga yetadi:
  // kalit o'zgarganda (masalan, POS qidiruvida yangi matn) eskirgan so'rov
  // brauzer ulanish-slotini band qilib turmasdan bekor qilinadi.
  get: <T>(path: string, opts: { signal?: AbortSignal } = {}) =>
    request<T>(path, opts.signal ? { signal: opts.signal } : {}),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  download,
  postDownload,
  postOpenInBrowser,
  blobUrl,
};
