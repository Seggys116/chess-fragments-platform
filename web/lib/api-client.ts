// API client helper for authenticated requests

export function getAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {};

  // Try to get JWT token first, fall back to access code
  const token = localStorage.getItem('fragmentarena_token');
  const accessCode = localStorage.getItem('fragmentarena_code');

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  } else if (accessCode) {
    headers['x-access-code'] = accessCode;
  }

  return headers;
}

export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const authHeaders = getAuthHeaders();

  const response = await fetch(url, {
    ...options,
    headers: {
      ...authHeaders,
      ...options.headers,
    },
  });

  // If authentication failed, redirect to login
  if (response.status === 401) {
    localStorage.removeItem('fragmentarena_token');
    localStorage.removeItem('fragmentarena_code');
    window.location.href = '/start';
  }

  return response;
}