import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	travelExpenseAllowancePolicy,
	travelExpenseAllowancePolicyVersion,
	travelExpensePerDiemRate,
} from "@/db/schema";
import { type Instant, systemClock } from "@/lib/datetime/temporal-core";
import {
	type ActivateMileagePolicyResult,
	activateAllowancePolicyVersion,
	type PolicyActor,
	type WithdrawPolicyVersionResult,
	withdrawAllowancePolicyVersion,
} from "./allowance-policy-store";
import { DOMESTIC_PER_DIEM_AREA, type PerDiemArea, type PerDiemPolicyVersion } from "./per-diem";
import type { PerDiemPolicyVersionInput } from "./per-diem-policy-input";
import type { PerDiemRates } from "./statutory-per-diem-defaults";

/**
 * The organization's dated per diem policy (#609): the shared allowance
 * policy identity of kind `per_diem` with its amounts per area. Activation
 * and withdrawal reuse the transactional, policy-locked allowance store.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

export interface PerDiemPolicyVersionView extends PerDiemPolicyVersion {
	note: string | null;
	replacesVersionId: string | null;
	createdAt: string;
}

export async function loadPerDiemPolicyVersions(
	database: Reader,
	organizationId: string,
	options: { includeWithdrawn?: boolean } = {},
): Promise<PerDiemPolicyVersionView[]> {
	const versions = await database
		.select({ version: travelExpenseAllowancePolicyVersion })
		.from(travelExpenseAllowancePolicyVersion)
		.innerJoin(
			travelExpenseAllowancePolicy,
			and(
				eq(travelExpenseAllowancePolicy.id, travelExpenseAllowancePolicyVersion.policyId),
				eq(
					travelExpenseAllowancePolicy.organizationId,
					travelExpenseAllowancePolicyVersion.organizationId,
				),
			),
		)
		.where(
			and(
				eq(travelExpenseAllowancePolicyVersion.organizationId, organizationId),
				eq(travelExpenseAllowancePolicy.kind, "per_diem"),
				options.includeWithdrawn ? undefined : isNull(travelExpenseAllowancePolicyVersion.withdrawnAt),
			),
		)
		.orderBy(
			asc(travelExpenseAllowancePolicyVersion.effectiveFrom),
			asc(travelExpenseAllowancePolicyVersion.createdAt),
		);
	if (versions.length === 0) return [];
	const rates = await database
		.select()
		.from(travelExpensePerDiemRate)
		.where(
			and(
				eq(travelExpensePerDiemRate.organizationId, organizationId),
				inArray(
					travelExpensePerDiemRate.versionId,
					versions.map(({ version }) => version.id),
				),
			),
		);
	return versions.map(({ version }) => ({
		id: version.id,
		policyId: version.policyId,
		effectiveFrom: version.effectiveFrom,
		currency: version.currency,
		source: {
			kind: version.sourceKind,
			reference: version.sourceReference,
			version: version.sourceVersion,
			defaultKey: version.defaultKey,
		},
		withdrawnAt: version.withdrawnAt?.toISOString() ?? null,
		rates: Object.fromEntries(
			rates
				.filter((rate) => rate.versionId === version.id)
				.map((rate): [PerDiemArea, PerDiemRates] => [
					rate.area,
					{
						fullDay: rate.fullDayAmount,
						partialDay: rate.partialDayAmount,
						breakfastDeduction: rate.breakfastDeduction,
						lunchDeduction: rate.lunchDeduction,
						dinnerDeduction: rate.dinnerDeduction,
					},
				]),
		),
		note: version.note,
		replacesVersionId: version.replacesVersionId,
		createdAt: version.createdAt.toISOString(),
	}));
}

/** Activates a per diem policy version (same-day replacement only when named). */
export function activatePerDiemPolicyVersion(
	database: Database,
	actor: PolicyActor,
	input: PerDiemPolicyVersionInput,
	now: Instant = systemClock.nowInstant(),
): Promise<ActivateMileagePolicyResult> {
	return activateAllowancePolicyVersion(
		database,
		actor,
		"per_diem",
		input,
		async (tx, versionId) => {
			await tx.insert(travelExpensePerDiemRate).values({
				versionId,
				organizationId: actor.organizationId,
				area: DOMESTIC_PER_DIEM_AREA,
				fullDayAmount: input.rates.fullDay,
				partialDayAmount: input.rates.partialDay,
				breakfastDeduction: input.rates.breakfastDeduction,
				lunchDeduction: input.rates.lunchDeduction,
				dinnerDeduction: input.rates.dinnerDeduction,
			});
		},
		now,
	);
}

export function withdrawPerDiemPolicyVersion(
	database: Database,
	actor: PolicyActor,
	input: { versionId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<WithdrawPolicyVersionResult> {
	return withdrawAllowancePolicyVersion(database, actor, "per_diem", input, now);
}
