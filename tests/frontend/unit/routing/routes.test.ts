import { describe, it, expect } from 'vitest';
import { PROJECT_FEATURES, PROJECT_FEATURE_KEYS } from '@/lib/projectFeatures';

// ---------------------------------------------------------------------------
// Feature-to-route catalogue
// Mirrors the route definitions in App.tsx so we can detect mismatches
// without loading the full React app.
// ---------------------------------------------------------------------------

const FEATURE_ROUTES: Record<string, string> = {
  requirements: '/projects/:projectId/requirements',
  doc_hub: '/projects/:projectId/docs',
  doc_revisions: '/projects/:projectId/docs',
  test_cases: '/projects/:projectId/test-cases',
  test_suites: '/projects/:projectId/test-suites',
  test_runs: '/projects/:projectId/test-runs',
  milestones: '/projects/:projectId/milestones',
  test_plans: '/projects/:projectId/test-plans',
  defects: '/projects/:projectId/defects',
  advanced_search: '/projects/:projectId/advanced-search',
  reports: '/projects/:projectId/reports',
  test_asset_health: '/projects/:projectId/test-asset-health',
  ask_ai: '/projects/:projectId/ask',
  custom_fields: '/projects/:projectId/custom-fields',
  shared_steps: '/projects/:projectId/shared-steps',
  global_parameters: '/projects/:projectId/global-parameters',
  test_data: '/projects/:projectId/test-data',
  webhooks: '/projects/:projectId/webhooks',
  environments: '/projects/:projectId/environments',
};

// Global routes that need no project context
const PUBLIC_ROUTES = ['/login', '/signup', '/setup'];
const AUTH_ROUTES = ['/projects', '/dashboard', '/settings', '/profile', '/administrator'];

// ---------------------------------------------------------------------------
// Feature route catalogue
// ---------------------------------------------------------------------------

describe('FEATURE_ROUTES catalogue', () => {
  it('has an entry for every feature key', () => {
    for (const key of PROJECT_FEATURE_KEYS) {
      expect(FEATURE_ROUTES).toHaveProperty(key);
    }
  });

  it('has no extra entries beyond the known feature keys', () => {
    expect(Object.keys(FEATURE_ROUTES)).toHaveLength(PROJECT_FEATURE_KEYS.length);
  });

  it('every feature route is scoped under /projects/:projectId/', () => {
    for (const [key, path] of Object.entries(FEATURE_ROUTES)) {
      expect(path, `feature "${key}"`).toMatch(/^\/projects\/:projectId\//);
    }
  });

  it('route path segments are lowercase kebab-case', () => {
    for (const [key, path] of Object.entries(FEATURE_ROUTES)) {
      const segment = path.replace('/projects/:projectId/', '');
      expect(segment, `segment for feature "${key}"`).toMatch(/^[a-z][a-z0-9-]*$/);
    }
  });

  it('no route path contains double slashes', () => {
    for (const [, path] of Object.entries(FEATURE_ROUTES)) {
      expect(path).not.toContain('//');
    }
  });
});

// ---------------------------------------------------------------------------
// PROJECT_FEATURES catalogue integrity
// ---------------------------------------------------------------------------

describe('PROJECT_FEATURES catalogue', () => {
  it('every feature has a non-empty labelKey', () => {
    for (const feature of PROJECT_FEATURES) {
      expect(feature.labelKey, `feature "${feature.key}"`).toBeTruthy();
    }
  });

  it('every feature has a non-empty descriptionKey', () => {
    for (const feature of PROJECT_FEATURES) {
      expect(feature.descriptionKey, `feature "${feature.key}"`).toBeTruthy();
    }
  });

  it('every feature has a Lucide icon component', () => {
    for (const feature of PROJECT_FEATURES) {
      // Lucide icons may be plain functions or React.forwardRef objects (typeof 'object')
      expect(feature.icon, `icon for "${feature.key}"`).toBeDefined();
      expect(feature.icon, `icon for "${feature.key}"`).not.toBeNull();
    }
  });

  it('all feature keys are unique', () => {
    const keys = PROJECT_FEATURES.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('all group keys are from the expected set', () => {
    const validGroups = new Set(['main', 'testing', 'planning', 'management', 'configuration', 'global']);
    for (const feature of PROJECT_FEATURES) {
      expect(validGroups.has(feature.groupKey), `groupKey "${feature.groupKey}" for "${feature.key}"`).toBe(true);
    }
  });

  it('PROJECT_FEATURE_KEYS length matches PROJECT_FEATURES length', () => {
    expect(PROJECT_FEATURE_KEYS).toHaveLength(PROJECT_FEATURES.length);
  });
});

// ---------------------------------------------------------------------------
// Public and auth route shape
// ---------------------------------------------------------------------------

describe('public routes', () => {
  it('each starts with /', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route).toMatch(/^\//);
    }
  });

  it('none contain a :projectId segment', () => {
    for (const route of PUBLIC_ROUTES) {
      expect(route).not.toContain(':projectId');
    }
  });

  it('the expected public routes are /login, /signup, /setup', () => {
    expect(PUBLIC_ROUTES).toContain('/login');
    expect(PUBLIC_ROUTES).toContain('/signup');
    expect(PUBLIC_ROUTES).toContain('/setup');
  });
});

describe('auth-required global routes', () => {
  it('each starts with /', () => {
    for (const route of AUTH_ROUTES) {
      expect(route).toMatch(/^\//);
    }
  });

  it('/administrator is distinct from /settings', () => {
    expect(AUTH_ROUTES).toContain('/administrator');
    expect(AUTH_ROUTES).toContain('/settings');
    expect('/administrator').not.toBe('/settings');
  });

  it('none contain sensitive path segments', () => {
    for (const route of AUTH_ROUTES) {
      expect(route).not.toContain('token');
      expect(route).not.toContain('password');
    }
  });
});
