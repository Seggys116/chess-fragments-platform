/**
 * Client-side authentication utilities
 * Handles JWT token storage, refresh, and automatic renewal
 */

const TOKEN_KEY = 'fragmentarena_token';
const REFRESH_KEY = 'fragmentarena_refresh';
const CODE_KEY = 'fragmentarena_code';

// Token refresh threshold: refresh when token has less than 5 minutes remaining
const REFRESH_THRESHOLD_MS = 5 * 60 * 1000;

interface TokenData {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number; // seconds
  issuedAt: number; // timestamp
}

/**
 * Store tokens in localStorage
 */
export function storeTokens(accessToken: string, refreshToken?: string, expiresIn: number = 3600): void {
  const tokenData: TokenData = {
    accessToken,
    refreshToken,
    expiresIn,
    issuedAt: Date.now(),
  };

  localStorage.setItem(TOKEN_KEY, accessToken);
  if (refreshToken) {
    localStorage.setItem(REFRESH_KEY, refreshToken);
  }

  localStorage.setItem(`${TOKEN_KEY}_meta`, JSON.stringify(tokenData));
}

/**
 * Get access token from localStorage
 */
export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

/**
 * Get refresh token from localStorage
 */
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

/**
 * Get legacy access code
 */
export function getAccessCode(): string | null {
  return localStorage.getItem(CODE_KEY);
}

/**
 * Check if access token is expired or about to expire
 */
export function isTokenExpiringSoon(): boolean {
  const metaStr = localStorage.getItem(`${TOKEN_KEY}_meta`);
  if (!metaStr) return true;

  try {
    const meta: TokenData = JSON.parse(metaStr);
    const expiresAt = meta.issuedAt + (meta.expiresIn * 1000);
    const timeUntilExpiry = expiresAt - Date.now();

    return timeUntilExpiry < REFRESH_THRESHOLD_MS;
  } catch {
    return true;
  }
}

/**
 * Refresh the access token using refresh token
 */
export async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();

  if (!refreshToken) {
    console.warn('No refresh token available');
    return null;
  }

  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) {
      console.error('Token refresh failed:', response.status);
      // Clear invalid tokens
      clearTokens();
      return null;
    }

    const data = await response.json();

    if (data.accessToken) {
      storeTokens(data.accessToken, refreshToken, data.expiresIn);
      return data.accessToken;
    }

    return null;
  } catch (error) {
    console.error('Token refresh error:', error);
    return null;
  }
}

/**
 * Get valid access token (refreshes if needed)
 */
export async function getValidAccessToken(): Promise<string | null> {
  const currentToken = getAccessToken();

  if (!currentToken) {
    return null;
  }

  if (isTokenExpiringSoon()) {
    console.log('Token expiring soon, refreshing...');
    const newToken = await refreshAccessToken();
    return newToken || currentToken; // Return new token or fallback to current if refresh fails
  }

  return currentToken;
}

/**
 * Make authenticated fetch request with automatic token refresh
 */
export async function authenticatedFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getValidAccessToken();
  const accessCode = getAccessCode();

  // Add authorization header
  const headers = new Headers(options.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  } else if (accessCode) {
    // Fallback to legacy access code
    headers.set('X-Access-Code', accessCode);
  }

  const response = await fetch(url, {
    ...options,
    headers,
  });

  // If we get 401, try refreshing token once
  if (response.status === 401 && token) {
    console.log('Got 401, attempting token refresh...');
    const newToken = await refreshAccessToken();

    if (newToken) {
      // Retry request with new token
      headers.set('Authorization', `Bearer ${newToken}`);
      return fetch(url, {
        ...options,
        headers,
      });
    }
  }

  return response;
}

/**
 * Clear all tokens from localStorage
 */
export function clearTokens(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(`${TOKEN_KEY}_meta`);
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  return !!(getAccessToken() || getAccessCode());
}

/**
 * Logout user (clear all auth data)
 */
export async function logout(): Promise<void> {
  // Call logout API
  try {
    const token = getAccessToken();
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
    }
  } catch (error) {
    console.error('Logout API error:', error);
  }

  // Clear local storage
  clearTokens();
  localStorage.removeItem(CODE_KEY);
}
