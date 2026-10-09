/**
 * Bulk billability change (#901): which of a project's work a bulk change marks
 * billable or non-billable, and how its preview and result are counted. Pure and
 * client-safe; the reader and the writer live in `bulk-billability-work.ts`.
 */
import { comparePlainDates, type PlainDate, parsePlainDate } from "@/lib/datetime/temporal-core";
import { isCanonicalUuid } from "@/lib/validations/canonical-uuid";

/**
 * Why a bulk change leaves work alone although it is not in the target state, in
 * the order they are reported. Each reason has a set-based SQL predicate in
 * `bulk-billability-work.ts` (`BULK_BILLABILITY_SKIP_CONDITIONS`).
 *
 * - `held_back`: a correction or submission for the work is still pending.
 *
 * Invoiced work (#903) joins this list as `invoiced` once hand-offs exist.
 */
export const BULK_BILLABILITY_SKIP_REASONS = ["held_back"] as const;

export type BulkBillabilitySkipReason = (typeof BULK_BILLABILITY_SKIP_REASONS)[number];

export type BulkBillabilityOutcome = "change" | "already_in_target" | BulkBillabilitySkipReason;

/** Completed, non-deleted work on the project within the requested days. */
export interface BulkBillabilityWork {
	id: string;
	employeeId: string;
	durationMinutes: number;
	isBillable: boolean;
	/** The skip reasons that hold for the work, in `BULK_BILLABILITY_SKIP_REASONS` order. */
	skipReasons: readonly BulkBillabilitySkipReason[];
}

export interface BulkBillabilityRequest {
	projectId: string;
	/** Employee-local day of each work period's start, both inclusive. */
	fromDay: PlainDate;
	toDay: PlainDate;
	/** The target billability. */
	billable: boolean;
}

export interface BulkBillabilityTally {
	count: number;
	minutes: number;
}

export interface BulkBillabilitySummary {
	billable: boolean;
	/** Work the change marks (preview) or marked (result). */
	change: BulkBillabilityTally;
	alreadyInTarget: BulkBillabilityTally;
	skipped: Record<BulkBillabilitySkipReason, BulkBillabilityTally>;
}

/**
 * Work already in the target state needs nothing, whatever else holds for it;
 * otherwise the first skip reason that holds leaves it alone.
 */
export function bulkBillabilityOutcome(
	work: Pick<BulkBillabilityWork, "isBillable" | "skipReasons">,
	billable: boolean,
): BulkBillabilityOutcome {
	if (work.isBillable === billable) return "already_in_target";
	return work.skipReasons[0] ?? "change";
}

const emptyTally = (): BulkBillabilityTally => ({ count: 0, minutes: 0 });

export function summarizeBulkBillability(
	billable: boolean,
	items: readonly { durationMinutes: number; outcome: BulkBillabilityOutcome }[],
): BulkBillabilitySummary {
	const skipped = Object.fromEntries(
		BULK_BILLABILITY_SKIP_REASONS.map((reason) => [reason, emptyTally()]),
	) as Record<BulkBillabilitySkipReason, BulkBillabilityTally>;
	const summary: BulkBillabilitySummary = {
		billable,
		change: emptyTally(),
		alreadyInTarget: emptyTally(),
		skipped,
	};
	for (const item of items) {
		const tally =
			item.outcome === "change"
				? summary.change
				: item.outcome === "already_in_target"
					? summary.alreadyInTarget
					: summary.skipped[item.outcome];
		tally.count += 1;
		tally.minutes += item.durationMinutes;
	}
	return summary;
}

export type BulkBillabilityRequestParse =
	| { ok: true; request: BulkBillabilityRequest }
	| { ok: false; field: "projectId" | "fromDay" | "toDay" | "billable"; message: string };

function plainDateOf(value: unknown): PlainDate | null {
	if (typeof value !== "string") return null;
	try {
		return parsePlainDate(value);
	} catch {
		return null;
	}
}

export function parseBulkBillabilityRequest(input: unknown): BulkBillabilityRequestParse {
	const value = (typeof input === "object" && input !== null ? input : {}) as Record<
		string,
		unknown
	>;
	if (!isCanonicalUuid(value.projectId)) {
		return { ok: false, field: "projectId", message: "Choose a project" };
	}
	const fromDay = plainDateOf(value.fromDay);
	if (!fromDay) return { ok: false, field: "fromDay", message: "Enter a valid start date" };
	const toDay = plainDateOf(value.toDay);
	if (!toDay) return { ok: false, field: "toDay", message: "Enter a valid end date" };
	if (comparePlainDates(fromDay, toDay) > 0) {
		return { ok: false, field: "toDay", message: "The end date must not be before the start date" };
	}
	if (typeof value.billable !== "boolean") {
		return { ok: false, field: "billable", message: "Choose billable or non-billable" };
	}
	return {
		ok: true,
		request: { projectId: value.projectId, fromDay, toDay, billable: value.billable },
	};
}
