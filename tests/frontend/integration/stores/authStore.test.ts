/**
 * Integration tests for the auth store.
 *
 * Zustand store updates are synchronous, so no React act() wrapping is needed.
 * The authAPI module is mocked to avoid real network calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/api', () => ({
  authAPI: {
    login: vi.fn(),
    logout: vi.fn(),
    refreshToken: vi.fn(),
    getCurrentUser: vi.fn(),
  },
}));

import { useAuthStore } from '@/stores/authStore';

const MOCK_USER = {
  id: 1,
  username: 'alice',
  email: 'alice@example.com',
  full_name: 'Alice Smith',
  role: 'admin',
  is_active: true,
  is_superuser: false,
  force_password_change: false,
  created_at: '2026-01-01T00:00:00Z',
  two_factor_enabled: false,
  session_version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({
    user: null,
    token: null,
    refreshToken: null,
    isAuthenticated: false,
    language: 'en',
    languageExplicitlySet: false,
    compactMode: false,
  });
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
  it('starts unauthenticated with no user', () => {
    const state = useAuthStore.getState();
    expect(state.isAuthenticated).toBe(false);
    expect(state.user).toBeNull();
    expect(state.token).toBeNull();
  });

  it('defaults to English', () => {
    expect(useAuthStore.getState().language).toBe('en');
  });

  it('compactMode is off by default', () => {
    expect(useAuthStore.getState().compactMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setUser
// ---------------------------------------------------------------------------

describe('setUser', () => {
  it('stores the user object in state', () => {
    useAuthStore.getState().setUser(MOCK_USER);
    const state = useAuthStore.getState();
    expect(state.user).toEqual(MOCK_USER);
  });

  it('does not change isAuthenticated (login() controls that flag)', () => {
    useAuthStore.getState().setUser(MOCK_USER);
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  it('updates user fields when called again', () => {
    useAuthStore.getState().setUser(MOCK_USER);
    useAuthStore.getState().setUser({ ...MOCK_USER, full_name: 'Alice Updated' });
    expect(useAuthStore.getState().user?.full_name).toBe('Alice Updated');
  });
});

// ---------------------------------------------------------------------------
// logout
// ---------------------------------------------------------------------------

describe('logout', () => {
  it('clears user after logout', () => {
    useAuthStore.getState().setUser(MOCK_USER);
    expect(useAuthStore.getState().user).not.toBeNull();
    useAuthStore.getState().logout();
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated).toBe(false);
    expect(state.token).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Language and compact mode
// ---------------------------------------------------------------------------

describe('setLanguage', () => {
  it('updates language and marks it as explicitly set', () => {
    useAuthStore.getState().setLanguage('fa');
    const state = useAuthStore.getState();
    expect(state.language).toBe('fa');
    expect(state.languageExplicitlySet).toBe(true);
  });
});

describe('applyDefaultLanguage', () => {
  it('applies a language without marking it as explicit', () => {
    useAuthStore.getState().applyDefaultLanguage('ar');
    const state = useAuthStore.getState();
    expect(state.language).toBe('ar');
    expect(state.languageExplicitlySet).toBe(false);
  });

  it('does not overwrite an explicitly-set language', () => {
    useAuthStore.getState().setLanguage('fa');          // explicit
    useAuthStore.getState().applyDefaultLanguage('en'); // system default — ignored
    expect(useAuthStore.getState().language).toBe('fa');
  });
});

describe('setCompactMode', () => {
  it('toggles compact mode on', () => {
    useAuthStore.getState().setCompactMode(true);
    expect(useAuthStore.getState().compactMode).toBe(true);
  });

  it('toggles compact mode off', () => {
    useAuthStore.getState().setCompactMode(true);
    useAuthStore.getState().setCompactMode(false);
    expect(useAuthStore.getState().compactMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setAppName / setAppLogoUrl
// ---------------------------------------------------------------------------

describe('setAppName', () => {
  it('updates the app name', () => {
    useAuthStore.getState().setAppName('My QA Tool');
    expect(useAuthStore.getState().appName).toBe('My QA Tool');
  });
});

describe('setAppLogoUrl', () => {
  it('updates the logo URL', () => {
    useAuthStore.getState().setAppLogoUrl('/logos/custom.png');
    expect(useAuthStore.getState().appLogoUrl).toBe('/logos/custom.png');
  });
});
