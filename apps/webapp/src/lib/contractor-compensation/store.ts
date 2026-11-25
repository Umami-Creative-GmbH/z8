import "server-only";

import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { auditLog, employee, employeeEmploymentPeriod } from "@/db/schema";
import { contractorCompensationTerms } from "@/db/schema/contractor-compensation";
import { AuditAction } from "@/lib/audit-logger";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { writeRatePeriodChange } from "@/lib/billable-time/rate-period-writer";
import type { RatePeriod, RatePeriodStore } from "@/lib/billable-time/rate-periods";
import {
	instantFromDate,
	type Instant,
	type PlainDate,
	systemClock,
} from "@/lib/datetime/temporal-core";
import { offsetMinutesToTimeZoneId } from "@/lib/datetime/temporal-format";
import {
	type ContractorProfileDetails,
	loadContractorProfile,
	normalizeContractorProfileDetails,
	saveContractorProfile,
} from "@/lib/engagement/contractor-profile";
import { isFormerEmployee } from "@/lib/employee-lifecycle/current-roster";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
import { loadOrganizationDay } from "@/lib/personnel-file/organization-day";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { type ContractorTermsPeriod, termsInForceOn } from "./pricing";
import {
	type ContractorCompensation,
	type ContractorCompensationInput,
	type ContractorCompensationView,
	fromStoredCompensation,
	parseContractorCompensation,
	sameCompensation,
	toStoredCompensation,
} from "./terms";
import type { ContractorDetailsRefusal, ContractorTermsRefusal } from "./refusal";

/**
 * Contractor compensation terms (#1998): writer and readers. The pricing
 * engine is `pricing.ts`; `pricing-loader.ts` feeds it from the database.
 * Org admins only: callers authorize the actor first. Nothing here reads or
 * writes employee employment terms, payroll or Billable Time cost rates.
 */

type Reader = Pick<Transaction, "select">;

/** One set of terms as the editor and history show it (wire-safe). */
export interface ContractorTermsView {
	id: string;
	employmentPeriodId: string;
	/** Inclusive first day. */
	effectiveFrom: string;
	/** Exclusive; null while open. */
	effectiveTo: string | null;
	compensation: ContractorCompensationView;
}

export type ContractorTermsChange =
	| { kind: "set"; effectiveFrom: string; compensation: ContractorCompensationInput }
	| { kind: "end"; effectiveFrom: string };

export type { ContractorDetailsRefusal, ContractorTermsRefusal } from "./refusal";

export type ContractorTermsOutcome =
	| {
			ok: true;
			changed: boolean;
			history: ContractorTermsView[];
			/** The terms priced today in the organization's calendar, if any. */
			termsInEffectId: string | null;
	  }
	| { ok: false; reason: ContractorTermsRefusal };

/** An active period: open, or a legacy period a reactivation would reopen. */
const activePeriodCondition = or(
	eq(employeeEmploymentPeriod.status, "open"),
	and(
		eq(employeeEmploymentPeriod.status, "legacy_unknown"),
		isNull(employeeEmploymentPeriod.endedAt),
	),
);

function parseDay(value: string): PlainDate | null {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
	try {
		return Temporal.PlainDate.from(value, { overflow: "reject" });
	} catch {
		return null;
	}
}

function viewFromRow(row: typeof contractorCompensationTerms.$inferSelect): ContractorTermsView {
	return {
		id: row.id,
		employmentPeriodId: row.employmentPeriodId,
		effectiveFrom: row.effectiveFrom,
		effectiveTo: row.effectiveTo,
		compensation: toStoredCompensation(fromStoredCompensation(row)),
	};
}

function termsStore(
	tx: Transaction,
	input: {
		organizationId: string;
		employeeId: string;
		employmentPeriodId: string;
		actorUserId: string;
	},
): RatePeriodStore<ContractorCompensation> {
	const series = and(
		eq(contractorCompensationTerms.organizationId, input.organizationId),
		eq(contractorCompensationTerms.employeeId, input.employeeId),
		eq(contractorCompensationTerms.employmentPeriodId, input.employmentPeriodId),
	);
	const inSeries = (id: string) => and(eq(contractorCompensationTerms.id, id), series);
	return {
		async lockAndLoad(): Promise<RatePeriod<ContractorCompensation>[]> {
			const rows = await tx.select().from(contractorCompensationTerms).where(series).for("update");
			return rows.map((row) => ({
				id: row.id,
				from: Temporal.PlainDate.from(row.effectiveFrom),
				to: row.effectiveTo === null ? null : Temporal.PlainDate.from(row.effectiveTo),
				value: fromStoredCompensation(row),
			}));
		},
		async shorten(id, to) {
			await tx
				.update(contractorCompensationTerms)
				.set({ effectiveTo: to.toString(), updatedAt: sql`now()`, updatedBy: input.actorUserId })
				.where(inSeries(id));
		},
		async remove(id) {
			await tx.delete(contractorCompensationTerms).where(inSeries(id));
		},
		async updateValue(id, value) {
			await tx
				.update(contractorCompensationTerms)
				.set({
					...toStoredCompensation(value),
					updatedAt: sql`now()`,
					updatedBy: input.actorUserId,
				})
				.where(inSeries(id));
		},
		async insert(from, to, value) {
			const [row] = await tx
				.insert(contractorCompensationTerms)
				.values({
					organizationId: input.organizationId,
					employeeId: input.employeeId,
					employmentPeriodId: input.employmentPeriodId,
					...toStoredCompensation(value),
					effectiveFrom: from.toString(),
					effectiveTo: to?.toString() ?? null,
					createdBy: input.actorUserId,
					updatedBy: input.actorUserId,
				})
				.returning({ id: contractorCompensationTerms.id });
			return row.id;
		},
	};
}

/** The employee's active employment period and its kind, or null without one. */
async function loadActivePeriod(
	reader: Reader,
	organizationId: string,
	employeeId: string,
): Promise<{ id: string; startedAt: Date | null; engagementKind: EngagementKind } | null> {
	const [row] = await reader
		.select({
			id: employeeEmploymentPeriod.id,
			startedAt: employeeEmploymentPeriod.startedAt,
			engagementKind: employeeEmploymentPeriod.engagementKind,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				eq(employeeEmploymentPeriod.employeeId, employeeId),
				activePeriodCondition,
			),
		)
		.orderBy(desc(employeeEmploymentPeriod.startedAt))
		.limit(1);
	return row ?? null;
}

/**
 * Creates the employee's first employment period if it is still missing:
 * employees created after migration 0071 (a contractor who just joined) get
 * it lazily, as `resolveCurrentEmploymentPeriod` does before reading it.
 */
async function backfillEmploymentPeriod(
	tx: Transaction,
	input: { organizationId: string; employeeId: string },
) {
	await tx.execute(
		sql`SELECT employee_employment_period_backfill_legacy(${input.organizationId}, ${input.employeeId}::uuid)`,
	);
}

async function employeeInOrganization(
	reader: Reader,
	organizationId: string,
	employeeId: string,
): Promise<boolean> {
	const [row] = await reader
		.select({ id: employee.id })
		.from(employee)
		.where(and(eq(employee.id, employeeId), eq(employee.organizationId, organizationId)))
		.limit(1);
	return row !== undefined;
}

/** One audited change of one engagement's terms series (Billable Time's planner and lock). */
function writeTermsChange(
	tx: Transaction,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		employmentPeriodId: string;
	},
	change:
		| { kind: "end"; from: PlainDate }
		| { kind: "set"; from: PlainDate; value: ContractorCompensation },
) {
	return writeRatePeriodChange(tx, {
		seriesKey: [
			"contractor_terms",
			input.organizationId,
			input.employeeId,
			input.employmentPeriodId,
		].join(":"),
		store: termsStore(tx, input),
		change,
		equals: sameCompensation,
		audit: {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			entityType: "contractor_compensation_terms",
			actions: {
				set: AuditAction.CONTRACTOR_TERMS_SET,
				end: AuditAction.CONTRACTOR_TERMS_ENDED,
			},
			employeeId: input.employeeId,
			target: { employeeId: input.employeeId, employmentPeriodId: input.employmentPeriodId },
			describe: toStoredCompensation,
		},
	});
}

export type FirstContractorTermsRefusal =
	| ContractorTermsRefusal
	/** The engagement already has terms; the first terms never replace them. */
	| "terms_exist";

/**
 * Writes the first compensation terms of a contractor's active External
 * Contractor engagement from its start (#1935): an invitation's terms, applied
 * once the contractor joined. They start on the engagement's earliest terms day
 * (`earliestTermsDay`, the bound `changeContractorTerms` refuses before), so
 * every contractor-local day of the engagement is priced; without a recorded
 * start, on the organization's today. Refused when the engagement already has
 * terms. The caller names the admin who prepared them as the actor.
 */
export async function setFirstContractorTerms(
	database: typeof db,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		compensation: ContractorCompensationInput;
		now?: Instant;
	},
): Promise<
	| { ok: true; employmentPeriodId: string; effectiveFrom: string }
	| { ok: false; reason: FirstContractorTermsRefusal }
> {
	const parsed = parseContractorCompensation(input.compensation);
	if (!parsed.ok) return { ok: false, reason: parsed.reason };
	return database.transaction(async (tx) => {
		if (!(await employeeInOrganization(tx, input.organizationId, input.employeeId))) {
			return { ok: false, reason: "employee_not_found" } as const;
		}
		await backfillEmploymentPeriod(tx, input);
		const period = await loadActivePeriod(tx, input.organizationId, input.employeeId);
		if (!period || period.engagementKind !== "contractor") {
			return { ok: false, reason: "not_contractor" } as const;
		}
		const [existing] = await tx
			.select({ id: contractorCompensationTerms.id })
			.from(contractorCompensationTerms)
			.where(
				and(
					eq(contractorCompensationTerms.organizationId, input.organizationId),
					eq(contractorCompensationTerms.employeeId, input.employeeId),
					eq(contractorCompensationTerms.employmentPeriodId, period.id),
				),
			)
			.limit(1);
		if (existing) return { ok: false, reason: "terms_exist" } as const;
		const from =
			earliestTermsDay(period.startedAt) ??
			(
				await loadOrganizationDay(tx, {
					organizationId: input.organizationId,
					now: input.now ?? systemClock.nowInstant(),
				})
			).today;
		await writeTermsChange(
			tx,
			{ ...input, employmentPeriodId: period.id },
			{ kind: "set", from, value: parsed.compensation },
		);
		return { ok: true, employmentPeriodId: period.id, effectiveFrom: from.toString() } as const;
	});
}

/**
 * Sets or ends a contractor's compensation terms from a date, in their active
 * External Contractor engagement. Backdating within the engagement is allowed;
 * later changes are never overwritten (`planRatePeriodChange`). Writes one
 * audit entry per change. The caller authorizes the actor as an org admin.
 */
export async function changeContractorTerms(
	database: typeof db,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		change: ContractorTermsChange;
		now?: Instant;
	},
): Promise<ContractorTermsOutcome> {
	const from = parseDay(input.change.effectiveFrom);
	if (!from) return { ok: false, reason: "invalid_date" };
	let compensation: ContractorCompensation | null = null;
	if (input.change.kind === "set") {
		const parsed = parseContractorCompensation(input.change.compensation);
		if (!parsed.ok) return { ok: false, reason: parsed.reason };
		compensation = parsed.compensation;
	}

	return database.transaction(async (tx): Promise<ContractorTermsOutcome> => {
		if (!(await employeeInOrganization(tx, input.organizationId, input.employeeId))) {
			return { ok: false, reason: "employee_not_found" };
		}
		await backfillEmploymentPeriod(tx, input);
		const period = await loadActivePeriod(tx, input.organizationId, input.employeeId);
		if (!period || period.engagementKind !== "contractor") {
			return { ok: false, reason: "not_contractor" };
		}
		const { today } = await loadOrganizationDay(tx, {
			organizationId: input.organizationId,
			now: input.now ?? systemClock.nowInstant(),
		});
		const earliest = earliestTermsDay(period.startedAt);
		if (earliest && Temporal.PlainDate.compare(from, earliest) < 0) {
			return { ok: false, reason: "before_engagement" };
		}

		const applied = await writeTermsChange(
			tx,
			{ ...input, employmentPeriodId: period.id },
			compensation === null ? { kind: "end", from } : { kind: "set", from, value: compensation },
		);

		// Both reads run on `tx`, one connection: pg queues concurrent queries on a busy client.
		const history = await listContractorTermsHistory(tx, input.organizationId, input.employeeId);
		const inEffect = await termsInEffectOn(tx, input.organizationId, [input.employeeId], today);
		return {
			ok: true,
			changed: applied.changed,
			history,
			termsInEffectId: inEffect.get(input.employeeId)?.id ?? null,
		};
	});
}

/** Every set of terms of one contractor, across their engagements, newest first. */
export async function listContractorTermsHistory(
	reader: Reader,
	organizationId: string,
	employeeId: string,
): Promise<ContractorTermsView[]> {
	const rows = await reader
		.select()
		.from(contractorCompensationTerms)
		.where(
			and(
				eq(contractorCompensationTerms.organizationId, organizationId),
				eq(contractorCompensationTerms.employeeId, employeeId),
			),
		)
		.orderBy(desc(contractorCompensationTerms.effectiveFrom));
	return rows.map(viewFromRow);
}

function localDay(instant: Instant, timezone: string): PlainDate {
	return instant.toZonedDateTimeISO(timezone).toPlainDate();
}

/**
 * UTC−14:00, the westernmost captured offset Z8 accepts elsewhere (±840
 * minutes); no time zone in use lies further west than UTC−12:00.
 */
const WESTERNMOST_OFFSET_TIME_ZONE = offsetMinutesToTimeZoneId(-840);

/**
 * The first day an engagement's terms may start on: the earliest local day
 * its start instant falls on at any captured offset. Pricing assigns work to
 * the contractor's local day at their start entry's offset, so a contractor
 * west of the organization can work inside the engagement on the day before
 * its first day in the organization's calendar. Null when the start is unknown.
 */
function earliestTermsDay(startedAt: Date | null): PlainDate | null {
	return startedAt ? localDay(instantFromDate(startedAt), WESTERNMOST_OFFSET_TIME_ZONE) : null;
}

/**
 * An engagement's days in the organization's calendar, from its first day to
 * the day after its last (exclusive). The period is half-open
 * `[started_at, ended_at)`, so its last day is the day of the last instant
 * before `ended_at`, as `resolveEmploymentPeriodForDay` counts it: a scheduled
 * departure ending at local midnight ends on the day before, an offboarding
 * during a day ends on that day.
 */
function engagementDays(
	period: { startedAt: Date | null; endedAt: Date | null },
	timezone: string,
): { first: PlainDate | null; end: PlainDate | null } {
	return {
		first: period.startedAt ? localDay(instantFromDate(period.startedAt), timezone) : null,
		end: period.endedAt
			? localDay(instantFromDate(period.endedAt).subtract({ nanoseconds: 1 }), timezone).add({
					days: 1,
				})
			: null,
	};
}

type TermsRow = typeof contractorCompensationTerms.$inferSelect;

function termsPeriod(row: TermsRow, from: PlainDate, to: PlainDate | null): ContractorTermsPeriod {
	return {
		id: row.id,
		employeeId: row.employeeId,
		employmentPeriodId: row.employmentPeriodId,
		from,
		to,
		compensation: fromStoredCompensation(row),
	};
}

/**
 * Terms of the given contractors with their engagement's instants,
 * optionally only those in force on some day of `[fromDay, toDay]`.
 */
async function loadTermsWithEngagement(
	reader: Reader,
	organizationId: string,
	scope: { employeeIds: readonly string[]; fromDay?: PlainDate; toDay?: PlainDate },
): Promise<{ row: TermsRow; startedAt: Date | null; endedAt: Date | null }[]> {
	if (scope.employeeIds.length === 0) return [];
	const conditions = [
		eq(contractorCompensationTerms.organizationId, organizationId),
		inArray(contractorCompensationTerms.employeeId, [...scope.employeeIds]),
	];
	if (scope.toDay) {
		conditions.push(
			lt(contractorCompensationTerms.effectiveFrom, scope.toDay.add({ days: 1 }).toString()),
		);
	}
	if (scope.fromDay) {
		const open = or(
			isNull(contractorCompensationTerms.effectiveTo),
			gt(contractorCompensationTerms.effectiveTo, scope.fromDay.toString()),
		);
		if (open) conditions.push(open);
	}
	const rows = await reader
		.select({
			terms: contractorCompensationTerms,
			startedAt: employeeEmploymentPeriod.startedAt,
			endedAt: employeeEmploymentPeriod.endedAt,
		})
		.from(contractorCompensationTerms)
		.innerJoin(
			employeeEmploymentPeriod,
			and(
				eq(employeeEmploymentPeriod.id, contractorCompensationTerms.employmentPeriodId),
				eq(employeeEmploymentPeriod.organizationId, organizationId),
			),
		)
		.where(and(...conditions))
		.orderBy(
			asc(contractorCompensationTerms.employeeId),
			asc(contractorCompensationTerms.effectiveFrom),
		);
	return rows.map(({ terms, startedAt, endedAt }) => ({ row: terms, startedAt, endedAt }));
}

/**
 * The terms of the given contractors for pricing, as stored, optionally only
 * those in force on some day of `[fromDay, toDay]`. Not clipped to any
 * calendar: `priceContractorWork` prices each contractor-local day only by
 * the terms of the engagement it was worked in, and only work inside that
 * engagement's instants, so open terms of an ended engagement never price
 * later work and a new engagement never inherits them. Set-based: pass the
 * result to `priceContractorWork`.
 */
export async function listContractorTermsForPricing(
	reader: Reader,
	organizationId: string,
	scope: { employeeIds: readonly string[]; fromDay?: PlainDate; toDay?: PlainDate },
): Promise<ContractorTermsPeriod[]> {
	return (await loadTermsWithEngagement(reader, organizationId, scope)).map(({ row }) =>
		termsPeriod(
			row,
			Temporal.PlainDate.from(row.effectiveFrom),
			row.effectiveTo === null ? null : Temporal.PlainDate.from(row.effectiveTo),
		),
	);
}

/**
 * The terms each of the given contractors has in effect on `day` of the
 * organization's calendar: each engagement's terms clipped to the
 * engagement's days in that calendar (`engagementDays`), so an ended
 * engagement's open terms are not in effect, nor do they carry over to a
 * later engagement; of two, the later-starting.
 */
async function termsInEffectOn(
	reader: Reader,
	organizationId: string,
	employeeIds: readonly string[],
	day: PlainDate,
): Promise<Map<string, ContractorTermsView>> {
	const [timezone, rows] = await Promise.all([
		loadOrganizationTimezone(reader, organizationId),
		loadTermsWithEngagement(reader, organizationId, { employeeIds, fromDay: day, toDay: day }),
	]);
	const compare = Temporal.PlainDate.compare;
	const clipped = rows.flatMap(({ row, startedAt, endedAt }) => {
		let from = Temporal.PlainDate.from(row.effectiveFrom);
		let to = row.effectiveTo === null ? null : Temporal.PlainDate.from(row.effectiveTo);
		const engagement = engagementDays({ startedAt, endedAt }, timezone);
		if (engagement.first && compare(engagement.first, from) > 0) from = engagement.first;
		if (engagement.end && (to === null || compare(engagement.end, to) < 0)) to = engagement.end;
		if (to !== null && compare(from, to) >= 0) return [];
		return [{ row, terms: termsPeriod(row, from, to) }];
	});
	const periods = clipped.map(({ terms }) => terms);
	const result = new Map<string, ContractorTermsView>();
	for (const employeeId of new Set(employeeIds)) {
		const inForce = termsInForceOn(employeeId, day, periods);
		const entry = inForce && clipped.find(({ terms }) => terms.id === inForce.id);
		if (entry) result.set(employeeId, viewFromRow(entry.row));
	}
	return result;
}

/** Each given employee's active employment period's kind, when they have one. */
async function loadActiveEngagementKinds(
	reader: Reader,
	organizationId: string,
	employeeIds: readonly string[],
): Promise<Map<string, EngagementKind>> {
	if (employeeIds.length === 0) return new Map();
	const rows = await reader
		.select({
			employeeId: employeeEmploymentPeriod.employeeId,
			engagementKind: employeeEmploymentPeriod.engagementKind,
		})
		.from(employeeEmploymentPeriod)
		.where(
			and(
				eq(employeeEmploymentPeriod.organizationId, organizationId),
				inArray(employeeEmploymentPeriod.employeeId, [...employeeIds]),
				activePeriodCondition,
			),
		)
		.orderBy(desc(employeeEmploymentPeriod.startedAt));
	const kinds = new Map<string, EngagementKind>();
	for (const row of rows) {
		if (!kinds.has(row.employeeId)) kinds.set(row.employeeId, row.engagementKind);
	}
	return kinds;
}

/**
 * Saves a contractor's company name, VAT ID and PO/cost-center reference and
 * audits the change. Only for an employee whose engagement today is an External
 * Contractor engagement.
 */
export async function saveContractorDetails(
	database: typeof db,
	input: {
		organizationId: string;
		actorUserId: string;
		employeeId: string;
		details: Partial<Record<keyof ContractorProfileDetails, string | null>>;
	},
): Promise<
	{ ok: true; details: ContractorProfileDetails } | { ok: false; reason: ContractorDetailsRefusal }
> {
	const details = normalizeContractorProfileDetails(input.details);
	return database.transaction(async (tx) => {
		const [row] = await tx
			.select({ engagementKind: employee.engagementKind })
			.from(employee)
			.where(
				and(eq(employee.id, input.employeeId), eq(employee.organizationId, input.organizationId)),
			)
			.for("update");
		if (!row) return { ok: false, reason: "employee_not_found" } as const;
		if (row.engagementKind !== "contractor")
			return { ok: false, reason: "not_contractor" } as const;

		const previous = await loadContractorProfile(tx, input);
		await saveContractorProfile(tx, {
			organizationId: input.organizationId,
			employeeId: input.employeeId,
			details,
			updatedBy: input.actorUserId,
		});
		await tx.insert(auditLog).values({
			organizationId: input.organizationId,
			entityType: "employee_contractor_profile",
			entityId: input.employeeId,
			action: AuditAction.CONTRACTOR_DETAILS_UPDATED,
			performedBy: input.actorUserId,
			employeeId: input.employeeId,
			changes: JSON.stringify({ old: previous, new: details }),
		});
		return { ok: true, details } as const;
	});
}

/** One contractor's compensation for the editor (org admins only). */
export interface ContractorCompensationRecord {
	employeeId: string;
	/** The kind of the employee's active engagement; null without one. */
	activeEngagementKind: EngagementKind | null;
	/**
	 * The employment period of the active External Contractor engagement, the
	 * only one whose terms can be set or ended; null without one.
	 */
	contractorEngagementId: string | null;
	/**
	 * The person ever had an External Contractor engagement here, active or
	 * ended, with or without terms: their work has a Time & Fee Statement.
	 */
	hadContractorEngagement: boolean;
	/**
	 * The first day terms of the active contractor engagement may start on: its
	 * start's earliest local day at any captured offset, so up to a day before
	 * its first day in the organization's calendar; null when unknown.
	 */
	earliestTermsDate: string | null;
	/** Today in the organization's calendar, the editor's default date. */
	today: string;
	/** Newest first, across engagements. */
	history: ContractorTermsView[];
	/**
	 * The terms priced today, as pricing clips them to their engagement; null
	 * when none apply (e.g. an ended engagement's terms left open).
	 */
	termsInEffectId: string | null;
	details: ContractorProfileDetails | null;
}

export async function loadContractorCompensation(
	reader: Reader,
	organizationId: string,
	employeeId: string,
	now: Instant = systemClock.nowInstant(),
): Promise<ContractorCompensationRecord | null> {
	if (!(await employeeInOrganization(reader, organizationId, employeeId))) return null;
	const [{ today }, period, history, details, [anyContractorPeriod]] = await Promise.all([
		loadOrganizationDay(reader, { organizationId, now }),
		loadActivePeriod(reader, organizationId, employeeId),
		listContractorTermsHistory(reader, organizationId, employeeId),
		loadContractorProfile(reader, { organizationId, employeeId }),
		reader
			.select({ id: employeeEmploymentPeriod.id })
			.from(employeeEmploymentPeriod)
			.where(
				and(
					eq(employeeEmploymentPeriod.organizationId, organizationId),
					eq(employeeEmploymentPeriod.employeeId, employeeId),
					eq(employeeEmploymentPeriod.engagementKind, "contractor"),
				),
			)
			.limit(1),
	]);
	const inEffect = await termsInEffectOn(reader, organizationId, [employeeId], today);
	return {
		employeeId,
		activeEngagementKind: period?.engagementKind ?? null,
		contractorEngagementId: period?.engagementKind === "contractor" ? period.id : null,
		hadContractorEngagement: anyContractorPeriod !== undefined || history.length > 0,
		earliestTermsDate:
			period?.engagementKind === "contractor"
				? (earliestTermsDay(period.startedAt)?.toString() ?? null)
				: null,
		today: today.toString(),
		history,
		termsInEffectId: inEffect.get(employeeId)?.id ?? null,
		details,
	};
}

/** A contractor and the terms in force today, for Settings → Contracts. */
export interface ContractorCompensationOverviewRow {
	employeeId: string;
	name: string;
	/** On the current roster today; false for a former person (deactivated or departed). */
	isActive: boolean;
	/**
	 * The kind of the person's active engagement; null without one. Anyone
	 * else is a former contractor listed for their terms history.
	 */
	engagementKind: EngagementKind | null;
	/** The terms priced today, clipped to their engagement as pricing does. */
	termsToday: ContractorTermsView | null;
	details: ContractorProfileDetails | null;
}

/**
 * Every External Contractor of the organization (by today's engagement kind)
 * and anyone else with contractor terms on record, with the terms priced
 * today in the organization's calendar.
 */
export async function listContractorCompensationOverview(
	reader: Reader,
	organizationId: string,
	now: Instant = systemClock.nowInstant(),
): Promise<ContractorCompensationOverviewRow[]> {
	const { today } = await loadOrganizationDay(reader, { organizationId, now });
	const withTerms = reader
		.select({ employeeId: contractorCompensationTerms.employeeId })
		.from(contractorCompensationTerms)
		.where(eq(contractorCompensationTerms.organizationId, organizationId));
	const people = await reader
		.select({
			id: employee.id,
			// The current-roster rule (#1438): a due departure is former too.
			isFormer: isFormerEmployee(employee, now),
			firstName: user.firstName,
			lastName: user.lastName,
			name: user.name,
			email: user.email,
		})
		.from(employee)
		.leftJoin(user, eq(user.id, employee.userId))
		.where(
			and(
				eq(employee.organizationId, organizationId),
				or(eq(employee.engagementKind, "contractor"), inArray(employee.id, withTerms)),
			),
		);
	const employeeIds = people.map((person) => person.id);
	const [kinds, todayByEmployee, profiles] = await Promise.all([
		loadActiveEngagementKinds(reader, organizationId, employeeIds),
		termsInEffectOn(reader, organizationId, employeeIds, today),
		Promise.all(
			people.map((person) =>
				loadContractorProfile(reader, { organizationId, employeeId: person.id }),
			),
		),
	]);
	return people
		.map((person, index) => ({
			employeeId: person.id,
			name: buildAuthUserDisplayName(person) || person.id,
			isActive: !person.isFormer,
			engagementKind: kinds.get(person.id) ?? null,
			termsToday: todayByEmployee.get(person.id) ?? null,
			details: profiles[index] ?? null,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}
