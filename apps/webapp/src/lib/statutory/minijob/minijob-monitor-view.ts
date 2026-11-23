/**
 * The Minijob monitor of one employee for Employee Detail (#1989). Org admins (`full`) get the EUR
 * breakdown, exceedance status and the external Minijob offsets; everyone else (`restricted`:
 * scoped managers) gets the tier of each month only — a percentage of the public cap would reveal
 * earnings and, with visible hours, the wage.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { employeeStatutoryOffset } from "@/db/schema";
import { type Instant, plainDateAt } from "@/lib/datetime/temporal-core";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { loadEmployeeInOrganization } from "../employee-scope";
import type { StatutoryUsageTier } from "../finding";
import { loadOrganizationStatutoryPreferences } from "../preferences";
import type { StatutoryAudience } from "../redaction";
import { evaluateMinijobEarnings } from "./evaluate-minijob";
import {
	addMonths,
	type JudgedMinijobMonth,
	type MinijobExceedanceStatus,
	monthsBetween,
} from "./minijob-months";

/** Months shown: the 11 before the current one, the current one and the next one. */
export const MINIJOB_VIEW_PAST_MONTHS = 11;
export const MINIJOB_VIEW_FUTURE_MONTHS = 1;

/** What every audience may see of a month. */
export interface MinijobMonthStatus {
	readonly month: string;
	readonly isMinijob: boolean;
	/** Monthly cap tier; null when the month is not a Minijob month or has no baseline. */
	readonly tier: StatutoryUsageTier | null;
	/** Tier of the rolling 12 months ending with this month. */
	readonly rollingTier: StatutoryUsageTier | null;
}

/** Org-admin detail of a month: EUR amounts in cents and the exceedance judgement. */
export interface MinijobMonthDetail extends MinijobMonthStatus {
	readonly usedPercent: number | null;
	readonly rollingUsedPercent: number | null;
	readonly earnedCents: number;
	readonly plannedCents: number;
	readonly externalCents: number;
	readonly totalCents: number;
	readonly capCents: number | null;
	readonly doubleCapCents: number | null;
	readonly rollingTotalCents: number | null;
	readonly rollingCapCents: number | null;
	readonly rollingExcludedCents: number | null;
	readonly missingWageMinutes: number;
	readonly exceedance: {
		readonly status: MinijobExceedanceStatus;
		readonly acknowledgeable: boolean;
	} | null;
}

export interface MinijobExternalOffsetView {
	readonly id: string;
	/** First month, `YYYY-MM`. */
	readonly fromMonth: string;
	/** Last covered month, `YYYY-MM`; null while open-ended. */
	readonly lastMonth: string | null;
	readonly amountCents: number;
	readonly currency: string;
	readonly sourceEmployer: string | null;
	readonly note: string;
	readonly createdAt: Date;
}

export type MinijobMonitorView =
	| {
			readonly audience: "full";
			readonly applies: boolean;
			readonly currentMonth: string;
			/** Newest first. */
			readonly months: readonly MinijobMonthDetail[];
			readonly externalOffsets: readonly MinijobExternalOffsetView[];
	  }
	| {
			readonly audience: "restricted";
			readonly applies: boolean;
			readonly currentMonth: string;
			/** Newest first. */
			readonly months: readonly MinijobMonthStatus[];
	  };

function statusOf(month: JudgedMinijobMonth): MinijobMonthStatus {
	return {
		month: month.month,
		isMinijob: month.isMinijob,
		tier: month.usage?.tier ?? null,
		rollingTier: month.rolling?.tier ?? null,
	};
}

function detailOf(month: JudgedMinijobMonth): MinijobMonthDetail {
	return {
		...statusOf(month),
		usedPercent: month.usage?.usedPercent ?? null,
		rollingUsedPercent: month.rolling?.usedPercent ?? null,
		earnedCents: month.earnedCents,
		plannedCents: month.plannedCents,
		externalCents: month.externalCents,
		totalCents: month.totalCents,
		capCents: month.capCents,
		doubleCapCents: month.doubleCapCents,
		rollingTotalCents: month.rolling?.totalCents ?? null,
		rollingCapCents: month.rolling?.capCents ?? null,
		rollingExcludedCents: month.rolling?.excludedCents ?? null,
		missingWageMinutes: month.missingWageMinutes,
		exceedance: month.exceedance,
	};
}

function monthOfDate(date: string): string {
	return date.slice(0, 7);
}

/** Active external Minijob offsets of the employee, oldest first. Org-admin data. */
export async function listMinijobExternalOffsets(
	db: Pick<DatabaseClient, "select">,
	scope: { readonly organizationId: string; readonly employeeId: string },
): Promise<MinijobExternalOffsetView[]> {
	const rows = await db
		.select()
		.from(employeeStatutoryOffset)
		.where(
			and(
				eq(employeeStatutoryOffset.organizationId, scope.organizationId),
				eq(employeeStatutoryOffset.employeeId, scope.employeeId),
				eq(employeeStatutoryOffset.offsetKind, "external_minijob_monthly_earnings"),
				isNull(employeeStatutoryOffset.voidedAt),
			),
		)
		.orderBy(asc(employeeStatutoryOffset.validFromDate), asc(employeeStatutoryOffset.createdAt));
	return rows.map((row) => ({
		id: row.id,
		fromMonth: monthOfDate(row.validFromDate),
		lastMonth: row.validUntilDate ? addMonths(monthOfDate(row.validUntilDate), -1) : null,
		amountCents: row.amountCents ?? 0,
		currency: row.currency ?? "EUR",
		sourceEmployer: row.sourceEmployer,
		note: row.note,
		createdAt: row.createdAt,
	}));
}

export async function loadEmployeeMinijobMonitor(
	db: Pick<DatabaseClient, "select">,
	input: {
		readonly organizationId: string;
		readonly employeeId: string;
		readonly audience: StatutoryAudience;
		readonly now: Instant;
	},
): Promise<MinijobMonitorView> {
	await loadEmployeeInOrganization(db, input);
	const timezone = await loadOrganizationTimezone(db, input.organizationId);
	const preferences = await loadOrganizationStatutoryPreferences(db, input.organizationId);
	const currentMonth = monthOfDate(plainDateAt(input.now, timezone).toString());
	const from = addMonths(currentMonth, -MINIJOB_VIEW_PAST_MONTHS);
	const until = addMonths(currentMonth, MINIJOB_VIEW_FUTURE_MONTHS + 1);
	const { employees } = await evaluateMinijobEarnings(db, {
		organizationId: input.organizationId,
		timezone,
		employeeIds: [input.employeeId],
		months: { from, until },
		preferences,
		now: input.now,
	});
	const shown = new Set(monthsBetween(from, until));
	const judged = (employees.get(input.employeeId) ?? [])
		.filter((month) => shown.has(month.month))
		.reverse();
	const applies = judged.some((month) => month.isMinijob);

	if (input.audience === "restricted") {
		return { audience: "restricted", applies, currentMonth, months: judged.map(statusOf) };
	}
	return {
		audience: "full",
		applies,
		currentMonth,
		months: judged.map(detailOf),
		externalOffsets: await listMinijobExternalOffsets(db, input),
	};
}
