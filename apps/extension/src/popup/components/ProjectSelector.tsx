import IconFolder from "@tabler/icons-react/dist/esm/icons/IconFolder.mjs";
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
        className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1.5"
      >
        <IconFolder className="w-3.5 h-3.5" aria-hidden="true" />
        <span>Project (optional)</span>
      </label>
      <select
        id="project-select"
        name="project"
        value={selectedId ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="w-full px-3 py-2 text-sm text-slate-950 border border-slate-200 rounded-lg bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:border-transparent"
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
