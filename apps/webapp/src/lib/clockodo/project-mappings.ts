import type { ProjectMappingEntry, SavedProjectMapping } from "./types";

/**
 * The project-mapping step's starting point (#907): each Clockodo project keeps
 * the Z8 project saved by an earlier import, else the existing Z8 project with
 * the same name (ignoring case and surrounding spaces), else stays unmapped.
 * Projects are never created.
 */
export function buildProjectMappings(
	clockodoProjects: ReadonlyArray<{ id: number; name: string; customerName: string | null }>,
	z8Projects: ReadonlyArray<{ id: string; name: string }>,
	savedMappings: ReadonlyArray<SavedProjectMapping>,
): ProjectMappingEntry[] {
	const existingIds = new Set(z8Projects.map((entry) => entry.id));
	const saved = new Map(
		savedMappings
			.filter((mapping) => existingIds.has(mapping.projectId))
			.map((mapping) => [mapping.clockodoProjectId, mapping.projectId]),
	);
	const byName = new Map(z8Projects.map((entry) => [normalizedName(entry.name), entry.id]));

	return clockodoProjects.map((entry) => {
		const savedId = saved.get(entry.id);
		const nameId = byName.get(normalizedName(entry.name));
		const [projectId, source] = savedId
			? [savedId, "saved" as const]
			: nameId
				? [nameId, "name" as const]
				: [null, null];
		return {
			clockodoProjectId: entry.id,
			clockodoProjectName: entry.name,
			clockodoCustomerName: entry.customerName,
			projectId,
			source,
		};
	});
}

function normalizedName(name: string) {
	return name.trim().toLocaleLowerCase();
}
