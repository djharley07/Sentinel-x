export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers)
  headers.set('X-Sentinel-Request', '1')
  const response = await fetch(input, { ...init, headers, credentials: 'same-origin', cache: 'no-store' })
  if (response.status === 401 && !['/api/auth/login','/api/auth/me'].includes(String(input))) {
    window.dispatchEvent(new Event('sentinel-session-expired'))
  }
  return response
}
