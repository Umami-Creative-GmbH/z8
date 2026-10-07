import type { TravelExpenseReportKind } from "@/db/schema/travel-expense";

/**
 * Project attribution of report expenses (#605). A trip may name a project
 * that its expenses inherit; each expense either inherits it, names its own
 * project, or has none. A standalone expense has no trip to inherit from, so
 * inheriting means none.
 */

export type ItemProjectChoice =
	| { mode: "inherit" }
	| { mode: "none" }
	| { mode: "project"; projectId: string };

export interface EffectiveItemProject {
	projectId: string;
	inheritedFromTrip: boolean;
}

/** Stored item columns: `project_inherits` and, only when not inheriting, `project_id`. */
export function itemProjectChoice(item: {
	projectId?: string | null;
	projectInherits?: boolean;
}): ItemProjectChoice {
	if (item.projectInherits ?? true) return { mode: "inherit" };
	return item.projectId ? { mode: "project", projectId: item.projectId } : { mode: "none" };
}

export function itemProjectColumns(choice: ItemProjectChoice): {
	projectId: string | null;
	projectInherits: boolean;
} {
	switch (choice.mode) {
		case "inherit":
			return { projectId: null, projectInherits: true };
		case "none":
			return { projectId: null, projectInherits: false };
		case "project":
			return { projectId: choice.projectId, projectInherits: false };
	}
}

/** The project an expense is attributed to, if any. */
export function effectiveItemProject(
	report: { kind: TravelExpenseReportKind; projectId?: string | null },
	item: { projectId?: string | null; projectInherits?: boolean },
): EffectiveItemProject | null {
	const choice = itemProjectChoice(item);
	if (choice.mode === "project") return { projectId: choice.projectId, inheritedFromTrip: false };
	if (choice.mode === "none" || report.kind !== "trip" || !report.projectId) return null;
	return { projectId: report.projectId, inheritedFromTrip: true };
}
