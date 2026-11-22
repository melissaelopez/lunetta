/**
 * Client-only storage for the user's personal Gemini API key.
 *
 * Intentionally separate from `useSettings.ts` so the key is NEVER synced to
 * `/api/babies/:uid/settings`, Firestore, or SQLite. Defaults to `sessionStorage`
 * (cleared when the browser session ends) unless the user explicitly chooses
 * "Remember on this device" (`localStorage`).
 */

const STORAGE_KEY = 'lunetta_gemini_api_key';
const CHANGE_EVENT = 'lunetta:gemini-key-changed';

export type GeminiKeyStorageMode = 'session' | 'device' | null;

function notify(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
  }
}

export function getGeminiKey(): string | null {
  try {
    const sessionVal = sessionStorage.getItem(STORAGE_KEY)?.trim();
    if (sessionVal) return sessionVal;
    const localVal = localStorage.getItem(STORAGE_KEY)?.trim();
    if (localVal) return localVal;
  } catch {
    // Storage unavailable
  }
  return null;
}

export function getGeminiKeyMode(): GeminiKeyStorageMode {
  try {
    if (sessionStorage.getItem(STORAGE_KEY)?.trim()) return 'session';
    if (localStorage.getItem(STORAGE_KEY)?.trim()) return 'device';
  } catch {
    // Storage unavailable
  }
  return null;
}

export function setGeminiKey(rawKey: string, rememberOnDevice: boolean): void {
  const key = rawKey.trim();
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
    if (key) {
      if (rememberOnDevice) localStorage.setItem(STORAGE_KEY, key);
      else sessionStorage.setItem(STORAGE_KEY, key);
    }
  } catch {
    // Ignore storage quota / privacy mode errors
  }
  notify();
}

export function clearGeminiKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage errors
  }
  notify();
}

export function subscribeGeminiKey(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}
