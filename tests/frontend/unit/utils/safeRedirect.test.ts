import { describe, it, expect } from 'vitest';
import { resolveSafeRedirect } from '@/utils/safeRedirect';

describe('resolveSafeRedirect', () => {
  // ---- null / empty cases ----

  it('returns null for null', () => {
    expect(resolveSafeRedirect(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(resolveSafeRedirect(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(resolveSafeRedirect('')).toBeNull();
  });

  it('returns null for whitespace-only', () => {
    expect(resolveSafeRedirect('   ')).toBeNull();
  });

  // ---- valid same-origin paths ----

  it('accepts a root-relative path', () => {
    expect(resolveSafeRedirect('/dashboard')).toBe('/dashboard');
  });

  it('accepts a nested path', () => {
    expect(resolveSafeRedirect('/projects/1/requirements')).toBe('/projects/1/requirements');
  });

  it('accepts a path with query string', () => {
    expect(resolveSafeRedirect('/search?q=login')).toBe('/search?q=login');
  });

  it('trims leading/trailing whitespace', () => {
    expect(resolveSafeRedirect('  /dashboard  ')).toBe('/dashboard');
  });

  // ---- open-redirect attack vectors ----

  it('blocks absolute URLs (http://)', () => {
    expect(resolveSafeRedirect('http://evil.com')).toBeNull();
  });

  it('blocks absolute URLs (https://)', () => {
    expect(resolveSafeRedirect('https://evil.com/path')).toBeNull();
  });

  it('blocks protocol-relative URLs (//)', () => {
    expect(resolveSafeRedirect('//evil.com')).toBeNull();
  });

  it('blocks backslash protocol-relative (/\\)', () => {
    expect(resolveSafeRedirect('/\\evil.com')).toBeNull();
  });

  it('blocks paths with backslashes', () => {
    expect(resolveSafeRedirect('/path\\to\\resource')).toBeNull();
  });

  it('blocks javascript: protocol', () => {
    expect(resolveSafeRedirect('javascript:alert(1)')).toBeNull();
  });

  it('blocks non-root-relative paths', () => {
    expect(resolveSafeRedirect('relative/path')).toBeNull();
  });

  // ---- auth loop prevention ----

  it('blocks /login redirect', () => {
    expect(resolveSafeRedirect('/login')).toBeNull();
  });

  it('blocks /login with query params', () => {
    expect(resolveSafeRedirect('/login?next=/dashboard')).toBeNull();
  });

  it('blocks /login/* paths', () => {
    expect(resolveSafeRedirect('/login/sso')).toBeNull();
  });

  it('blocks /signup redirect', () => {
    expect(resolveSafeRedirect('/signup')).toBeNull();
  });

  it('blocks /signup with query params', () => {
    expect(resolveSafeRedirect('/signup?invited=true')).toBeNull();
  });

  // ---- control character injection ----

  it('blocks null byte injection', () => {
    expect(resolveSafeRedirect('/path\x00injected')).toBeNull();
  });

  it('blocks other control characters', () => {
    expect(resolveSafeRedirect('/path\x0Ainjected')).toBeNull();
  });
});
