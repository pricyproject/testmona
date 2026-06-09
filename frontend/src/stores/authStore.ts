import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authAPI } from '@/lib/api';
import axios from 'axios';

// Auto-login for development
const attemptDevAutoLogin = async () => {
  // Only attempt auto-login if explicitly enabled via environment variable
  // This prevents accidental deployment of hardcoded credentials to production
  const devAutoLoginEnabled = import.meta.env.VITE_DEV_AUTO_LOGIN === 'true';

  if (import.meta.env.DEV && devAutoLoginEnabled && !localStorage.getItem('auth-storage')) {
    const devEmail = import.meta.env.VITE_DEV_EMAIL;
    const devPassword = import.meta.env.VITE_DEV_PASSWORD;
    
    if (!devEmail || !devPassword) {
      console.warn('Development auto-login enabled but VITE_DEV_EMAIL or VITE_DEV_PASSWORD not set');
      return false;
    }
    
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(devEmail)) {
      console.warn('Development auto-login: Invalid email format in VITE_DEV_EMAIL');
      return false;
    }
    
    if (devPassword.length < 6) {
      console.warn('Development auto-login: Password too short (minimum 6 characters)');
      return false;
    }
    
    try {
      await authAPI.login(devEmail, devPassword);
      return true;
    } catch (error) {
        return false;
    }
  }
  return false;
};

// Helper functions for the in-memory token fallback. Browser persistence uses
// HttpOnly cookies set by the backend.
const setRefreshTokenCookie = (_token: string) => {
  localStorage.removeItem('refreshToken');
};

const getRefreshTokenCookie = (): string | null => {
  return useAuthStore.getState().refreshToken;
};

const removeRefreshTokenCookie = () => {
  // Clear legacy localStorage tokens if they exist from older sessions.
  localStorage.removeItem('refreshToken');
};

interface User {
  id: number;
  username: string;
  email: string;
  full_name?: string;
  bio?: string;
  location?: string;
  website?: string;
  company?: string;
  role: string;
  is_active: boolean;
  is_superuser: boolean;
  force_password_change: boolean;
  created_at: string;
  updated_at?: string;
  avatar_url?: string;
  two_factor_enabled: boolean;
  session_version: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  language: 'en' | 'fa' | 'ar';
  languageExplicitlySet: boolean;
  compactMode: boolean;
  appName: string;
  appLogoUrl: string;
  login: (usernameOrEmail: string, password: string, twoFactorCode?: string) => Promise<boolean | 'requires_2fa'>;
  logout: () => void;
  setUser: (user: User) => void;
  setLanguage: (language: 'en' | 'fa' | 'ar') => void;
  // Applies a backend/system default language without marking it as the
  // user's explicit choice (so a real preference is never overwritten).
  applyDefaultLanguage: (language: 'en' | 'fa' | 'ar') => void;
  setCompactMode: (compactMode: boolean) => void;
  setAppName: (appName: string) => void;
  setAppLogoUrl: (appLogoUrl: string) => void;
  refreshAccessToken: () => Promise<void>;
  initializeDevAuth: () => Promise<void>;
  _isLoggingIn: boolean;
  _loginPromise: Promise<boolean | 'requires_2fa'> | null;
}

const applyCompactModeToDocument = (compactMode: boolean) => {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  root.classList.toggle('compact-mode', compactMode);
  root.dataset.uiDensity = compactMode ? 'compact' : 'comfortable';
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      language: 'en',
      languageExplicitlySet: false,
      compactMode: false,
      appName: 'TestMona',
      appLogoUrl: '',
      _isLoggingIn: false,
      _loginPromise: null,

      login: async (usernameOrEmail: string, password: string, twoFactorCode?: string) => {
        // Prevent concurrent login requests
        if (get()._isLoggingIn) {
          // If already logging in, wait for the existing promise
          if (get()._loginPromise) {
            return await get()._loginPromise;
          }
          return false;
        }

        const loginPromise = (async () => {
          try {
            const authData = await authAPI.login(usernameOrEmail, password, twoFactorCode);

            if (authData.requires_2fa) {
              return 'requires_2fa';
            }

            if (!authData.access_token) {
              throw new Error('Login did not return an access token');
            }
            
            localStorage.removeItem('token');
            
            // Store refresh token (will be HttpOnly cookie in production)
            if (authData.refresh_token) {
              setRefreshTokenCookie(authData.refresh_token);
            }
            
            // Get user data
            const userData = await authAPI.getCurrentUser();
            
            set({
              user: userData,
              token: authData.access_token,
              refreshToken: authData.refresh_token || null,
              isAuthenticated: true,
            });

            // Return force_password_change flag for UI handling
            return authData.force_password_change || false;
          } catch (error) {
            console.error('Login failed:', error);
            throw error;
          } finally {
            set({ _isLoggingIn: false, _loginPromise: null });
          }
        })();

        set({ _isLoggingIn: true, _loginPromise: loginPromise });
        return await loginPromise;
      },

      logout: async () => {
        try {
          // Call logout endpoint to invalidate refresh tokens
          const refreshToken = getRefreshTokenCookie();
          if (refreshToken) {
            await authAPI.logout({ refresh_token: refreshToken });
          }
        } catch (error) {
          console.error('Logout API call failed:', error);
        }
        
        // Clear legacy localStorage tokens if they exist from older sessions.
        localStorage.removeItem('token');
        removeRefreshTokenCookie();
        
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
        });
      },

      setUser: (user: User) => {
        set({ user });
      },

      setLanguage: (language: 'en' | 'fa' | 'ar') => {
        // An explicit user/admin choice — remember it so the system default
        // never overrides it later.
        set({ language, languageExplicitlySet: true });
      },

      applyDefaultLanguage: (language: 'en' | 'fa' | 'ar') => {
        if (!get().languageExplicitlySet) {
          set({ language });
        }
      },

      setCompactMode: (compactMode: boolean) => {
        set({ compactMode });
        applyCompactModeToDocument(compactMode);
      },

      setAppName: (appName: string) => {
        set({ appName });
      },

      setAppLogoUrl: (appLogoUrl: string) => {
        set({ appLogoUrl });
      },

      refreshAccessToken: async () => {
        try {
          const refreshToken = getRefreshTokenCookie();
          if (!refreshToken) {
            throw new Error('No refresh token available');
          }

          const authData = await authAPI.refreshToken(refreshToken);
          
          // Update refresh token fallback (cookie rotation is handled by backend)
          if (authData.refresh_token) {
            setRefreshTokenCookie(authData.refresh_token);
          }
          
          set({
            token: authData.access_token,
            refreshToken: authData.refresh_token || refreshToken,
          });
        } catch (error) {
          console.error('Token refresh failed:', error);
          // If refresh fails, logout the user
          get().logout();
          throw error;
        }
      },

      // Initialize development auto-login
      initializeDevAuth: async () => {
        if (import.meta.env.DEV && !get().isAuthenticated) {
          const success = await attemptDevAutoLogin();
          if (success) {
            // Reload user data after successful auto-login
            try {
              const userData = await authAPI.getCurrentUser();
              set({
                user: userData,
                token: null,
                refreshToken: null,
                isAuthenticated: true,
              });
            } catch (error) {
              console.error('Failed to load user data after auto-login:', error);
            }
          }
        } else {
          localStorage.removeItem('token');
          localStorage.removeItem('refreshToken');
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state: AuthState) => ({
        user: state.user,
        language: state.language,
        languageExplicitlySet: state.languageExplicitlySet,
        compactMode: state.compactMode,
        appName: state.appName,
        appLogoUrl: state.appLogoUrl,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.token = null;
          state.refreshToken = null;
          state.isAuthenticated = false;
          state._isLoggingIn = false;
          state._loginPromise = null;
        }
      },
    }
  )
);

let authInitializationPromise: Promise<void> | null = null;

// Initialize localStorage sync after store creation
export const initializeAuthFromLocalStorage = async () => {
  if (authInitializationPromise) {
    await authInitializationPromise;
    return;
  }

  authInitializationPromise = (async () => {
  localStorage.removeItem('token');
  localStorage.removeItem('refreshToken');

  try {
    const userData = await authAPI.getCurrentUser();
    useAuthStore.setState({
      user: userData,
      token: null,
      refreshToken: null,
      isAuthenticated: true,
    });
  } catch (error) {
    if (!axios.isAxiosError(error) || error.response?.status !== 401) {
      console.warn('Session validation failed, clearing auth state');
    }
    useAuthStore.setState({
      token: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,
    });
  }
  })();

  try {
    await authInitializationPromise;
  } finally {
    authInitializationPromise = null;
  }
};
