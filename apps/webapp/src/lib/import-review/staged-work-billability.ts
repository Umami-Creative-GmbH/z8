/**
 * Billability a provider adapter stages on a work row (#907), next to the row's
 * `attribution` (the Z8 project and billability the committer records, #900).
 *
 * `normalizedPayload.billability` only explains the outcome on the review screen:
 * the provider's own value and why work the provider calls billable is imported
 * as non-billable. Rows staged before #907 have neither key; they commit without
 * a project, so they are non-billable.
 */

export type StagedWorkBillabilityNote =
	/** The provider entry names no project. */
	| "no_project"
	/** The provider project is not mapped to a Z8 project. */
	| "unmapped_project"
	/** The mapped Z8 project has no customer, so its work is never billable. */
	| "no_customer"
	/** The provider already billed it; it is imported as billable, not as invoiced work. */
	| "already_billed";

export interface StagedWorkBillability {
	/** The provider's raw value, when it is a number. */
	providerValue: number | null;
	/** Whether the row commits as billable work. */
	billable: boolean;
	note: StagedWorkBillabilityNote | null;
}

const NOTES: ReadonlySet<string> = new Set<StagedWorkBillabilityNote>([
	"no_project",
	"unmapped_project",
	"no_customer",
	"already_billed",
]);

/**
 * The staged row's billability, or null for rows staged without it (before
 * #907, by other providers, or for other entities).
 */
export function readStagedWorkBillability(
	normalizedPayload: unknown,
): StagedWorkBillability | null {
	if (!isRecord(normalizedPayload)) return null;
	const value = normalizedPayload.billability;
	if (!isRecord(value) || typeof value.billable !== "boolean") return null;
	return {
		providerValue: typeof value.providerValue === "number" ? value.providerValue : null,
		billable: value.billable,
		note:
			typeof value.note === "string" && NOTES.has(value.note)
				? (value.note as StagedWorkBillabilityNote)
				: null,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** What the review screen shows for a staged row's billability. */
export interface ImportRowBillability {
	providerValue: number | null;
	billable: boolean;
	note: StagedWorkBillabilityNote | "no_billable_value" | null;
}

/**
 * The review screen's billability of a staged work row; null for other
 * entities. Work rows staged without billability (before #907, or by providers
 * that carry none) commit without a project, so they show as non-billable.
 */
export function importRowBillability(row: {
	entityType: string;
	normalizedPayload: unknown;
}): ImportRowBillability | null {
	if (row.entityType !== "work_period") return null;
	return (
		readStagedWorkBillability(row.normalizedPayload) ?? {
			providerValue: null,
			billable: false,
			note: "no_billable_value",
		}
	);
}
