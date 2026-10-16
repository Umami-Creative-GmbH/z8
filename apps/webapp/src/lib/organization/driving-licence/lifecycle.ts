import "server-only";
import { and, eq, isNull, ne, or } from "drizzle-orm";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import { drivingLicenceTask } from "@/db/schema/driving-licence-tasks";
import { dateFromInstant, type Instant } from "@/lib/datetime/temporal-core";
import type { DepartureIdentity } from "@/lib/employee-lifecycle/types";
import {
	type DrivingLicenceTransaction,
	revokeDrivingLicenceVerifierGrantsHeldBy,
} from "./verifiers";

/** Caller holds the lifecycle and driving organization locks and has validated this departure revision. */
export async function endDrivingLicenceEmployment(
	tx: DrivingLicenceTransaction,
	identity: DepartureIdentity,
	actorUserId: string,
	cutoff: Instant,
	recordedAt: Instant,
) {
	// A legacy profile may have acquired its first recorded period only when
	// scheduling this departure. Its earlier unversioned state belongs to it too.
	const period = (column: typeof drivingAuthorization.employmentPeriodId) =>
		or(eq(column, identity.employmentPeriodId), isNull(column));
	const rows = await tx
		.update(drivingAuthorization)
		.set({
			state: "ended",
			suspensionReason: "employment_ended",
			suspendedAt: dateFromInstant(cutoff),
		})
		.where(
			and(
				eq(drivingAuthorization.organizationId, identity.organizationId),
				eq(drivingAuthorization.employeeId, identity.employeeId),
				period(drivingAuthorization.employmentPeriodId),
				ne(drivingAuthorization.state, "ended"),
			),
		)
		.returning({
			classCode: drivingAuthorization.classCode,
			checkId: drivingAuthorization.supportingCheckId,
		});
	const globals = await tx
		.delete(drivingLicenceSubject)
		.where(
			and(
				eq(drivingLicenceSubject.organizationId, identity.organizationId),
				eq(drivingLicenceSubject.employeeId, identity.employeeId),
				or(
					eq(
						drivingLicenceSubject.employmentPeriodId,
						identity.employmentPeriodId,
					),
					isNull(drivingLicenceSubject.employmentPeriodId),
				),
			),
		)
		.returning({ checkId: drivingLicenceSubject.sourceCheckId });
	const events = [
		...rows,
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
	await revokeDrivingLicenceVerifierGrantsHeldBy(tx, {
		organizationId: identity.organizationId,
		verifierEmployeeId: identity.employeeId,
		employmentPeriodId: identity.employmentPeriodId,
		actorUserId,
		now: cutoff,
	});
	await revokeDrivingLicenceVerifierGrantsHeldBy(tx, {
		organizationId: identity.organizationId,
		verifierEmployeeId: identity.employeeId,
		employmentPeriodId: null,
		actorUserId,
		now: cutoff,
	});
	await tx
		.update(drivingLicenceTask)
		.set({ state: "obsolete" })
		.where(
			and(
				eq(drivingLicenceTask.organizationId, identity.organizationId),
				eq(drivingLicenceTask.employeeId, identity.employeeId),
				or(
					eq(
						drivingLicenceTask.employmentPeriodId,
						identity.employmentPeriodId,
					),
					isNull(drivingLicenceTask.employmentPeriodId),
				),
				eq(drivingLicenceTask.state, "pending"),
			),
		);
}
