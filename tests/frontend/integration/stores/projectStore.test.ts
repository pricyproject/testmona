import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore, type Project } from '@/stores/projectStore';

const mkProject = (id: number, name = `Project ${id}`): Project => ({
  id,
  name,
  description: `Desc ${id}`,
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
});

beforeEach(() => {
  useProjectStore.setState({ projects: [], selectedProject: null });
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

describe('initial state', () => {
  it('starts with an empty project list', () => {
    expect(useProjectStore.getState().projects).toEqual([]);
  });

  it('starts with no selected project', () => {
    expect(useProjectStore.getState().selectedProject).toBeNull();
  });

  it('getSelectedProjectId returns null', () => {
    expect(useProjectStore.getState().getSelectedProjectId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setProjects
// ---------------------------------------------------------------------------

describe('setProjects', () => {
  it('replaces the entire project list', () => {
    useProjectStore.getState().setProjects([mkProject(1), mkProject(2)]);
    expect(useProjectStore.getState().projects).toHaveLength(2);
  });

  it('overwrites a previously set list', () => {
    useProjectStore.getState().setProjects([mkProject(1), mkProject(2)]);
    useProjectStore.getState().setProjects([mkProject(3)]);
    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useProjectStore.getState().projects[0].id).toBe(3);
  });

  it('refreshes selectedProject with fresh data when found in the new list', () => {
    useProjectStore.getState().setSelectedProject(mkProject(1));
    const updated = { ...mkProject(1), name: 'Renamed' };
    useProjectStore.getState().setProjects([updated, mkProject(2)]);
    expect(useProjectStore.getState().selectedProject?.name).toBe('Renamed');
  });

  it('keeps the stale selectedProject when it is not found in the new list', () => {
    const original = mkProject(99);
    useProjectStore.getState().setSelectedProject(original);
    useProjectStore.getState().setProjects([mkProject(1), mkProject(2)]);
    expect(useProjectStore.getState().selectedProject).toEqual(original);
  });

  it('sets selectedProject to null when there was none and the list is empty', () => {
    useProjectStore.getState().setProjects([]);
    expect(useProjectStore.getState().selectedProject).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// setSelectedProject
// ---------------------------------------------------------------------------

describe('setSelectedProject', () => {
  it('stores the selected project', () => {
    const p = mkProject(5);
    useProjectStore.getState().setSelectedProject(p);
    expect(useProjectStore.getState().selectedProject).toEqual(p);
  });

  it('clears the selected project when called with null', () => {
    useProjectStore.getState().setSelectedProject(mkProject(1));
    useProjectStore.getState().setSelectedProject(null);
    expect(useProjectStore.getState().selectedProject).toBeNull();
  });

  it('getSelectedProjectId returns the project id when selected', () => {
    useProjectStore.getState().setSelectedProject(mkProject(42));
    expect(useProjectStore.getState().getSelectedProjectId()).toBe(42);
  });

  it('getSelectedProjectId returns null after clearing selection', () => {
    useProjectStore.getState().setSelectedProject(mkProject(1));
    useProjectStore.getState().setSelectedProject(null);
    expect(useProjectStore.getState().getSelectedProjectId()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// addProject
// ---------------------------------------------------------------------------

describe('addProject', () => {
  it('appends a project to the end of the list', () => {
    useProjectStore.getState().setProjects([mkProject(1)]);
    useProjectStore.getState().addProject(mkProject(2));
    const { projects } = useProjectStore.getState();
    expect(projects).toHaveLength(2);
    expect(projects[1].id).toBe(2);
  });

  it('works when the list is empty', () => {
    useProjectStore.getState().addProject(mkProject(1));
    expect(useProjectStore.getState().projects).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// updateProject
// ---------------------------------------------------------------------------

describe('updateProject', () => {
  it('replaces the project matching the updated id', () => {
    useProjectStore.getState().setProjects([mkProject(1), mkProject(2)]);
    useProjectStore.getState().updateProject({ ...mkProject(1), name: 'Updated Name' });
    const found = useProjectStore.getState().projects.find((p) => p.id === 1);
    expect(found?.name).toBe('Updated Name');
  });

  it('leaves other projects unchanged', () => {
    useProjectStore.getState().setProjects([mkProject(1), mkProject(2)]);
    useProjectStore.getState().updateProject({ ...mkProject(1), name: 'Changed' });
    expect(useProjectStore.getState().projects.find((p) => p.id === 2)?.name).toBe('Project 2');
  });

  it('also updates selectedProject when it is the same project', () => {
    useProjectStore.getState().setProjects([mkProject(1)]);
    useProjectStore.getState().setSelectedProject(mkProject(1));
    useProjectStore.getState().updateProject({ ...mkProject(1), name: 'New Name' });
    expect(useProjectStore.getState().selectedProject?.name).toBe('New Name');
  });

  it('does NOT update selectedProject when a different project is updated', () => {
    useProjectStore.getState().setProjects([mkProject(1), mkProject(2)]);
    useProjectStore.getState().setSelectedProject(mkProject(2));
    useProjectStore.getState().updateProject({ ...mkProject(1), name: 'Changed' });
    expect(useProjectStore.getState().selectedProject?.name).toBe('Project 2');
  });

  it('is a no-op when the id does not exist', () => {
    useProjectStore.getState().setProjects([mkProject(1)]);
    useProjectStore.getState().updateProject(mkProject(999));
    expect(useProjectStore.getState().projects).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// removeProject
// ---------------------------------------------------------------------------

describe('removeProject', () => {
  it('removes the project with the matching id', () => {
    useProjectStore.getState().setProjects([mkProject(1), mkProject(2)]);
    useProjectStore.getState().removeProject(1);
    expect(useProjectStore.getState().projects).toHaveLength(1);
    expect(useProjectStore.getState().projects[0].id).toBe(2);
  });

  it('clears selectedProject when the selected project is removed', () => {
    useProjectStore.getState().setProjects([mkProject(1)]);
    useProjectStore.getState().setSelectedProject(mkProject(1));
    useProjectStore.getState().removeProject(1);
    expect(useProjectStore.getState().selectedProject).toBeNull();
  });

  it('does NOT clear selectedProject when a different project is removed', () => {
    useProjectStore.getState().setProjects([mkProject(1), mkProject(2)]);
    useProjectStore.getState().setSelectedProject(mkProject(2));
    useProjectStore.getState().removeProject(1);
    expect(useProjectStore.getState().selectedProject?.id).toBe(2);
  });

  it('is a no-op for a non-existent id', () => {
    useProjectStore.getState().setProjects([mkProject(1)]);
    useProjectStore.getState().removeProject(999);
    expect(useProjectStore.getState().projects).toHaveLength(1);
  });

  it('results in an empty list when the only project is removed', () => {
    useProjectStore.getState().setProjects([mkProject(1)]);
    useProjectStore.getState().removeProject(1);
    expect(useProjectStore.getState().projects).toEqual([]);
  });
});
