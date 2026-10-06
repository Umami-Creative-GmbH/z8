import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	travelExpenseAllowancePolicy,
	travelExpenseAllowancePolicyVersion,
	travelExpenseMileageRate,
} from "@/db/schema";
import { dateFromInstant, type Instant, systemClock } from "@/lib/datetime/temporal-core";
import type { AllowancePolicyKind } from "./allowance-policy";
import type { MileagePolicyVersion, MileageVehicle } from "./mileage";
import type { MileagePolicyVersionInput } from "./mileage-policy-input";

/**
 * Organization allowance policies (#606), always scoped to one organization.
 * Activation and withdrawal run in one transaction holding the policy row
 * lock, so concurrent changes serialize and a failed write never leaves a
 * previously valid version withdrawn without its replacement. Versions are
 * never edited: only `withdrawn_*` is ever set.
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type Reader = Database | Transaction;

export interface PolicyActor {
	organizationId: string;
	userId: string;
}

/** A version as administrators review it. */
export interface MileagePolicyVersionView extends MileagePolicyVersion {
	note: string | null;
	replacesVersionId: string | null;
	createdAt: string;
}

/**
 * Every version of the organization's mileage policy (withdrawn ones only
 * when asked), with its rates. Calculations read active versions only.
 */
export async function loadMileagePolicyVersions(
	database: Reader,
	organizationId: string,
	options: { includeWithdrawn?: boolean } = {},
): Promise<MileagePolicyVersionView[]> {
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
				eq(travelExpenseAllowancePolicy.kind, "mileage"),
				options.includeWithdrawn
					? undefined
					: isNull(travelExpenseAllowancePolicyVersion.withdrawnAt),
			),
		)
		.orderBy(
			asc(travelExpenseAllowancePolicyVersion.effectiveFrom),
			asc(travelExpenseAllowancePolicyVersion.createdAt),
		);
	if (versions.length === 0) return [];
	const rates = await database
		.select()
		.from(travelExpenseMileageRate)
		.where(
			and(
				eq(travelExpenseMileageRate.organizationId, organizationId),
				inArray(
					travelExpenseMileageRate.versionId,
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
		ratesPerKm: Object.fromEntries(
			rates
				.filter((rate) => rate.versionId === version.id)
				.map((rate): [MileageVehicle, string] => [rate.vehicle, rate.ratePerKm]),
		),
		note: version.note,
		replacesVersionId: version.replacesVersionId,
		createdAt: version.createdAt.toISOString(),
	}));
}

/** Creates the organization's policy of `kind` if missing, then locks it. */
async function lockPolicy(
	tx: Transaction,
	actor: PolicyActor,
	kind: AllowancePolicyKind,
	at: Date,
): Promise<string> {
	await tx
		.insert(travelExpenseAllowancePolicy)
		.values({ organizationId: actor.organizationId, kind, createdAt: at, createdBy: actor.userId })
		.onConflictDoNothing({
			target: [travelExpenseAllowancePolicy.organizationId, travelExpenseAllowancePolicy.kind],
		});
	const [policy] = await tx
		.select({ id: travelExpenseAllowancePolicy.id })
		.from(travelExpenseAllowancePolicy)
		.where(
			and(
				eq(travelExpenseAllowancePolicy.organizationId, actor.organizationId),
				eq(travelExpenseAllowancePolicy.kind, kind),
			),
		)
		.for("update");
	if (!policy) throw new Error("The allowance policy could not be locked");
	return policy.id;
}

export type ActivateMileagePolicyResult =
	| { kind: "activated"; versionId: string }
	/** An active version already starts that day; replace it explicitly. */
	| { kind: "start_taken"; existingVersionId: string }
	/** The version to replace is no longer the active one starting that day. */
	| { kind: "stale_replacement" };

/**
 * Activates a new mileage policy version from `input.effectiveFrom`. The
 * version it follows keeps its own days; days from the new start belong to
 * the new version until the next version starts. A version starting the same
 * day is replaced only when named in `replacesVersionId` (and is withdrawn in
 * the same transaction).
 */
export async function activateMileagePolicyVersion(
	database: Database,
	actor: PolicyActor,
	input: MileagePolicyVersionInput,
	now: Instant = systemClock.nowInstant(),
): Promise<ActivateMileagePolicyResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const policyId = await lockPolicy(tx, actor, "mileage", at);
		const [sameStart] = await tx
			.select({ id: travelExpenseAllowancePolicyVersion.id })
			.from(travelExpenseAllowancePolicyVersion)
			.where(
				and(
					eq(travelExpenseAllowancePolicyVersion.policyId, policyId),
					eq(travelExpenseAllowancePolicyVersion.organizationId, actor.organizationId),
					eq(travelExpenseAllowancePolicyVersion.effectiveFrom, input.effectiveFrom),
					isNull(travelExpenseAllowancePolicyVersion.withdrawnAt),
				),
			);
		if (input.replacesVersionId) {
			if (sameStart?.id !== input.replacesVersionId) return { kind: "stale_replacement" };
		} else if (sameStart) {
			return { kind: "start_taken", existingVersionId: sameStart.id };
		}
		if (sameStart) {
			await tx
				.update(travelExpenseAllowancePolicyVersion)
				.set({ withdrawnAt: at, withdrawnBy: actor.userId })
				.where(
					and(
						eq(travelExpenseAllowancePolicyVersion.id, sameStart.id),
						eq(travelExpenseAllowancePolicyVersion.organizationId, actor.organizationId),
						isNull(travelExpenseAllowancePolicyVersion.withdrawnAt),
					),
				);
		}
		const [version] = await tx
			.insert(travelExpenseAllowancePolicyVersion)
			.values({
				organizationId: actor.organizationId,
				policyId,
				effectiveFrom: input.effectiveFrom,
				currency: input.currency,
				sourceKind: input.source.kind,
				sourceReference: input.source.reference,
				sourceVersion: input.source.version,
				defaultKey: input.source.defaultKey,
				note: input.note,
				replacesVersionId: sameStart?.id ?? null,
				createdAt: at,
				createdBy: actor.userId,
			})
			.returning({ id: travelExpenseAllowancePolicyVersion.id });
		if (!version) throw new Error("Failed to create the mileage policy version");
		await tx.insert(travelExpenseMileageRate).values(
			Object.entries(input.ratesPerKm).map(([vehicle, ratePerKm]) => ({
				versionId: version.id,
				organizationId: actor.organizationId,
				vehicle: vehicle as MileageVehicle,
				ratePerKm,
			})),
		);
		return { kind: "activated", versionId: version.id };
	});
}

export type WithdrawPolicyVersionResult = { kind: "withdrawn" } | { kind: "not_found" };

/**
 * Withdraws an active version of the organization's mileage policy; its days
 * fall back to the version before it, or become uncovered.
 */
export async function withdrawMileagePolicyVersion(
	database: Database,
	actor: PolicyActor,
	input: { versionId: string },
	now: Instant = systemClock.nowInstant(),
): Promise<WithdrawPolicyVersionResult> {
	const at = dateFromInstant(now);
	return database.transaction(async (tx) => {
		const policyId = await lockPolicy(tx, actor, "mileage", at);
		const withdrawn = await tx
			.update(travelExpenseAllowancePolicyVersion)
			.set({ withdrawnAt: at, withdrawnBy: actor.userId })
			.where(
				and(
					eq(travelExpenseAllowancePolicyVersion.id, input.versionId),
					eq(travelExpenseAllowancePolicyVersion.policyId, policyId),
					eq(travelExpenseAllowancePolicyVersion.organizationId, actor.organizationId),
					isNull(travelExpenseAllowancePolicyVersion.withdrawnAt),
				),
			)
			.returning({ id: travelExpenseAllowancePolicyVersion.id });
		return withdrawn.length === 1 ? { kind: "withdrawn" } : { kind: "not_found" };
	});
}
