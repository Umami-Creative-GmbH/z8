import {
	beginDrivingLicenceRetentionChange,
	finishDrivingLicenceRetentionChange,
} from "./retention-state";
import "server-only";
import { and, eq, gte, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
	drivingLicenceCheck,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import { drivingImpedimentReport } from "@/db/schema/driving-licence-impediments";
import { drivingLicenceVerifierGrant } from "@/db/schema/driving-licence-verifiers";
import {
	dateFromInstant,
	instantFromDate,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	assertDrivingLicenceRecordAccess,
	assertDrivingLicenceVerifierAccess,
} from "./access";
import { LICENCE_CLASSES } from "./check-types";
import {
	currentDrivingEmployment,
	lockDrivingLicenceOrganization,
	materializeExpiredDrivingAuthorizations,
} from "./checks";
import type { DrivingLicenceActor } from "./context";
import { isDrivingLicenceIntendedDriver } from "./intended-drivers";
import type { DrivingLicenceDatabase } from "./verifiers";

export async function reportDrivingImpediment(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = z.strictObject({ commandId: z.uuid() }).parse(raw);
	if (!actor.employeeId) throw new Error("unavailable");
	const employeeId = actor.employeeId;
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const now = systemClock.nowInstant();
		const retentionBefore = await beginDrivingLicenceRetentionChange(
			tx,
			actor.organizationId,
			now,
		);
		const employment = await currentDrivingEmployment(
			tx,
			actor.organizationId,
			employeeId,
			now,
		);
		const intendedDriver = await isDrivingLicenceIntendedDriver(tx, {
			organizationId: actor.organizationId,
			employeeId,
		});
		if (
			!intendedDriver ||
			!employment?.hasAccess ||
			employment.userId !== actor.userId
		)
			throw new Error("unavailable");
		const [duplicate] = await tx
			.select()
			.from(drivingImpedimentReport)
			.where(
				and(
					eq(drivingImpedimentReport.organizationId, actor.organizationId),
					eq(drivingImpedimentReport.commandId, input.commandId),
				),
			);
		if (duplicate) {
			if (
				duplicate.employeeId !== employeeId ||
				duplicate.reporterUserId !== actor.userId
			)
				throw new Error("unavailable");
			return { reportId: duplicate.id };
		}
		const [report] = await tx
			.insert(drivingImpedimentReport)
			.values({
				organizationId: actor.organizationId,
				employeeId,
				employmentPeriodId: employment.periodId,
				commandId: input.commandId,
				reportedAt: dateFromInstant(now),
				reporterUserId: actor.userId,
			})
			.returning();
		await tx
			.insert(drivingLicenceSubject)
			.values({
				organizationId: actor.organizationId,
				employeeId,
				employmentPeriodId: employment.periodId,
				suspensionKind: "person",
				suspendedAt: dateFromInstant(now),
				sourceCheckId: null,
			})
			.onConflictDoUpdate({
				target: [
					drivingLicenceSubject.organizationId,
					drivingLicenceSubject.employeeId,
				],
				set: {
					employmentPeriodId: employment.periodId,
					suspensionKind: "person",
					suspendedAt: dateFromInstant(now),
					sourceCheckId: null,
				},
			});
		await tx
			.update(drivingAuthorization)
			.set({
				state: "suspended",
				suspensionReason: "person_impediment",
				suspendedAt: dateFromInstant(now),
			})
			.where(
				and(
					eq(drivingAuthorization.organizationId, actor.organizationId),
					eq(drivingAuthorization.employeeId, employeeId),
					eq(drivingAuthorization.state, "active"),
					employment.periodId
						? eq(drivingAuthorization.employmentPeriodId, employment.periodId)
						: isNull(drivingAuthorization.employmentPeriodId),
				),
			);
		await tx.insert(drivingAuthorizationEvent).values({
			id: report.id,
			organizationId: actor.organizationId,
			employeeId,
			employmentPeriodId: employment.periodId,
			kind: "impediment_reported",
			reason: "person_impediment",
			effectiveAt: dateFromInstant(now),
			recordedAt: dateFromInstant(now),
			actorUserId: actor.userId,
		});
		await finishDrivingLicenceRetentionChange(
			tx,
			actor.organizationId,
			now,
			retentionBefore,
		);
		return { reportId: report.id };
	});
}

function employeeScope(organizationId: string, employeeId: string) {
	return and(
		eq(drivingImpedimentReport.organizationId, organizationId),
		eq(drivingImpedimentReport.employeeId, employeeId),
	);
}
async function impedimentState(
	database: DrivingLicenceDatabase,
	organizationId: string,
	employeeId: string,
	periodId: string | null,
) {
	const reports = await database
		.select()
		.from(drivingImpedimentReport)
		.where(
			and(
				employeeScope(organizationId, employeeId),
				isNull(drivingImpedimentReport.resolvedAt),
			),
		);
	const [subject] = await database
		.select()
		.from(drivingLicenceSubject)
		.where(
			and(
				eq(drivingLicenceSubject.organizationId, organizationId),
				eq(drivingLicenceSubject.employeeId, employeeId),
			),
		);
	return {
		reports: reports
			.filter((r) => r.employmentPeriodId === periodId)
			.map((r) => ({
				id: r.id,
				reportedAt: r.reportedAt.toISOString(),
				scope: r.scope,
			})),
		suspension:
			subject && subject.employmentPeriodId === periodId
				? {
						kind: subject.suspensionKind,
						suspendedAt: subject.suspendedAt.toISOString(),
						sourceCheckId: subject.sourceCheckId,
					}
				: null,
	};
}
export async function readDrivingImpedimentState(
	actor: DrivingLicenceActor,
	employeeId: string,
) {
	const now = systemClock.nowInstant();
	await assertDrivingLicenceRecordAccess(db, {
		organizationId: actor.organizationId,
		userId: actor.userId,
		employeeId,
		now,
	});
	const employment = await currentDrivingEmployment(
		db,
		actor.organizationId,
		employeeId,
		now,
	);
	return impedimentState(
		db,
		actor.organizationId,
		employeeId,
		employment?.periodId ?? null,
	);
}
const reinstatementInput = z.strictObject({
	employeeId: z.uuid(),
	checkId: z.uuid(),
	classCodes: z
		.array(z.enum(LICENCE_CLASSES))
		.min(1)
		.max(LICENCE_CLASSES.length),
	expectedReportIds: z.array(z.uuid()),
	expectedSuspension: z
		.strictObject({
			kind: z.enum(["person", "document"]),
			suspendedAt: z.iso.datetime(),
			sourceCheckId: z.uuid().nullable(),
		})
		.nullable(),
	impedimentResolved: z.literal(true),
});
export async function reinstateDrivingAuthorization(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = reinstatementInput.parse(raw);
	if (
		new Set(input.classCodes).size !== input.classCodes.length ||
		new Set(input.expectedReportIds).size !== input.expectedReportIds.length
	)
		throw new Error("invalid_selection");
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		const now = systemClock.nowInstant();
		const retentionBefore = await beginDrivingLicenceRetentionChange(
			tx,
			actor.organizationId,
			now,
		);
		await tx
			.select({ id: drivingLicenceVerifierGrant.id })
			.from(drivingLicenceVerifierGrant)
			.where(
				and(
					eq(drivingLicenceVerifierGrant.organizationId, actor.organizationId),
					eq(
						drivingLicenceVerifierGrant.verifierEmployeeId,
						actor.employeeId ?? "00000000-0000-0000-0000-000000000000",
					),
				),
			)
			.for("share");
		await assertDrivingLicenceVerifierAccess(tx, {
			organizationId: actor.organizationId,
			userId: actor.userId,
			employeeId: input.employeeId,
			now,
		});
		const employment = await currentDrivingEmployment(
			tx,
			actor.organizationId,
			input.employeeId,
			now,
		);
		if (!employment?.hasAccess) throw new Error("unavailable");
		if (
			!(await isDrivingLicenceIntendedDriver(tx, {
				organizationId: actor.organizationId,
				employeeId: input.employeeId,
			}))
		)
			throw new Error("unavailable");
		await materializeExpiredDrivingAuthorizations(
			tx,
			actor.organizationId,
			now,
			input.employeeId,
		);
		const current = await impedimentState(
			tx,
			actor.organizationId,
			input.employeeId,
			employment.periodId,
		);
		const expectedReports = new Set(input.expectedReportIds);
		if (
			current.reports.length !== expectedReports.size ||
			current.reports.some((r) => !expectedReports.has(r.id)) ||
			current.suspension?.kind !== input.expectedSuspension?.kind ||
			current.suspension?.suspendedAt !==
				input.expectedSuspension?.suspendedAt ||
			current.suspension?.sourceCheckId !==
				input.expectedSuspension?.sourceCheckId
		)
			throw new Error("stale_decision");
		const [check] = await tx
			.select()
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, actor.organizationId),
					eq(drivingLicenceCheck.employeeId, input.employeeId),
					eq(drivingLicenceCheck.id, input.checkId),
				),
			);
		if (
			!check ||
			check.employmentPeriodId !== employment.periodId ||
			!check.originalInspected ||
			!check.identityConfirmed ||
			!check.employeeDeclaration ||
			!check.verifierConfirmed ||
			check.failureScope !== "classes"
		)
			throw new Error("new_original_required");
		// Failed rechecks deliberately retain the successful anchor, so inspect subsequent
		// original facts too; the anchor alone cannot establish current successful evidence.
		const subsequent = await tx
			.select()
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, actor.organizationId),
					eq(drivingLicenceCheck.employeeId, input.employeeId),
					gte(drivingLicenceCheck.controlledAt, check.controlledAt),
				),
			);
		const selectedCodes = new Set(input.classCodes);
		if (
			subsequent.some(
				(other) =>
					other.id !== check.id &&
					other.classes.some((c) => selectedCodes.has(c.code)),
			)
		)
			throw new Error("new_original_required");
		const checkedAt = instantFromDate(check.controlledAt).epochNanoseconds;
		const causes = [
			...current.reports.map((r) => r.reportedAt),
			...(current.suspension ? [current.suspension.suspendedAt] : []),
		];
		if (causes.some((at) => checkedAt <= parseInstant(at).epochNanoseconds))
			throw new Error("new_original_required");
		const rows = await tx
			.select()
			.from(drivingAuthorization)
			.where(
				and(
					eq(drivingAuthorization.organizationId, actor.organizationId),
					eq(drivingAuthorization.employeeId, input.employeeId),
				),
			);
		const selected = input.classCodes.map((code) => {
			const row = rows.find((r) => r.classCode === code);
			if (
				!row ||
				row.employmentPeriodId !== employment.periodId ||
				row.state !== "suspended" ||
				row.supportingCheckId !== check.id ||
				!check.classes.some(
					(c) => c.code === code && c.result === "successful",
				) ||
				instantFromDate(row.expiresAt).epochNanoseconds <=
					now.epochNanoseconds ||
				(row.suspendedAt &&
					checkedAt <= instantFromDate(row.suspendedAt).epochNanoseconds)
			)
				throw new Error("new_original_required");
			return row;
		});
		// Clear only the causes just reviewed. Every uninspected class stays durably suspended.
		await tx
			.delete(drivingLicenceSubject)
			.where(
				and(
					eq(drivingLicenceSubject.organizationId, actor.organizationId),
					eq(drivingLicenceSubject.employeeId, input.employeeId),
					employment.periodId
						? eq(drivingLicenceSubject.employmentPeriodId, employment.periodId)
						: isNull(drivingLicenceSubject.employmentPeriodId),
				),
			);
		for (const report of current.reports) {
			await tx
				.update(drivingImpedimentReport)
				.set({
					resolvedAt: dateFromInstant(now),
					resolvedByUserId: actor.userId,
					resolutionCheckId: check.id,
				})
				.where(
					and(
						employeeScope(actor.organizationId, input.employeeId),
						eq(drivingImpedimentReport.id, report.id),
						isNull(drivingImpedimentReport.resolvedAt),
					),
				);
			await tx.insert(drivingAuthorizationEvent).values({
				organizationId: actor.organizationId,
				employeeId: input.employeeId,
				employmentPeriodId: employment.periodId,
				checkId: check.id,
				kind: "impediment_resolved",
				reason: `reported_impediment:${report.id}`,
				effectiveAt: dateFromInstant(now),
				recordedAt: dateFromInstant(now),
				actorUserId: actor.userId,
			});
		}
		for (const row of selected) {
			await tx
				.update(drivingAuthorization)
				.set({ state: "active", suspensionReason: null, suspendedAt: null })
				.where(
					and(
						eq(drivingAuthorization.organizationId, actor.organizationId),
						eq(drivingAuthorization.id, row.id),
					),
				);
			await tx.insert(drivingAuthorizationEvent).values({
				organizationId: actor.organizationId,
				employeeId: input.employeeId,
				employmentPeriodId: employment.periodId,
				classCode: row.classCode,
				checkId: check.id,
				kind: "reinstated",
				reason: "new_original_and_impediment_resolved",
				effectiveAt: dateFromInstant(now),
				recordedAt: dateFromInstant(now),
				actorUserId: actor.userId,
			});
		}
		await finishDrivingLicenceRetentionChange(
			tx,
			actor.organizationId,
			now,
			retentionBefore,
		);
		return { checkId: check.id, reinstatedClasses: input.classCodes };
	});
}
