import { api } from '@/lib/api';

// Retry configuration
export const RETRY_CONFIG = {
  maxRetries: 3,
  retryDelay: 1000, // 1 second
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENETDOWN']
};

// Timeout configuration
export const TIMEOUT_CONFIG = {
  default: 30000, // 30 seconds
  upload: 60000, // 60 seconds for uploads
  download: 60000 // 60 seconds for downloads
};

/**
 * Check if the browser is online
 */
export const isOnline = (): boolean => {
  if (typeof navigator !== 'undefined') {
    return navigator.onLine;
  }
  return true;
};

/**
 * Add online/offline event listeners
 */
export const setupNetworkListeners = (
  onOnline: () => void,
  onOffline: () => void
) => {
  if (typeof window !== 'undefined') {
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
  }
};

/**
 * Remove online/offline event listeners
 */
export const removeNetworkListeners = (
  onOnline: () => void,
  onOffline: () => void
) => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  }
};

/**
 * Sleep function for retry delays
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Retry a function with exponential backoff
 */
export const withRetry = async <T>(
  fn: () => Promise<T>,
  config = RETRY_CONFIG
): Promise<T> => {
  let lastError: Error;
  
  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = 
        config.retryableStatuses.includes(error.response?.status) ||
        config.retryableErrors.includes(error.code) ||
        error.message?.includes('timeout') ||
        error.message?.includes('network');
      
      if (!isRetryable || attempt === config.maxRetries) {
        throw error;
      }
      
      // Exponential backoff
      const delay = config.retryDelay * Math.pow(2, attempt);
      await sleep(delay);
    }
  }
  
  throw lastError!;
};

/**
 * Make an API call with timeout and retry
 */
export const apiCallWithRetry = async <T>(
  apiMethod: () => Promise<T>,
  timeout: number = TIMEOUT_CONFIG.default
): Promise<T> => {
  // Check if online
  if (!isOnline()) {
    throw new Error('You are offline. Please check your internet connection.');
  }
  
  // Add timeout
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('Request timeout')), timeout);
  });
  
  // Race between API call and timeout
  const result = await Promise.race([
    withRetry(apiMethod),
    timeoutPromise
  ]);
  
  return result;
};

/**
 * Validate API response structure
 */
export const validateApiResponse = <T>(
  response: any,
  requiredFields: string[]
): T => {
  if (!response || typeof response !== 'object') {
    throw new Error('Invalid response: Expected an object');
  }
  
  for (const field of requiredFields) {
    if (!(field in response)) {
      throw new Error(`Invalid response: Missing required field '${field}'`);
    }
  }
  
  return response as T;
};

/**
 * Concurrent edit detection using localStorage
 */
export const CONCURRENT_EDIT_KEY = 'profile_edit_lock';

let editLockHeartbeat: ReturnType<typeof setInterval> | null = null;

const stopEditLockHeartbeat = (): void => {
  if (editLockHeartbeat !== null) {
    clearInterval(editLockHeartbeat);
    editLockHeartbeat = null;
  }
};

export const acquireEditLock = (userId: number): boolean => {
  try {
    const lockData = localStorage.getItem(CONCURRENT_EDIT_KEY);
    if (lockData) {
      const lock = JSON.parse(lockData);
      // Check if lock exists and is recent (within 5 minutes)
      if (lock.userId === userId && Date.now() - lock.timestamp < 300000) {
        return false; // Lock already held by this user
      }
    }
    
    // Acquire lock
    localStorage.setItem(CONCURRENT_EDIT_KEY, JSON.stringify({
      userId,
      timestamp: Date.now()
    }));
    
    // Set up heartbeat to keep lock alive
    stopEditLockHeartbeat();
    editLockHeartbeat = setInterval(() => {
      const currentLock = localStorage.getItem(CONCURRENT_EDIT_KEY);
      if (currentLock) {
        const lock = JSON.parse(currentLock);
        if (lock.userId === userId) {
          lock.timestamp = Date.now();
          localStorage.setItem(CONCURRENT_EDIT_KEY, JSON.stringify(lock));
        }
      } else {
        stopEditLockHeartbeat();
      }
    }, 60000); // Update every minute
    
    return true;
  } catch (error) {
    console.error('Failed to acquire edit lock:', error);
    return false;
  }
};

export const releaseEditLock = (userId: number): void => {
  stopEditLockHeartbeat();
  try {
    const lockData = localStorage.getItem(CONCURRENT_EDIT_KEY);
    if (lockData) {
      const lock = JSON.parse(lockData);
      if (lock.userId === userId) {
        localStorage.removeItem(CONCURRENT_EDIT_KEY);
      }
    }
  } catch (error) {
    console.error('Failed to release edit lock:', error);
  }
};

export const checkEditLock = (): { locked: boolean; userId?: number } => {
  try {
    const lockData = localStorage.getItem(CONCURRENT_EDIT_KEY);
    if (lockData) {
      const lock = JSON.parse(lockData);
      // Check if lock is recent (within 5 minutes)
      if (Date.now() - lock.timestamp < 300000) {
        return { locked: true, userId: lock.userId };
      }
    }
    return { locked: false };
  } catch (error) {
    console.error('Failed to check edit lock:', error);
    return { locked: false };
  }
};

/**
 * Safe user data access with null checks
 */
export const safeUserData = <T>(data: T | null | undefined, defaultValue: T): T => {
  if (data === null || data === undefined) {
    return defaultValue;
  }
  return data;
};
