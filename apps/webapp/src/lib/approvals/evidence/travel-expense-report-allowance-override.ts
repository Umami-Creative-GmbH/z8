import {
	type AllowanceOverride,
	type AllowanceOverrideKind,
	type AllowanceOverrideScope,
	type AllowanceSituation,
	allowanceOverrideView,
	mileageOverrideScope,
	perDiemOverrideScope,
} from "@/lib/travel-expenses/allowance-override";
import type { MileageVehicle } from "@/lib/travel-expenses/mileage";
import { itineraryOf } from "@/lib/travel-expenses/per-diem-pricing";
import type { TripDestination } from "@/lib/travel-expenses/trip-destination";
import { ApprovalEvidenceError } from "./errors";
import type { TravelExpenseReportPerDiemRow } from "./travel-expense-report-per-diem";

/**
 * Frozen allowance overrides (#610, schema version 8). A mileage or per diem
 * item whose allowance an expense administrator set manually freezes the
 * override beside its facts: amount, reason, evidence, calculation basis, the
 * exact facts it was authorized for, the situation it resolved and the
 * authorizer by value. The item's `original` is the override amount; its
 * `mileage`/`perDiem` facts are frozen too when the stamped policy can price
 * them, so reviewers see the ordinary result next to the override.
 */

export const ALLOWANCE_OVERRIDE_FACTS_SCHEMA_VERSION = 8;

/** An active override row of one report item, already mapped from the database. */
export interface TravelExpenseReportAllowanceOverrideRow {
	organizationId: string;
	reportId: string;
	itemId: string;
	override: AllowanceOverride;
}

export interface TravelExpenseReportSubmittedAllowanceOverride {
	overrideId: string;
	kind: AllowanceOverrideKind;
	/** The amount the item counts with, in the reimbursement currency. */
	amount: string;
	currency: string;
	reason: string;
	evidence: string;
	calculationBasis: string;
	/** The ordinary calculation's situation when the override was authorized. */
	situation: AllowanceSituation;
	/** The entered facts the override was authorized for (the item's frozen facts). */
	scope: AllowanceOverrideScope;
	authorizedBy: { employeeId: string; name: string };
	/** Canonical UTC instant. */
	authorizedAt: string;
}

/** Every override must belong to an allowance item of this report, at most one per item. */
export function assertAllowanceOverrideScope(
	rows: readonly TravelExpenseReportAllowanceOverrideRow[],
	report: { id: string; organizationId: string },
	items: ReadonlyArray<{ id: string; type: string }>,
): void {
	const seen = new Set<string>();
	for (const row of rows) {
		const item = items.find((candidate) => candidate.id === row.itemId);
		if (
			row.organizationId !== report.organizationId ||
			row.reportId !== report.id ||
			item?.type !== row.override.kind ||
			seen.has(row.itemId)
		) {
			throw new ApprovalEvidenceError("invariant", { field: "allowance_override_scope" });
		}
		seen.add(row.itemId);
	}
}

/**
 * The override applying to a mileage item's live facts, or null when there
 * is none, it was authorized for other facts, or the facts are built below
 * version 8 (an older revision never had one).
 */
export function applyingMileageOverride(
	rows: readonly TravelExpenseReportAllowanceOverrideRow[] | undefined,
	row: {
		id: string;
		expenseDate: string | null;
		mileageRoute?: string | null;
		mileageDistanceKm?: string | null;
		mileageVehicle?: MileageVehicle | null;
	},
	reimbursementCurrency: string,
	schemaVersion: number,
): AllowanceOverride | null {
	if (schemaVersion < ALLOWANCE_OVERRIDE_FACTS_SCHEMA_VERSION) return null;
	const override = rows?.find((candidate) => candidate.itemId === row.id)?.override;
	if (!override) return null;
	const scope = mileageOverrideScope({
		expenseDate: row.expenseDate,
		route: row.mileageRoute ?? null,
		distanceKm: row.mileageDistanceKm ?? null,
		vehicle: row.mileageVehicle ?? null,
	});
	return allowanceOverrideView(override, scope, reimbursementCurrency).applies ? override : null;
}

/** The override applying to a per diem's live itinerary and the trip's destinations. */
export function applyingPerDiemOverride(
	rows: readonly TravelExpenseReportAllowanceOverrideRow[] | undefined,
	perDiemRow: TravelExpenseReportPerDiemRow | undefined,
	report: { reimbursementCurrency: string; tripDestinations: TripDestination[] },
	schemaVersion: number,
): AllowanceOverride | null {
	if (schemaVersion < ALLOWANCE_OVERRIDE_FACTS_SCHEMA_VERSION || !perDiemRow) return null;
	const override = rows?.find((candidate) => candidate.itemId === perDiemRow.itemId)?.override;
	if (!override) return null;
	const scope = perDiemOverrideScope(itineraryOf(perDiemRow), report.tripDestinations);
	return allowanceOverrideView(override, scope, report.reimbursementCurrency).applies
		? override
		: null;
}

export function submittedAllowanceOverride(
	override: AllowanceOverride,
): TravelExpenseReportSubmittedAllowanceOverride {
	return {
		overrideId: override.id,
		kind: override.kind,
		amount: override.amount,
		currency: override.currency,
		reason: override.reason,
		evidence: override.evidence,
		calculationBasis: override.calculationBasis,
		situation: { kind: override.situation.kind, reasons: [...override.situation.reasons] },
		scope: structuredClone(override.scope),
		authorizedBy: { ...override.authorizedBy },
		authorizedAt: override.authorizedAt,
	};
}
