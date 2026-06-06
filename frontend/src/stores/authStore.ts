import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { authAPI } from '@/lib/api';
import axios from 'axios';

// Auto-login for development
const attemptDevAutoLogin = async () => {
  // Only attempt auto-login if explicitly enabled via environment variable
  // This prevents accidental deployment of hardcoded credentials to production
  const devAutoLoginEnabled = import.meta.env.VITE_DEV_AUTO_LOGIN === 'true';

  if (import.meta.env.DEV && devAutoLoginEnabled && !localStorage.getItem('token')) {
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

// Helper functions for HttpOnly cookies
const setRefreshTokenCookie = (token: string) => {
  // This will be handled by the backend setting HttpOnly cookie
  // For now, we'll still store in localStorage as fallback
  localStorage.setItem('refreshToken', token);
};

const getRefreshTokenCookie = (): string | null => {
  // Try to get from HttpOnly cookie first (via backend)
  // Fallback to localStorage for development
  return localStorage.getItem('refreshToken');
};

const removeRefreshTokenCookie = () => {
  // This will be handled by backend clearing HttpOnly cookie
  // For now, clear localStorage fallback
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
  login: (usernameOrEmail: string, password: string) => Promise<boolean>;
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
  _loginPromise: Promise<boolean> | null;
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

      login: async (usernameOrEmail: string, password: string) => {
        // Prevent concurrent login requests
        if (get()._isLoggingIn) {
          // If already logging in, wait for the existing promise
          if (get()._loginPromise) {
            await get()._loginPromise;
          }
          return;
        }

        const loginPromise = (async () => {
          try {
            const authData = await authAPI.login(usernameOrEmail, password);
            
            // Store access token in localStorage (for axios interceptor)
            localStorage.setItem('token', authData.access_token);
            
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
        
        // Clear tokens from localStorage (for axios interceptor)
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
          
          // Update access token
          localStorage.setItem('token', authData.access_token);
          
          // Update refresh token (token rotation)
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
              const token = localStorage.getItem('token');
              const refreshToken = localStorage.getItem('refreshToken');
              set({
                user: userData,
                token,
                refreshToken,
                isAuthenticated: true,
              });
            } catch (error) {
              console.error('Failed to load user data after auto-login:', error);
            }
          }
        } else {
          // Even if authenticated, ensure localStorage is in sync
          const { token, refreshToken } = get();
          if (token) {
            localStorage.setItem('token', token);
          }
          if (refreshToken) {
            localStorage.setItem('refreshToken', refreshToken);
          }
        }
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state: AuthState) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
        language: state.language,
        languageExplicitlySet: state.languageExplicitlySet,
        compactMode: state.compactMode,
        appName: state.appName,
        appLogoUrl: state.appLogoUrl,
      }),
      onRehydrateStorage: () => (state) => {
        if (state && state.token) {
          // Ensure localStorage is in sync
          localStorage.setItem('token', state.token);
          if (state.refreshToken) {
            localStorage.setItem('refreshToken', state.refreshToken);
          }
          // Set isAuthenticated only if both token and user exist
          state.isAuthenticated = !!state.user;
        } else if (state) {
          // No token, ensure not authenticated
          state.isAuthenticated = false;
        }
        // Reset login state on rehydration
        if (state) {
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
  const token = localStorage.getItem('token');
  const refreshToken = localStorage.getItem('refreshToken');
  
  if (token) {
    // Sync tokens to store
    useAuthStore.setState({
      token,
      refreshToken,
    });
    
    // Validate token by attempting to fetch current user
    try {
      const userData = await authAPI.getCurrentUser();
      // Token is valid, set user and authenticated state
      useAuthStore.setState({
        user: userData,
        isAuthenticated: true,
      });
    } catch (error) {
      // Token is invalid, clear auth state
      if (!axios.isAxiosError(error) || error.response?.status !== 401) {
        console.warn('Token validation failed, clearing auth state');
      }
      localStorage.removeItem('token');
      localStorage.removeItem('refreshToken');
      useAuthStore.setState({
        token: null,
        refreshToken: null,
        user: null,
        isAuthenticated: false,
      });
    }
  }
  })();

  try {
    await authInitializationPromise;
  } finally {
    authInitializationPromise = null;
  }
};
