import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  RETRY_CONFIG,
  TIMEOUT_CONFIG,
  isOnline,
  withRetry,
  validateApiResponse,
  safeUserData,
  acquireEditLock,
  releaseEditLock,
  checkEditLock,
  CONCURRENT_EDIT_KEY,
} from '@/utils/apiHelpers';

vi.mock('@/lib/api', () => ({ api: {} }));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('RETRY_CONFIG', () => {
  it('maxRetries is 3', () => expect(RETRY_CONFIG.maxRetries).toBe(3));
  it('retryDelay is 1000 ms', () => expect(RETRY_CONFIG.retryDelay).toBe(1000));
  it('includes 429 as a retryable status', () => expect(RETRY_CONFIG.retryableStatuses).toContain(429));
  it('includes 503 as a retryable status', () => expect(RETRY_CONFIG.retryableStatuses).toContain(503));
  it('includes 500 as a retryable status', () => expect(RETRY_CONFIG.retryableStatuses).toContain(500));
});

describe('TIMEOUT_CONFIG', () => {
  it('default timeout is 30 s', () => expect(TIMEOUT_CONFIG.default).toBe(30000));
  it('upload timeout is 60 s', () => expect(TIMEOUT_CONFIG.upload).toBe(60000));
  it('download timeout is 60 s', () => expect(TIMEOUT_CONFIG.download).toBe(60000));
});

// ---------------------------------------------------------------------------
// isOnline
// ---------------------------------------------------------------------------

describe('isOnline', () => {
  it('returns true when navigator.onLine is true', () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
    expect(isOnline()).toBe(true);
  });

  it('returns false when navigator.onLine is false', () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true, writable: true });
    expect(isOnline()).toBe(false);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true, writable: true });
  });
});

// ---------------------------------------------------------------------------
// withRetry — small retryDelay (1 ms) avoids needing fake timers
// ---------------------------------------------------------------------------

describe('withRetry', () => {
  it('returns the value immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    await expect(withRetry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a non-retryable status (400)', async () => {
    const error = Object.assign(new Error('bad request'), { response: { status: 400 } });
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, { ...RETRY_CONFIG, retryDelay: 1 })).rejects.toThrow('bad request');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a 503 and returns the next success', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('unavailable'), { response: { status: 503 } }))
      .mockResolvedValue('recovered');
    await expect(withRetry(fn, { ...RETRY_CONFIG, retryDelay: 1, maxRetries: 1 })).resolves.toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('retries on a timeout-like error message', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('request timeout'))
      .mockResolvedValue('done');
    await expect(withRetry(fn, { ...RETRY_CONFIG, retryDelay: 1, maxRetries: 1 })).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    const error = Object.assign(new Error('server error'), { response: { status: 500 } });
    const fn = vi.fn().mockRejectedValue(error);
    await expect(withRetry(fn, { ...RETRY_CONFIG, maxRetries: 2, retryDelay: 1 })).rejects.toThrow('server error');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

// ---------------------------------------------------------------------------
// validateApiResponse
// ---------------------------------------------------------------------------

describe('validateApiResponse', () => {
  it('returns the response object when all required fields are present', () => {
    const resp = { id: 1, name: 'Test' };
    expect(validateApiResponse(resp, ['id', 'name'])).toBe(resp);
  });

  it('throws when a required field is missing', () => {
    expect(() => validateApiResponse({ id: 1 }, ['id', 'name'])).toThrow("Missing required field 'name'");
  });

  it('throws for a null response', () => {
    expect(() => validateApiResponse(null, ['id'])).toThrow('Expected an object');
  });

  it('throws for a string response', () => {
    expect(() => validateApiResponse('text', ['id'])).toThrow('Expected an object');
  });

  it('accepts an empty required-fields list', () => {
    expect(validateApiResponse({ id: 1 }, [])).toEqual({ id: 1 });
  });
});

// ---------------------------------------------------------------------------
// safeUserData
// ---------------------------------------------------------------------------

describe('safeUserData', () => {
  it('returns the value when it is a non-null string', () => {
    expect(safeUserData('hello', 'default')).toBe('hello');
  });

  it('returns the value when it is 0 (falsy but not null/undefined)', () => {
    expect(safeUserData(0, 99)).toBe(0);
  });

  it('returns the value when it is false', () => {
    expect(safeUserData(false, true)).toBe(false);
  });

  it('returns the default for null', () => {
    expect(safeUserData(null, 'fallback')).toBe('fallback');
  });

  it('returns the default for undefined', () => {
    expect(safeUserData(undefined, 42)).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// Edit lock (acquireEditLock / releaseEditLock / checkEditLock)
// ---------------------------------------------------------------------------

describe('edit lock', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('acquires a lock when none exists and returns true', () => {
    expect(acquireEditLock(1)).toBe(true);
    expect(localStorage.getItem(CONCURRENT_EDIT_KEY)).not.toBeNull();
  });

  it('checkEditLock reports the lock as held after acquisition', () => {
    acquireEditLock(1);
    const result = checkEditLock();
    expect(result.locked).toBe(true);
    expect(result.userId).toBe(1);
  });

  it('returns false when the same user tries to re-acquire a fresh lock', () => {
    acquireEditLock(1);
    expect(acquireEditLock(1)).toBe(false);
  });

  it('releases the lock for the correct user', () => {
    acquireEditLock(1);
    releaseEditLock(1);
    expect(checkEditLock().locked).toBe(false);
  });

  it('does not release a lock held by a different user', () => {
    acquireEditLock(1);
    releaseEditLock(2);
    expect(checkEditLock().locked).toBe(true);
  });

  it('checkEditLock returns false for a stale lock older than 5 minutes', () => {
    localStorage.setItem(
      CONCURRENT_EDIT_KEY,
      JSON.stringify({ userId: 1, timestamp: Date.now() - 301_000 }),
    );
    expect(checkEditLock().locked).toBe(false);
  });

  it('checkEditLock returns unlocked when no lock exists', () => {
    expect(checkEditLock()).toEqual({ locked: false });
  });
});
