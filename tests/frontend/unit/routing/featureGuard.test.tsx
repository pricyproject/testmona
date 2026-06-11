import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { FeatureGuard } from '@/components/FeatureGuard';
import type { Project } from '@/stores/projectStore';

vi.mock('@/hooks/useTranslation', () => ({
  useTranslation: () => ({ t: (key: string) => key, isRTL: false, language: 'en' }),
}));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: vi.fn(),
}));

import { useProjectStore } from '@/stores/projectStore';
const mockStore = vi.mocked(useProjectStore);

const mkProject = (id: number, features?: Record<string, boolean>): Project => ({
  id,
  name: `Project ${id}`,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
  features: features ?? null,
});

function renderWithRoute(
  projectId: string | undefined,
  feature: string,
  children = <span data-testid="children">content</span>,
) {
  const path = projectId ? `/projects/${projectId}/page` : '/page';
  const routePath = projectId ? '/projects/:projectId/page' : '/page';
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<FeatureGuard feature={feature as any}>{children}</FeatureGuard>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockStore.mockReturnValue({ projects: [], selectedProject: null } as any);
});

// ---------------------------------------------------------------------------
// Feature enabled
// ---------------------------------------------------------------------------

describe('FeatureGuard — feature enabled', () => {
  it('renders children when the project has null features (defaults to enabled)', () => {
    const project = mkProject(1);
    mockStore.mockReturnValue({ projects: [project], selectedProject: project } as any);
    renderWithRoute('1', 'defects');
    expect(screen.getByTestId('children')).toBeInTheDocument();
  });

  it('renders children when the feature is explicitly true', () => {
    const project = mkProject(1, { defects: true });
    mockStore.mockReturnValue({ projects: [project], selectedProject: project } as any);
    renderWithRoute('1', 'defects');
    expect(screen.getByTestId('children')).toBeInTheDocument();
  });

  it('defaults to enabled when no project is found in the store', () => {
    mockStore.mockReturnValue({ projects: [], selectedProject: null } as any);
    renderWithRoute('99', 'defects');
    expect(screen.getByTestId('children')).toBeInTheDocument();
  });

  it('uses selectedProject when the projectId param is absent', () => {
    const selected = mkProject(1, { test_cases: true });
    mockStore.mockReturnValue({ projects: [], selectedProject: selected } as any);
    renderWithRoute(undefined, 'test_cases');
    expect(screen.getByTestId('children')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Feature disabled
// ---------------------------------------------------------------------------

describe('FeatureGuard — feature disabled', () => {
  it('renders the blocked UI when the feature is explicitly false', () => {
    const project = mkProject(1, { defects: false });
    mockStore.mockReturnValue({ projects: [project], selectedProject: project } as any);
    renderWithRoute('1', 'defects');
    expect(screen.queryByTestId('children')).not.toBeInTheDocument();
    expect(screen.getByText('featureDisabledTitle')).toBeInTheDocument();
  });

  it('shows the blocked UI based on selectedProject when projectId is not in the list', () => {
    const selected = mkProject(99, { requirements: false });
    // Project 99 is not in the projects array; guard falls back to selectedProject
    mockStore.mockReturnValue({ projects: [mkProject(1)], selectedProject: selected } as any);
    renderWithRoute('99', 'requirements');
    expect(screen.getByText('featureDisabledTitle')).toBeInTheDocument();
  });

  it('uses selectedProject when there is no projectId param and feature is disabled', () => {
    const selected = mkProject(1, { test_cases: false });
    mockStore.mockReturnValue({ projects: [], selectedProject: selected } as any);
    renderWithRoute(undefined, 'test_cases');
    expect(screen.getByText('featureDisabledTitle')).toBeInTheDocument();
  });

  it('renders the settings navigation button in the blocked UI', () => {
    const project = mkProject(1, { reports: false });
    mockStore.mockReturnValue({ projects: [project], selectedProject: project } as any);
    renderWithRoute('1', 'reports');
    expect(screen.getByText('projectSettings')).toBeInTheDocument();
  });
});
