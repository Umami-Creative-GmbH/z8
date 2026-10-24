import "server-only";
import { and, eq, inArray, isNull, ne, or, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import { drivingLicenceTask } from "@/db/schema/driving-licence-tasks";
import { drivingLicenceVerifierGrant } from "@/db/schema/driving-licence-verifiers";
import { AuditAction } from "@/lib/audit-logger";
import type { AuditTrail } from "@/lib/audit-trail";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import {
	beginDrivingLicenceRetentionChange,
	finishDrivingLicenceRetentionChange,
} from "./retention-state";
import {
	type DrivingLicenceTransaction,
	revokeDrivingLicenceVerifierGrantsHeldBy,
} from "./verifiers";

/** Whose driving licence employment ends: the employment period, when one is recorded. */
export type DrivingLicenceEmployment = {
	organizationId: string;
	employeeId: string;
	/** Null for an employee without any employment period: only unversioned rows are theirs. */
	employmentPeriodId: string | null;
};

/**
 * Audit rows for the ended authorizations and revoked verifier grants
 * (#1440, decision D4). A departure records driving events only.
 */
export type DrivingLicenceEmploymentAudit = {
	trail: AuditTrail;
	metadata: Record<string, unknown>;
};

export type EndedDrivingLicenceEmployment = {
	endedAuthorizationIds: string[];
	revokedVerifierGrantIds: string[];
};

/**
 * The rows of the employment: of its period, and unversioned ones. A legacy
 * profile may have acquired its first recorded period only when scheduling
 * this departure; its earlier unversioned state belongs to it too.
 */
export function drivingLicenceEmploymentRows(
	column: AnyPgColumn,
	employmentPeriodId: string | null,
): SQL {
	return employmentPeriodId
		? (or(eq(column, employmentPeriodId), isNull(column)) as SQL)
		: isNull(column);
}

function liveAuthorizations(identity: DrivingLicenceEmployment) {
	return and(
		eq(drivingAuthorization.organizationId, identity.organizationId),
		eq(drivingAuthorization.employeeId, identity.employeeId),
		drivingLicenceEmploymentRows(
			drivingAuthorization.employmentPeriodId,
			identity.employmentPeriodId,
		),
		ne(drivingAuthorization.state, "ended"),
	);
}

/**
 * What `endDrivingLicenceEmployment` would end, for a preview: the
 * authorizations not yet ended and the verifier grants still held.
 */
export async function liveDrivingLicenceEmployment(
	client: Pick<DrivingLicenceTransaction, "select">,
	identity: DrivingLicenceEmployment,
): Promise<{
	authorizations: Array<{ id: string; state: string }>;
	verifierGrantIds: string[];
}> {
	const authorizations = await client
		.select({ id: drivingAuthorization.id, state: drivingAuthorization.state })
		.from(drivingAuthorization)
		.where(liveAuthorizations(identity))
		.orderBy(drivingAuthorization.classCode, drivingAuthorization.id);
	const grants = await client
		.select({ id: drivingLicenceVerifierGrant.id })
		.from(drivingLicenceVerifierGrant)
		.where(
			and(
				eq(drivingLicenceVerifierGrant.organizationId, identity.organizationId),
				eq(drivingLicenceVerifierGrant.verifierEmployeeId, identity.employeeId),
				drivingLicenceEmploymentRows(
					drivingLicenceVerifierGrant.employmentPeriodId,
					identity.employmentPeriodId,
				),
				isNull(drivingLicenceVerifierGrant.revokedAt),
			),
		)
		.orderBy(drivingLicenceVerifierGrant.grantedAt, drivingLicenceVerifierGrant.id);
	return { authorizations, verifierGrantIds: grants.map((grant) => grant.id) };
}

/**
 * Ends the employee's driving licence employment at `cutoff`: every authorization
 * not yet ended (also suspended ones), person-wide suspensions, held verifier
 * grants and pending tasks. Caller holds the lifecycle and driving organization
 * locks and has validated the departure revision or deactivation.
 */
export async function endDrivingLicenceEmployment(
	tx: DrivingLicenceTransaction,
	identity: DrivingLicenceEmployment,
	actorUserId: string,
	cutoff: Instant,
	recordedAt: Instant,
	audit?: DrivingLicenceEmploymentAudit,
): Promise<EndedDrivingLicenceEmployment> {
	const activeBefore = await beginDrivingLicenceRetentionChange(
		tx,
		identity.organizationId,
		cutoff,
	);
	const period = (column: AnyPgColumn) =>
		drivingLicenceEmploymentRows(column, identity.employmentPeriodId);
	const live = liveAuthorizations(identity);
	const before = await tx
		.select({ id: drivingAuthorization.id, state: drivingAuthorization.state })
		.from(drivingAuthorization)
		.where(live);
	const rows =
		before.length === 0
			? []
			: await tx
					.update(drivingAuthorization)
					.set({
						state: "ended",
						suspensionReason: "employment_ended",
						suspendedAt: dateFromInstant(cutoff),
					})
					.where(
						and(
							live,
							inArray(
								drivingAuthorization.id,
								before.map((row) => row.id),
							),
						),
					)
					.returning({
						id: drivingAuthorization.id,
						classCode: drivingAuthorization.classCode,
						checkId: drivingAuthorization.supportingCheckId,
					});
	const globals = await tx
		.delete(drivingLicenceSubject)
		.where(
			and(
				eq(drivingLicenceSubject.organizationId, identity.organizationId),
				eq(drivingLicenceSubject.employeeId, identity.employeeId),
				period(drivingLicenceSubject.employmentPeriodId),
			),
		)
		.returning({ checkId: drivingLicenceSubject.sourceCheckId });
	const events = [
		...rows.map(({ classCode, checkId }) => ({ classCode, checkId })),
		...globals.map((row) => ({ ...row, classCode: null })),
	].map((row) => ({
		organizationId: identity.organizationId,
		employeeId: identity.employeeId,
		employmentPeriodId: identity.employmentPeriodId,
		classCode: row.classCode,
		checkId: row.checkId,
		kind: "ended",
		reason: "employment_ended",
		effectiveAt: dateFromInstant(cutoff),
		recordedAt: dateFromInstant(recordedAt),
		actorUserId,
	}));
	if (events.length) await tx.insert(drivingAuthorizationEvent).values(events);
	const revokedVerifierGrantIds = [
		...(identity.employmentPeriodId
			? await revokeDrivingLicenceVerifierGrantsHeldBy(tx, {
					organizationId: identity.organizationId,
					verifierEmployeeId: identity.employeeId,
					employmentPeriodId: identity.employmentPeriodId,
					actorUserId,
					now: cutoff,
				})
			: []),
		...(await revokeDrivingLicenceVerifierGrantsHeldBy(tx, {
			organizationId: identity.organizationId,
			verifierEmployeeId: identity.employeeId,
			employmentPeriodId: null,
			actorUserId,
			now: cutoff,
		})),
	];
	await tx
		.update(drivingLicenceTask)
		.set({ state: "obsolete" })
		.where(
			and(
				eq(drivingLicenceTask.organizationId, identity.organizationId),
				eq(drivingLicenceTask.employeeId, identity.employeeId),
				period(drivingLicenceTask.employmentPeriodId),
				eq(drivingLicenceTask.state, "pending"),
			),
		);
	await finishDrivingLicenceRetentionChange(tx, identity.organizationId, cutoff, activeBefore);

	if (audit) {
		const stateOf = new Map(before.map((row) => [row.id, row.state]));
		for (const row of rows) {
			await audit.trail.record(tx, {
				organizationId: identity.organizationId,
				action: AuditAction.DRIVING_AUTHORIZATION_ENDED,
				actorUserId,
				targetType: "driving_authorization",
				targetId: row.id,
				employeeId: identity.employeeId,
				changes: { state: { from: stateOf.get(row.id) ?? null, to: "ended" } },
				metadata: {
					...audit.metadata,
					classCode: row.classCode,
					employmentPeriodId: identity.employmentPeriodId,
				},
			});
		}
		for (const grantId of revokedVerifierGrantIds) {
			await audit.trail.record(tx, {
				organizationId: identity.organizationId,
				action: AuditAction.DRIVING_LICENCE_VERIFIER_REVOKED,
				actorUserId,
				targetType: "driving_licence_verifier",
				targetId: grantId,
				employeeId: identity.employeeId,
				metadata: { ...audit.metadata, employmentPeriodId: identity.employmentPeriodId },
			});
		}
	}

	return {
		endedAuthorizationIds: rows.map((row) => row.id),
		revokedVerifierGrantIds,
	};
}
