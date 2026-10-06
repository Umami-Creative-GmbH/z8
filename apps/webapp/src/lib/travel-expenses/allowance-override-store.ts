import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { db as appDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
	employee,
	travelExpenseAllowanceOverride,
	travelExpenseReport,
	travelExpenseReportItem,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type AllowanceOverride,
	type AllowanceOverrideDraft,
	type AllowanceOverrideError,
	type AllowanceOverrideKind,
	type AllowanceOverrideScope,
	type AllowanceSituation,
	allowanceOverrideView,
	isOverridableSituation,
	mileageOverrideScope,
	mileageSituation,
	parseAllowanceOverrideDraft,
	perDiemOverrideScope,
	perDiemSituation,
} from "./allowance-override";
import { allowanceOverrideFromRow, loadActiveAllowanceOverrides } from "./allowance-override-read";
import type { MileageCalculation, MileageVehicle } from "./mileage";
import { loadMileagePricer } from "./mileage-pricing";
import { type PerDiemCalculation, type PerDiemItinerary, tripDays } from "./per-diem";
import { loadPerDiemViews } from "./per-diem-pricing";
import { EDITABLE_REPORT_STATUSES, isEditableReportStatus } from "./report-return";

/**
 * Records and revokes audited allowance overrides (#610). The caller has
 * checked that the actor is an expense administrator of the active
 * organization; this store enforces organization scope, refuses an
 * administrator's own report, admits only editable reports (draft or
 * returned, before the next revision is frozen) and only items whose ordinary
 * calculation needs one. Every write holds the report row lock (the lock item
 * saves and submission take) and advances the item's version, so the
 * employee's submission review always covers the override it shows.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;
type ReportRow = typeof travelExpenseReport.$inferSelect;
type ItemRow = typeof travelExpenseReportItem.$inferSelect;

/** An expense administrator acting in their active organization. */
export interface AllowanceOverrideActor {
	organizationId: string;
	employeeId: string;
	userId: string;
}

/** The ordinary calculation of an allowance item now, and the facts it reads. */
interface OrdinaryAllowance {
	kind: AllowanceOverrideKind;
	situation: AllowanceSituation;
	scope: AllowanceOverrideScope;
	calculation: MileageCalculation | PerDiemCalculation;
}

async function ordinaryAllowance(
	tx: Reader,
	report: ReportRow,
	item: ItemRow,
): Promise<OrdinaryAllowance | null> {
	if (item.type === "mileage") {
		const price = await loadMileagePricer(tx, report.organizationId, [item]);
		const calculation = price(item, {
			reimbursementCurrency: report.reimbursementCurrency,
			useStamp: false,
		});
		return {
			kind: "mileage",
			situation: mileageSituation(calculation),
			scope: mileageOverrideScope({
				expenseDate: item.expenseDate,
				route: item.mileageRoute,
				distanceKm: item.mileageDistanceKm,
				vehicle: item.mileageVehicle,
			}),
			calculation,
		};
	}
	if (item.type === "per_diem") {
		const views = await loadPerDiemViews(tx, report, [item], { useStamp: false });
		const view = views.get(item.id);
		if (!view) return null;
		const calculation = view.calculation ?? { status: "incomplete" };
		const { startDate, endDate, meals } = view.itinerary;
		// The daily meals are travel facts a manual calculation needs too; they are never assumed.
		const days = startDate && endDate ? tripDays(startDate, endDate) : [];
		const mealsComplete =
			meals.length === days.length && meals.every((day, index) => day.date === days[index]);
		return {
			kind: "per_diem",
			situation: mealsComplete
				? perDiemSituation(calculation)
				: { kind: "missing_facts", reasons: ["per_diem_meals"] },
			scope: perDiemOverrideScope(view.itinerary, report.tripDestinations),
			calculation,
		};
	}
	return null;
}

type LockedItem =
	| { kind: "ok"; report: ReportRow; item: ItemRow }
	| { kind: "not_found" }
	| { kind: "not_draft" }
	| { kind: "conflict"; itemVersion: number };

/** Locks an editable report of the organization and reads one item at the expected version. */
async function lockItem(
	tx: Transaction,
	organizationId: string,
	input: { reportId: string; itemId: string; expectedVersion: number },
): Promise<LockedItem> {
	const [report] = await tx
		.select()
		.from(travelExpenseReport)
		.where(
			and(
				eq(travelExpenseReport.id, input.reportId),
				eq(travelExpenseReport.organizationId, organizationId),
			),
		)
		.for("update");
	if (!report) return { kind: "not_found" };
	// A returned report (#603) is corrected like a draft; a frozen revision never changes.
	if (!isEditableReportStatus(report.status)) return { kind: "not_draft" };
	const [item] = await tx
		.select()
		.from(travelExpenseReportItem)
		.where(
			and(
				eq(travelExpenseReportItem.id, input.itemId),
				eq(travelExpenseReportItem.reportId, report.id),
				eq(travelExpenseReportItem.organizationId, organizationId),
			),
		)
		.limit(1);
	if (!item) return { kind: "not_found" };
	if (item.version !== input.expectedVersion) return { kind: "conflict", itemVersion: item.version };
	return { kind: "ok", report, item };
}

/** The administrator's name, kept by value with what they authorize. */
async function actorName(tx: Transaction, actor: AllowanceOverrideActor): Promise<string | null> {
	const [row] = await tx
		.select({ name: user.name })
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.id, actor.employeeId),
				eq(employee.organizationId, actor.organizationId),
				eq(employee.userId, actor.userId),
			),
		)
		.limit(1);
	return row?.name ?? null;
}

async function bumpItem(
	tx: Transaction,
	actor: AllowanceOverrideActor,
	item: ItemRow,
	at: Date,
): Promise<number> {
	const [bumped] = await tx
		.update(travelExpenseReportItem)
		.set({
			version: sql`${travelExpenseReportItem.version} + 1`,
			updatedAt: at,
			updatedBy: actor.userId,
		})
		.where(
			and(
				eq(travelExpenseReportItem.id, item.id),
				eq(travelExpenseReportItem.organizationId, actor.organizationId),
				eq(travelExpenseReportItem.version, item.version),
			),
		)
		.returning({ version: travelExpenseReportItem.version });
	// The report lock serializes every item write, so the version cannot move.
	if (!bumped) throw new Error("Report item changed under the report lock");
	await tx
		.update(travelExpenseReport)
		.set({ updatedAt: at, updatedBy: actor.userId })
		.where(
			and(
				eq(travelExpenseReport.id, item.reportId),
				eq(travelExpenseReport.organizationId, actor.organizationId),
			),
		);
	return bumped.version;
}

async function revokeActive(
	tx: Transaction,
	actor: AllowanceOverrideActor & { name: string },
	input: { itemId: string; overrideId: string },
	at: Date,
): Promise<boolean> {
	const revoked = await tx
		.update(travelExpenseAllowanceOverride)
		.set({
			revokedAt: at,
			revokedByEmployeeId: actor.employeeId,
			revokedByUserId: actor.userId,
			revokedByName: actor.name,
		})
		.where(
			and(
				eq(travelExpenseAllowanceOverride.id, input.overrideId),
				eq(travelExpenseAllowanceOverride.itemId, input.itemId),
				eq(travelExpenseAllowanceOverride.organizationId, actor.organizationId),
				isNull(travelExpenseAllowanceOverride.revokedAt),
			),
		)
		.returning({ id: travelExpenseAllowanceOverride.id });
	return revoked.length > 0;
}

export type AuthorizeAllowanceOverrideResult =
	| { kind: "authorized"; itemVersion: number; override: AllowanceOverride }
	| { kind: "invalid"; errors: AllowanceOverrideError[] }
	/** An administrator never overrides an allowance on their own report. */
	| { kind: "self_authorization" }
	/** Only mileage and per diem items have an allowance calculation. */
	| { kind: "not_allowance" }
	/** Required travel facts are missing: the employee must enter them first. */
	| { kind: "missing_facts" }
	/** The ordinary calculation covers the item; nothing to override. */
	| { kind: "not_exceptional" }
	/** Another override is active; replace it explicitly with its ID. */
	| { kind: "already_overridden"; overrideId: string }
	/** `replacesOverrideId` is not the item's active override. */
	| { kind: "stale_replacement" }
	| { kind: "conflict"; itemVersion: number }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/**
 * Records a manual allowance for exactly the item's current facts. A second
 * override replaces the active one only when the caller names it, so two
 * administrators never silently overwrite each other.
 */
export async function authorizeAllowanceOverride(
	database: Database,
	actor: AllowanceOverrideActor,
	input: {
		reportId: string;
		itemId: string;
		expectedVersion: number;
		draft: AllowanceOverrideDraft;
		replacesOverrideId?: string | null;
	},
	now: Instant = systemClock.nowInstant(),
): Promise<AuthorizeAllowanceOverrideResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const locked = await lockItem(tx, actor.organizationId, input);
		if (locked.kind !== "ok") return locked;
		const { report, item } = locked;
		if (report.employeeId === actor.employeeId) return { kind: "self_authorization" };
		const ordinary = await ordinaryAllowance(tx, report, item);
		if (!ordinary) return { kind: "not_allowance" };
		if (ordinary.situation.kind === "missing_facts") return { kind: "missing_facts" };
		if (!isOverridableSituation(ordinary.situation)) return { kind: "not_exceptional" };
		const parsed = parseAllowanceOverrideDraft(input.draft, {
			kind: ordinary.kind,
			currency: report.reimbursementCurrency,
		});
		if (!parsed.ok) return { kind: "invalid", errors: parsed.errors };
		const name = await actorName(tx, actor);
		if (!name) return { kind: "not_found" };

		const active = (
			await loadActiveAllowanceOverrides(tx, {
				organizationId: actor.organizationId,
				itemIds: [item.id],
			})
		).get(item.id);
		const replaces = input.replacesOverrideId ?? null;
		if (active && replaces !== active.id) {
			return replaces ? { kind: "stale_replacement" } : { kind: "already_overridden", overrideId: active.id };
		}
		if (!active && replaces) return { kind: "stale_replacement" };
		if (active) {
			await revokeActive(tx, { ...actor, name }, { itemId: item.id, overrideId: active.id }, at);
		}
		const [row] = await tx
			.insert(travelExpenseAllowanceOverride)
			.values({
				organizationId: actor.organizationId,
				reportId: report.id,
				itemId: item.id,
				kind: ordinary.kind,
				amount: parsed.draft.amount,
				currency: report.reimbursementCurrency,
				reason: parsed.draft.reason,
				evidence: parsed.draft.evidence,
				calculationBasis: parsed.draft.calculationBasis,
				scope: ordinary.scope,
				situation: ordinary.situation,
				authorizedByEmployeeId: actor.employeeId,
				authorizedByUserId: actor.userId,
				authorizedByName: name,
				authorizedAt: at,
			})
			.returning();
		if (!row) throw new Error("Failed to record the allowance override");
		const itemVersion = await bumpItem(tx, actor, item, at);
		return { kind: "authorized", itemVersion, override: allowanceOverrideFromRow(row) };
	});
}

export type RevokeAllowanceOverrideResult =
	| { kind: "revoked"; itemVersion: number }
	| { kind: "self_authorization" }
	| { kind: "conflict"; itemVersion: number }
	| { kind: "not_found" }
	| { kind: "not_draft" };

/** Revokes the item's active override; the row stays as audit history. */
export async function revokeAllowanceOverride(
	database: Database,
	actor: AllowanceOverrideActor,
	input: { reportId: string; itemId: string; expectedVersion: number; overrideId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<RevokeAllowanceOverrideResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const locked = await lockItem(tx, actor.organizationId, input);
		if (locked.kind !== "ok") return locked;
		if (locked.report.employeeId === actor.employeeId) return { kind: "self_authorization" };
		const name = await actorName(tx, actor);
		if (!name) return { kind: "not_found" };
		const revoked = await revokeActive(tx, { ...actor, name }, input, at);
		if (!revoked) return { kind: "not_found" };
		return { kind: "revoked", itemVersion: await bumpItem(tx, actor, locked.item, at) };
	});
}

/** An allowance item of an editable report that needs (or has) an override. */
export interface AllowanceExceptionItem {
	reportId: string;
	itemId: string;
	itemVersion: number;
	kind: AllowanceOverrideKind;
	employeeId: string;
	employeeName: string;
	reimbursementCurrency: string;
	expenseDate: string | null;
	/** Mileage facts. */
	route: string | null;
	distanceKm: string | null;
	vehicle: MileageVehicle | null;
	/** Per diem facts. */
	itinerary: PerDiemItinerary | null;
	destinations: { place: string; countryCode: string }[];
	/** The ordinary calculation now: why it needs an override (or `calculated`). */
	situation: AllowanceSituation;
	/** The ordinary amount, when the policy can price it. */
	ordinaryAmount: string | null;
	/** The active override, with whether it still applies to the facts. */
	override: (AllowanceOverride & { applies: boolean }) | null;
	/** Administrators never override their own allowances. */
	ownReport: boolean;
}

/**
 * Mileage and per diem items of the organization's editable reports whose
 * ordinary calculation needs an override, or that have one. Most recently
 * edited first. Missing facts are the employee's to fix and are not listed.
 */
export async function listAllowanceExceptionItems(
	database: Reader,
	actor: Pick<AllowanceOverrideActor, "organizationId" | "employeeId">,
	limit = 200,
): Promise<AllowanceExceptionItem[]> {
	const rows = await database
		.select({ report: travelExpenseReport, item: travelExpenseReportItem, employeeName: user.name })
		.from(travelExpenseReportItem)
		.innerJoin(
			travelExpenseReport,
			and(
				eq(travelExpenseReport.id, travelExpenseReportItem.reportId),
				eq(travelExpenseReport.organizationId, travelExpenseReportItem.organizationId),
			),
		)
		.innerJoin(
			employee,
			and(
				eq(employee.id, travelExpenseReport.employeeId),
				eq(employee.organizationId, travelExpenseReport.organizationId),
			),
		)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(travelExpenseReport.organizationId, actor.organizationId),
				inArray(travelExpenseReport.status, [...EDITABLE_REPORT_STATUSES]),
				inArray(travelExpenseReportItem.type, ["mileage", "per_diem"]),
			),
		)
		.orderBy(desc(travelExpenseReportItem.updatedAt), desc(travelExpenseReportItem.id))
		.limit(limit);
	const overrides = await loadActiveAllowanceOverrides(database, {
		organizationId: actor.organizationId,
		itemIds: rows.map((row) => row.item.id),
	});
	const result: AllowanceExceptionItem[] = [];
	for (const { report, item, employeeName } of rows) {
		const ordinary = await ordinaryAllowance(database, report, item);
		if (!ordinary) continue;
		const override = overrides.get(item.id) ?? null;
		if (!override && !isOverridableSituation(ordinary.situation)) continue;
		const scope = ordinary.scope;
		const calculated = ordinary.calculation.status === "calculated" ? ordinary.calculation : null;
		result.push({
			reportId: report.id,
			itemId: item.id,
			itemVersion: item.version,
			kind: ordinary.kind,
			employeeId: report.employeeId,
			employeeName,
			reimbursementCurrency: report.reimbursementCurrency,
			expenseDate: item.expenseDate,
			route: scope.kind === "mileage" ? scope.route : null,
			distanceKm: scope.kind === "mileage" ? scope.distanceKm : null,
			vehicle: scope.kind === "mileage" ? scope.vehicle : null,
			itinerary: scope.kind === "per_diem" ? scope.itinerary : null,
			destinations: report.tripDestinations.map((destination) => ({
				place: destination.place,
				countryCode: destination.countryCode,
			})),
			situation: ordinary.situation,
			ordinaryAmount: calculated?.amount ?? null,
			override: override
				? allowanceOverrideView(override, scope, report.reimbursementCurrency)
				: null,
			ownReport: report.employeeId === actor.employeeId,
		});
	}
	return result;
}
