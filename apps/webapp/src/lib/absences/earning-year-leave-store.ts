import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import {
	type LeaveExpiryRules,
	vacationAllowance,
	vacationEarningYearLeave,
	vacationPolicyExpiryClassification,
} from "@/db/schema";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import type { AbsenceDaysDatabase } from "./absence-days-resolver";
import {
	type EarningYearLeave,
	type LeaveExpiryClassification,
	leaveProtection,
} from "./earning-year-leave";

/** Each designated policy's leave-expiry classification; unclassified policies are absent. */
export async function loadLeaveExpiryClassifications(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; policyIds: readonly (string | null | undefined)[] },
): Promise<Map<string, LeaveExpiryClassification>> {
	const policyIds = [
		...new Set(input.policyIds.filter((id): id is string => typeof id === "string")),
	];
	if (!policyIds.length) return new Map();
	const rows = await database
		.select({
			policyId: vacationPolicyExpiryClassification.policyId,
			expiryRules: vacationPolicyExpiryClassification.expiryRules,
			extraDaysSeparateTerms: vacationPolicyExpiryClassification.extraDaysSeparateTerms,
		})
		.from(vacationPolicyExpiryClassification)
		.where(
			and(
				eq(vacationPolicyExpiryClassification.organizationId, input.organizationId),
				inArray(vacationPolicyExpiryClassification.policyId, policyIds),
			),
		);
	return new Map(
		rows.map((row) => [
			row.policyId,
			{ expiryRules: row.expiryRules, extraDaysSeparateTerms: row.extraDaysSeparateTerms },
		]),
	);
}

/** A stored earning-year row with the protection its earning policy's designation gives it. */
export interface StoredEarningYearLeave extends EarningYearLeave {
	transferId: string;
	days: number;
	expiredDays: number;
	expiredAt: Date | null;
	timezone: string;
	/** Carried again at a later year-end: the successor row now holds the unused days. */
	carriedForward: boolean;
}

/**
 * The earning-year leave each employee's committed transfers carried into `receivingYear`, with
 * the protection resolved from the earning policy's current designation (designations are final,
 * so leave earned under a policy keeps it).
 */
export async function loadCarriedEarningYearLeave(
	database: AbsenceDaysDatabase,
	input: { organizationId: string; employeeIds: readonly string[]; receivingYear: number },
): Promise<Map<string, StoredEarningYearLeave[]>> {
	if (!input.employeeIds.length) return new Map();
	const rows = await database
		.select()
		.from(vacationEarningYearLeave)
		.where(
			and(
				eq(vacationEarningYearLeave.organizationId, input.organizationId),
				inArray(vacationEarningYearLeave.employeeId, [...input.employeeIds]),
				eq(vacationEarningYearLeave.receivingYear, input.receivingYear),
			),
		);
	if (!rows.length) return new Map();
	const successors = await database
		.select({ carriedFromId: vacationEarningYearLeave.carriedFromId })
		.from(vacationEarningYearLeave)
		.where(
			and(
				eq(vacationEarningYearLeave.organizationId, input.organizationId),
				inArray(
					vacationEarningYearLeave.carriedFromId,
					rows.map((row) => row.id),
				),
			),
		);
	const carriedForward = new Set(successors.map((row) => row.carriedFromId));
	const classifications = await loadLeaveExpiryClassifications(database, {
		organizationId: input.organizationId,
		policyIds: rows.map((row) => row.earningPolicyId),
	});
	const result = new Map<string, StoredEarningYearLeave[]>();
	for (const row of rows) {
		const days = Number(row.days);
		const expiredDays = Number(row.expiredDays);
		const leave: StoredEarningYearLeave = {
			key: row.id,
			transferId: row.transferId,
			earningYear: row.earningYear,
			earningPolicyId: row.earningPolicyId,
			portion: row.portion,
			protection: leaveProtection(
				row.portion,
				row.earningPolicyId ? classifications.get(row.earningPolicyId) : undefined,
			),
			days,
			expiredDays,
			expiredAt: row.expiredAt,
			capacity: Math.round((days - expiredDays) * 100) / 100,
			configuredExpiry: row.configuredExpiryDate ? instantFromDate(row.configuredExpiryDate) : null,
			timezone: row.timezone,
			carriedForward: carriedForward.has(row.id),
		};
		result.set(row.employeeId, [...(result.get(row.employeeId) ?? []), leave]);
	}
	return result;
}

export type LeaveExpiryClassificationRefusalCode =
	| "policy_not_found"
	| "already_classified"
	| "separate_terms_need_german_rules"
	| "separate_terms_need_basis";

/** A designation HR cannot record as given. */
export class LeaveExpiryClassificationRefused extends Error {
	constructor(
		readonly code: LeaveExpiryClassificationRefusalCode,
		message: string,
	) {
		super(message);
	}
}

/**
 * Records HR's final designation of a vacation policy of the organization. Refuses another
 * organization's policy as not found, a second designation, and separate terms for extra days
 * without German rules or without a basis.
 */
export async function recordLeaveExpiryClassification(
	database: AbsenceDaysDatabase,
	input: {
		organizationId: string;
		policyId: string;
		expiryRules: LeaveExpiryRules;
		extraDaysSeparateTerms: boolean;
		extraDaysTermsBasis: string | null;
		classifiedBy: string;
		classifiedAt: Date;
	},
) {
	const basis = input.extraDaysTermsBasis?.trim() || null;
	if (input.extraDaysSeparateTerms && input.expiryRules !== "german")
		throw new LeaveExpiryClassificationRefused(
			"separate_terms_need_german_rules",
			"Separate terms for extra days apply only under German leave-expiry rules.",
		);
	if (input.extraDaysSeparateTerms && !basis)
		throw new LeaveExpiryClassificationRefused(
			"separate_terms_need_basis",
			"Record where the separate terms for extra days are agreed.",
		);
	const [policy] = await database
		.select({ id: vacationAllowance.id })
		.from(vacationAllowance)
		.where(
			and(
				eq(vacationAllowance.organizationId, input.organizationId),
				eq(vacationAllowance.id, input.policyId),
			),
		);
	if (!policy)
		throw new LeaveExpiryClassificationRefused("policy_not_found", "Vacation policy not found.");
	const [recorded] = await database
		.insert(vacationPolicyExpiryClassification)
		.values({
			organizationId: input.organizationId,
			policyId: policy.id,
			expiryRules: input.expiryRules,
			extraDaysSeparateTerms: input.extraDaysSeparateTerms,
			extraDaysTermsBasis: input.extraDaysSeparateTerms ? basis : null,
			classifiedBy: input.classifiedBy,
			classifiedAt: input.classifiedAt,
		})
		.onConflictDoNothing({ target: vacationPolicyExpiryClassification.policyId })
		.returning();
	if (!recorded)
		throw new LeaveExpiryClassificationRefused(
			"already_classified",
			"This vacation policy's leave-expiry rules are already designated.",
		);
	return {
		policyId: recorded.policyId,
		expiryRules: recorded.expiryRules,
		extraDaysSeparateTerms: recorded.extraDaysSeparateTerms,
		extraDaysTermsBasis: recorded.extraDaysTermsBasis,
		classifiedAt: recorded.classifiedAt,
	};
}
