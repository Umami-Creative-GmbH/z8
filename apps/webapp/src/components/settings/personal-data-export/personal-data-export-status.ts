import type { PersonalDataExportSummary } from "@/lib/personal-data-export/store";

/** How often a list looks for a finished build while one is in progress. */
export const REFRESH_WHILE_BUILDING_MS = 15_000;

export function isBuilding(exports: readonly PersonalDataExportSummary[]): boolean {
	return exports.some((entry) => entry.status === "pending" || entry.status === "processing");
}
