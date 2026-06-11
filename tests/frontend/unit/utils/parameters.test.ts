import { describe, it, expect } from 'vitest';
import { paramsToMap, resolveParameters, referencedKeys } from '@/utils/parameters';

const ACTIVE_PARAM = { name: 'env', value: 'staging', is_active: true } as any;
const INACTIVE_PARAM = { name: 'secret', value: 'hidden', is_active: false } as any;
const NO_VALUE_PARAM = { name: 'host', value: undefined, is_active: true } as any;

describe('paramsToMap', () => {
  it('builds a name→value map from active params', () => {
    const map = paramsToMap([ACTIVE_PARAM, INACTIVE_PARAM]);
    expect(map['env']).toBe('staging');
    expect('secret' in map).toBe(false);
  });

  it('treats undefined value as empty string', () => {
    const map = paramsToMap([NO_VALUE_PARAM]);
    expect(map['host']).toBe('');
  });

  it('returns empty map for empty array', () => {
    expect(paramsToMap([])).toEqual({});
  });

  it('skips params with falsy names', () => {
    const badParam = { name: '', value: 'v', is_active: true } as any;
    expect(paramsToMap([badParam])).toEqual({});
  });
});

describe('resolveParameters', () => {
  const map = { env: 'production', host: 'localhost' };

  it('replaces known placeholders', () => {
    expect(resolveParameters('Server: ${host}', map)).toBe('Server: localhost');
    expect(resolveParameters('Env: ${env}', map)).toBe('Env: production');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(resolveParameters('URL: ${unknown}', map)).toBe('URL: ${unknown}');
  });

  it('replaces multiple placeholders in one string', () => {
    expect(resolveParameters('${host}:8080 (${env})', map)).toBe('localhost:8080 (production)');
  });

  it('tolerates whitespace inside braces', () => {
    expect(resolveParameters('${ env }', map)).toBe('production');
  });

  it('returns original when text is null/empty', () => {
    expect(resolveParameters(null, map)).toBe('');
    expect(resolveParameters('', map)).toBe('');
  });

  it('returns original when map is empty', () => {
    expect(resolveParameters('${env}', {})).toBe('${env}');
  });
});

describe('referencedKeys', () => {
  it('returns all placeholder keys in first-seen order', () => {
    expect(referencedKeys('${a} then ${b} then ${a}')).toEqual(['a', 'b']);
  });

  it('trims whitespace from keys', () => {
    expect(referencedKeys('${ env } and ${ host }')).toEqual(['env', 'host']);
  });

  it('returns empty array for text with no placeholders', () => {
    expect(referencedKeys('no placeholders here')).toEqual([]);
  });

  it('returns empty array for null/undefined', () => {
    expect(referencedKeys(null)).toEqual([]);
    expect(referencedKeys(undefined)).toEqual([]);
  });

  it('deduplicates repeated keys', () => {
    const keys = referencedKeys('${x} ${y} ${x} ${y}');
    expect(keys).toEqual(['x', 'y']);
  });
});
