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
import {
	type ContractorProfileDetails,
	loadContractorProfile,
	normalizeContractorProfileDetails,
	saveContractorProfile,
} from "@/lib/engagement/contractor-profile";
import type { EngagementKind } from "@/lib/engagement/engagement-kind";
import { loadOrganizationDay } from "@/lib/personnel-file/organization-day";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import type { ContractorTermsPeriod } from "./pricing";
import {
	type ContractorCompensation,
	type ContractorCompensationInput,
	type ContractorCompensationRefusal,
	type ContractorCompensationView,
	fromStoredCompensation,
	parseContractorCompensation,
	sameCompensation,
	toStoredCompensation,
} from "./terms";

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

export type ContractorTermsRefusal =
	| ContractorCompensationRefusal
	| "invalid_date"
	| "employee_not_found"
	/** The employee's active engagement is not an External Contractor engagement (or there is none). */
	| "not_contractor"
	/** Terms cannot start before the contractor's engagement started. */
	| "before_engagement";

export type ContractorTermsOutcome =
	| { ok: true; changed: boolean; history: ContractorTermsView[] }
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
		const period = await loadActivePeriod(tx, input.organizationId, input.employeeId);
		if (!period || period.engagementKind !== "contractor") {
			return { ok: false, reason: "not_contractor" };
		}
		if (period.startedAt) {
			const timezone = await loadOrganizationTimezone(tx, input.organizationId);
			const firstDay = instantFromDate(period.startedAt).toZonedDateTimeISO(timezone).toPlainDate();
			if (Temporal.PlainDate.compare(from, firstDay) < 0) {
				return { ok: false, reason: "before_engagement" };
			}
		}

		const applied = await writeRatePeriodChange(tx, {
			seriesKey: ["contractor_terms", input.organizationId, input.employeeId, period.id].join(":"),
			store: termsStore(tx, { ...input, employmentPeriodId: period.id }),
			change:
				compensation === null ? { kind: "end", from } : { kind: "set", from, value: compensation },
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
				target: { employeeId: input.employeeId, employmentPeriodId: period.id },
				describe: toStoredCompensation,
			},
		});

		const history = await listContractorTermsHistory(tx, input.organizationId, input.employeeId);
		return { ok: true, changed: applied.changed, history };
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
 * The terms of the given contractors for pricing, optionally only those in
 * force on some day of `[fromDay, toDay]`. Each set is clipped to its
 * engagement's days in the organization's calendar (first day through the day
 * it ended), so terms left open on an ended engagement never price later work.
 * Set-based: pass the result to `priceContractorWork`.
 */
export async function listContractorTermsForPricing(
	reader: Reader,
	organizationId: string,
	scope: { employeeIds: readonly string[]; fromDay?: PlainDate; toDay?: PlainDate },
): Promise<ContractorTermsPeriod[]> {
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
	const [timezone, rows] = await Promise.all([
		loadOrganizationTimezone(reader, organizationId),
		reader
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
			),
	]);

	const compare = Temporal.PlainDate.compare;
	return rows.flatMap(({ terms, startedAt, endedAt }) => {
		let from = Temporal.PlainDate.from(terms.effectiveFrom);
		let to = terms.effectiveTo === null ? null : Temporal.PlainDate.from(terms.effectiveTo);
		if (startedAt) {
			const first = localDay(instantFromDate(startedAt), timezone);
			if (compare(first, from) > 0) from = first;
		}
		if (endedAt) {
			const afterLast = localDay(instantFromDate(endedAt), timezone).add({ days: 1 });
			if (to === null || compare(afterLast, to) < 0) to = afterLast;
		}
		if (to !== null && compare(from, to) >= 0) return [];
		return [
			{
				id: terms.id,
				employeeId: terms.employeeId,
				employmentPeriodId: terms.employmentPeriodId,
				from,
				to,
				compensation: fromStoredCompensation(terms),
			},
		];
	});
}

export type ContractorDetailsRefusal = "employee_not_found" | "not_contractor";

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
	/** The first day terms may start on, in the organization's calendar; null when unknown. */
	engagementStartDate: string | null;
	/** Today in the organization's calendar, for "in effect" marks. */
	today: string;
	/** Newest first, across engagements. */
	history: ContractorTermsView[];
	details: ContractorProfileDetails | null;
}

export async function loadContractorCompensation(
	reader: Reader,
	organizationId: string,
	employeeId: string,
	now: Instant = systemClock.nowInstant(),
): Promise<ContractorCompensationRecord | null> {
	if (!(await employeeInOrganization(reader, organizationId, employeeId))) return null;
	const [{ timezone, today }, period, history, details] = await Promise.all([
		loadOrganizationDay(reader, { organizationId, now }),
		loadActivePeriod(reader, organizationId, employeeId),
		listContractorTermsHistory(reader, organizationId, employeeId),
		loadContractorProfile(reader, { organizationId, employeeId }),
	]);
	return {
		employeeId,
		activeEngagementKind: period?.engagementKind ?? null,
		engagementStartDate:
			period?.startedAt && period.engagementKind === "contractor"
				? localDay(instantFromDate(period.startedAt), timezone).toString()
				: null,
		today: today.toString(),
		history,
		details,
	};
}

/** A contractor and the terms in force today, for Settings → Contracts. */
export interface ContractorCompensationOverviewRow {
	employeeId: string;
	name: string;
	isActive: boolean;
	termsToday: ContractorTermsView | null;
	details: ContractorProfileDetails | null;
}

/**
 * Every External Contractor of the organization (by today's engagement kind)
 * and anyone else with contractor terms on record, with the terms in force
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
	const [people, terms] = await Promise.all([
		reader
			.select({
				id: employee.id,
				isActive: employee.isActive,
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
			),
		reader
			.select()
			.from(contractorCompensationTerms)
			.where(
				and(
					eq(contractorCompensationTerms.organizationId, organizationId),
					sql`${contractorCompensationTerms.effectiveFrom} <= ${today.toString()}::date`,
					or(
						isNull(contractorCompensationTerms.effectiveTo),
						sql`${contractorCompensationTerms.effectiveTo} > ${today.toString()}::date`,
					),
				),
			)
			.orderBy(desc(contractorCompensationTerms.effectiveFrom)),
	]);
	const profiles = await Promise.all(
		people.map((person) =>
			loadContractorProfile(reader, { organizationId, employeeId: person.id }),
		),
	);
	const todayByEmployee = new Map<string, ContractorTermsView>();
	for (const row of terms) {
		if (!todayByEmployee.has(row.employeeId)) todayByEmployee.set(row.employeeId, viewFromRow(row));
	}
	return people
		.map((person, index) => ({
			employeeId: person.id,
			name: buildAuthUserDisplayName(person) || person.id,
			isActive: person.isActive,
			termsToday: todayByEmployee.get(person.id) ?? null,
			details: profiles[index] ?? null,
		}))
		.sort((left, right) => left.name.localeCompare(right.name));
}
