// Bearer session-token storage. The token is shown once at signup/login and
// kept in localStorage so a reload can restore the session via GET /auth/session.

const STORAGE_KEY = "lore.token";

export function loadToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, token);
  } catch {
    // Storage unavailable (private mode / disabled) — session stays in memory only.
  }
}

export function clearToken(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore — nothing persisted anyway.
  }
}
