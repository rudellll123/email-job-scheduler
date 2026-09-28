const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Full backend URL for a path, e.g. for browser redirects like Google login. */
export function apiUrl(path: string): string {
  return `${API_URL}${path}`
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.body !== undefined) headers.set('Content-Type', 'application/json')

  const res = await fetch(apiUrl(path), {
    ...init,
    headers,
    credentials: 'include',
  })

  if (res.status === 204) return undefined as T

  const data: unknown = await res.json().catch(() => null)

  if (!res.ok) {
    const body = data as { message?: string; error?: string | { message?: string } } | null
    const message =
      (typeof body?.error === 'object' ? body.error?.message : body?.error) ??
      body?.message ??
      `Request failed (${res.status})`
    throw new ApiError(res.status, message)
  }

  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
}
