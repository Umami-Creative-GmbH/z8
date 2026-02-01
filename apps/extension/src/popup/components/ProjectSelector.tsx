import { Folder } from "lucide-react";
import type { Project } from "@/types";

interface ProjectSelectorProps {
  projects: Project[];
  selectedId: string | undefined;
  onChange: (id: string | undefined) => void;
}

export function ProjectSelector({
  projects,
  selectedId,
  onChange,
}: ProjectSelectorProps) {
  if (projects.length === 0) {
    return null;
  }

  return (
    <div className="mt-3">
      <label
        htmlFor="project-select"
        className="flex items-center gap-1.5 text-xs font-medium text-gray-600 mb-1.5"
      >
        <Folder className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Project (optional)</span>
      </label>
      <select
        id="project-select"
        name="project"
        value={selectedId ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
      >
        <option value="">No project</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
    </div>
  );
}
