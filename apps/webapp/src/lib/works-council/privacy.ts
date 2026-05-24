import type {
	WorksCouncilAbsenceVisibility,
	WorksCouncilIdentityVisibility,
} from "@/db/schema/works-council";

export type SuppressedValue<T> =
	| { state: "available"; count: number; value: T }
	| { state: "insufficient_data"; count: number; value: null };

export function suppressSmallGroups<T>(input: {
	count: number;
	threshold: number;
	value: T;
}): SuppressedValue<T> {
	if (input.count < input.threshold) {
		return { state: "insufficient_data", count: input.count, value: null };
	}

	return { state: "available", count: input.count, value: input.value };
}

export function applyIdentityVisibility<
	T extends { employeeId: string | null; employeeName: string | null },
>(rows: T[], visibility: WorksCouncilIdentityVisibility): T[] {
	if (visibility === "named") return rows;

	if (visibility === "aggregated") {
		return rows.map((row) => ({ ...row, employeeId: null, employeeName: null }));
	}

	const labels = new Map<string, string>();
	return rows.map((row) => {
		if (!row.employeeId) return { ...row, employeeName: null };
		if (!labels.has(row.employeeId)) {
			labels.set(row.employeeId, `Employee ${String.fromCharCode(65 + labels.size)}`);
		}
		return { ...row, employeeName: labels.get(row.employeeId) ?? "Employee" };
	});
}

export function applyAbsenceVisibility(
	row: { absenceCategory: string | null; absenceGroup: "planned" | "sick_leave" | "other" | null },
	visibility: WorksCouncilAbsenceVisibility,
): { absenceCategory: string | null } {
	if (visibility === "hidden") return { absenceCategory: null };
	if (visibility === "grouped") return { absenceCategory: row.absenceGroup };
	return { absenceCategory: row.absenceCategory };
}
