import { describe, it, expect, beforeEach } from 'vitest';
import {
  getQueuedRequests,
  queueRequest,
  dequeueRequest,
  clearQueue,
  updateRequestRetry,
  getQueueSize,
  removeExpiredRequests,
} from '@/utils/requestQueue';

const QUEUE_KEY = 'offline_request_queue';

beforeEach(() => {
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// getQueuedRequests
// ---------------------------------------------------------------------------

describe('getQueuedRequests', () => {
  it('returns empty array when nothing is queued', () => {
    expect(getQueuedRequests()).toEqual([]);
  });

  it('returns stored requests', () => {
    const fake = [{ id: 'x', method: 'GET', url: '/test', timestamp: Date.now(), retries: 0, maxRetries: 5 }];
    localStorage.setItem(QUEUE_KEY, JSON.stringify(fake));
    expect(getQueuedRequests()).toHaveLength(1);
    expect(getQueuedRequests()[0].url).toBe('/test');
  });

  it('returns empty array when localStorage contains invalid JSON', () => {
    localStorage.setItem(QUEUE_KEY, 'NOT_JSON{{');
    expect(getQueuedRequests()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// queueRequest
// ---------------------------------------------------------------------------

describe('queueRequest', () => {
  it('adds a request to the queue', () => {
    queueRequest('POST', '/api/items', { name: 'test' });
    const queue = getQueuedRequests();
    expect(queue).toHaveLength(1);
    expect(queue[0].method).toBe('POST');
    expect(queue[0].url).toBe('/api/items');
    expect(queue[0].data).toEqual({ name: 'test' });
    expect(queue[0].retries).toBe(0);
    expect(queue[0].maxRetries).toBe(5);
  });

  it('sets a non-empty unique id on each request', () => {
    queueRequest('GET', '/a');
    queueRequest('GET', '/b');
    const [r1, r2] = getQueuedRequests();
    expect(r1.id).toBeTruthy();
    expect(r2.id).toBeTruthy();
    expect(r1.id).not.toBe(r2.id);
  });

  it('sets a recent timestamp', () => {
    const before = Date.now();
    queueRequest('GET', '/a');
    const after = Date.now();
    const { timestamp } = getQueuedRequests()[0];
    expect(timestamp).toBeGreaterThanOrEqual(before);
    expect(timestamp).toBeLessThanOrEqual(after);
  });

  it('stores optional headers', () => {
    queueRequest('POST', '/a', undefined, { Authorization: 'Bearer tok' });
    expect(getQueuedRequests()[0].headers?.Authorization).toBe('Bearer tok');
  });

  it('evicts the oldest entry when the queue exceeds 100 items', () => {
    for (let i = 0; i < 100; i++) {
      queueRequest('GET', `/url-${i}`);
    }
    const firstUrl = getQueuedRequests()[0].url;
    queueRequest('GET', '/overflow');
    const queue = getQueuedRequests();
    expect(queue).toHaveLength(100);
    expect(queue[0].url).not.toBe(firstUrl);
    expect(queue[queue.length - 1].url).toBe('/overflow');
  });
});

// ---------------------------------------------------------------------------
// dequeueRequest
// ---------------------------------------------------------------------------

describe('dequeueRequest', () => {
  it('removes a specific request by id', () => {
    queueRequest('DELETE', '/api/items/1');
    const [req] = getQueuedRequests();
    dequeueRequest(req.id);
    expect(getQueuedRequests()).toHaveLength(0);
  });

  it('leaves other requests intact', () => {
    queueRequest('GET', '/a');
    queueRequest('GET', '/b');
    const [first] = getQueuedRequests();
    dequeueRequest(first.id);
    expect(getQueuedRequests()).toHaveLength(1);
    expect(getQueuedRequests()[0].url).toBe('/b');
  });

  it('is a no-op for an unknown id', () => {
    queueRequest('GET', '/a');
    dequeueRequest('nonexistent-id');
    expect(getQueuedRequests()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// clearQueue
// ---------------------------------------------------------------------------

describe('clearQueue', () => {
  it('empties the entire queue', () => {
    queueRequest('GET', '/a');
    queueRequest('POST', '/b');
    clearQueue();
    expect(getQueuedRequests()).toEqual([]);
  });

  it('is safe to call on an already-empty queue', () => {
    expect(() => clearQueue()).not.toThrow();
    expect(getQueuedRequests()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// updateRequestRetry
// ---------------------------------------------------------------------------

describe('updateRequestRetry', () => {
  it('updates the retry count for the specified request', () => {
    queueRequest('PUT', '/api/items/2');
    const [req] = getQueuedRequests();
    updateRequestRetry(req.id, 3);
    expect(getQueuedRequests()[0].retries).toBe(3);
  });

  it('does not affect other requests in the queue', () => {
    queueRequest('GET', '/a');
    queueRequest('GET', '/b');
    const [first, second] = getQueuedRequests();
    updateRequestRetry(first.id, 2);
    expect(getQueuedRequests().find((r) => r.id === second.id)?.retries).toBe(0);
  });

  it('is a no-op for an unknown id', () => {
    queueRequest('GET', '/a');
    updateRequestRetry('unknown', 5);
    expect(getQueuedRequests()[0].retries).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getQueueSize
// ---------------------------------------------------------------------------

describe('getQueueSize', () => {
  it('returns 0 for an empty queue', () => {
    expect(getQueueSize()).toBe(0);
  });

  it('returns the correct count', () => {
    queueRequest('GET', '/a');
    queueRequest('GET', '/b');
    expect(getQueueSize()).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// removeExpiredRequests
// ---------------------------------------------------------------------------

describe('removeExpiredRequests', () => {
  it('removes requests older than 24 hours', () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([{ id: 'old', method: 'GET', url: '/stale', timestamp: old, retries: 0, maxRetries: 5 }]),
    );
    removeExpiredRequests();
    expect(getQueuedRequests()).toHaveLength(0);
  });

  it('keeps recent requests', () => {
    queueRequest('GET', '/recent');
    removeExpiredRequests();
    expect(getQueuedRequests()).toHaveLength(1);
  });

  it('only removes stale entries from a mixed queue', () => {
    const old = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([
        { id: 'old', method: 'GET', url: '/stale', timestamp: old, retries: 0, maxRetries: 5 },
        { id: 'new', method: 'POST', url: '/fresh', timestamp: Date.now(), retries: 0, maxRetries: 5 },
      ]),
    );
    removeExpiredRequests();
    const remaining = getQueuedRequests();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].url).toBe('/fresh');
  });
});
