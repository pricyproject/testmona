import { describe, it, expect } from 'vitest';
import {
  isFeatureEnabled,
  normalizeFeatures,
  PROJECT_FEATURE_KEYS,
  PROJECT_FEATURES,
} from '@/lib/projectFeatures';

describe('isFeatureEnabled', () => {
  it('defaults to true when features map is null', () => {
    expect(isFeatureEnabled(null, 'requirements')).toBe(true);
    expect(isFeatureEnabled(undefined, 'test_cases')).toBe(true);
  });

  it('defaults to true when the key is absent from the map', () => {
    expect(isFeatureEnabled({}, 'requirements')).toBe(true);
    expect(isFeatureEnabled({ test_cases: true }, 'requirements')).toBe(true);
  });

  it('returns false when the key is explicitly disabled', () => {
    expect(isFeatureEnabled({ requirements: false }, 'requirements')).toBe(false);
  });

  it('returns true when the key is explicitly enabled', () => {
    expect(isFeatureEnabled({ requirements: true }, 'requirements')).toBe(true);
  });

  it('handles unknown/future feature keys gracefully (defaults to enabled)', () => {
    expect(isFeatureEnabled({}, 'future_feature_xyz')).toBe(true);
  });
});

describe('normalizeFeatures', () => {
  it('returns all known features enabled when called with null', () => {
    const normalized = normalizeFeatures(null);
    for (const key of PROJECT_FEATURE_KEYS) {
      expect(normalized[key]).toBe(true);
    }
  });

  it('preserves explicit false values', () => {
    const normalized = normalizeFeatures({ requirements: false, doc_hub: false });
    expect(normalized.requirements).toBe(false);
    expect(normalized.doc_hub).toBe(false);
    expect(normalized.test_cases).toBe(true);
  });

  it('fills missing keys with true', () => {
    const normalized = normalizeFeatures({ requirements: true });
    for (const key of PROJECT_FEATURE_KEYS) {
      if (key !== 'requirements') {
        expect(normalized[key]).toBe(true);
      }
    }
    expect(normalized.requirements).toBe(true);
  });

  it('output contains all keys from PROJECT_FEATURE_KEYS', () => {
    const normalized = normalizeFeatures({});
    for (const key of PROJECT_FEATURE_KEYS) {
      expect(key in normalized).toBe(true);
    }
  });
});

describe('PROJECT_FEATURES catalog', () => {
  it('has a non-empty list', () => {
    expect(PROJECT_FEATURES.length).toBeGreaterThan(0);
  });

  it('every feature has required fields', () => {
    for (const f of PROJECT_FEATURES) {
      expect(f.key).toBeTruthy();
      expect(f.labelKey).toBeTruthy();
      expect(f.descriptionKey).toBeTruthy();
      expect(f.icon).toBeTruthy();
      expect(f.groupKey).toBeTruthy();
    }
  });

  it('feature keys are unique', () => {
    const keys = PROJECT_FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('PROJECT_FEATURE_KEYS matches the catalog keys', () => {
    const catalogKeys = PROJECT_FEATURES.map((f) => f.key).sort();
    expect([...PROJECT_FEATURE_KEYS].sort()).toEqual(catalogKeys);
  });

  it('includes the expected critical features', () => {
    const keys = new Set(PROJECT_FEATURE_KEYS);
    for (const expected of ['requirements', 'test_cases', 'defects', 'doc_hub', 'ask_ai']) {
      expect(keys.has(expected as any)).toBe(true);
    }
  });
});
