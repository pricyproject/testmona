import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface Project {
  id: number;
  name: string;
  description?: string;
  status: string;
  owner_id?: number;
  owner_name?: string;
  /** Per-project feature toggles; missing keys default to enabled. */
  features?: Record<string, boolean> | null;
  created_at: string;
  updated_at?: string;
  test_suites_count?: number;
  test_cases_count?: number;
  test_runs_count?: number;
}

interface ProjectState {
  selectedProject: Project | null;
  projects: Project[];
  setSelectedProject: (project: Project | null) => void;
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (projectId: number) => void;
  removeProjects: (projectIds: number[]) => void;
  getSelectedProjectId: () => number | null;
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      selectedProject: null,
      projects: [],

      setSelectedProject: (project: Project | null) => {
        set({ selectedProject: project });
      },

      setProjects: (projects: Project[]) => {
        const selectedProject = get().selectedProject;
        const refreshedSelectedProject = selectedProject
          ? projects.find((project) => project.id === selectedProject.id) || selectedProject
          : null;

        set({ projects, selectedProject: refreshedSelectedProject });
      },

      addProject: (project: Project) => {
        const currentProjects = get().projects;
        set({ projects: [...currentProjects, project] });
      },

      updateProject: (project: Project) => {
        const currentProjects = get().projects;
        const updatedProjects = currentProjects.map((p) =>
          p.id === project.id ? project : p
        );
        set({ projects: updatedProjects });
        
        // Update selectedProject if it's the one being updated
        const selectedProject = get().selectedProject;
        if (selectedProject && selectedProject.id === project.id) {
          set({ selectedProject: project });
        }
      },

      removeProject: (projectId: number) => {
        get().removeProjects([projectId]);
      },

      /**
       * Drop deleted/archived projects from the list. Always route removals
       * through here rather than `setProjects`: it also clears `selectedProject`
       * when the active project is gone, which otherwise leaves the navbar and
       * sidebar pointing at a project the user can no longer open.
       */
      removeProjects: (projectIds: number[]) => {
        if (projectIds.length === 0) return;
        const removed = new Set(projectIds);
        const selectedProject = get().selectedProject;
        set({
          projects: get().projects.filter((p) => !removed.has(p.id)),
          selectedProject: selectedProject && removed.has(selectedProject.id) ? null : selectedProject,
        });
      },

      getSelectedProjectId: () => {
        const selectedProject = get().selectedProject;
        return selectedProject ? selectedProject.id : null;
      },
    }),
    {
      name: 'project-storage',
      partialize: (state) => ({
        selectedProject: state.selectedProject,
        projects: state.projects,
      }),
    }
  )
);
