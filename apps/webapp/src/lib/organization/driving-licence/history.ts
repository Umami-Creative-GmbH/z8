import {
	beginDrivingLicenceRetentionChange,
	finishDrivingLicenceRetentionChange,
} from "./retention-state";
import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { member, user } from "@/db/auth-schema";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
	drivingLicenceCheck,
} from "@/db/schema/driving-licence-checks";
import { drivingLicenceSupplement } from "@/db/schema/driving-licence-history";
import { drivingLicencePolicyRevision } from "@/db/schema/driving-licence-policy";
import { drivingLicenceVerifierGrant } from "@/db/schema/driving-licence-verifiers";
import {
	dateFromInstant,
	type Instant,
	instantFromDate,
	parseInstant,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	assertDrivingLicenceRecordAccess,
	assertDrivingLicenceVerifierAccess,
	resolveDrivingLicenceEmployeeAccess,
} from "./access";
import { LICENCE_CLASSES } from "./check-types";
import {
	lockDrivingLicenceOrganization,
	materializeExpiredDrivingAuthorizations,
	readEffectiveDrivingAuthorization,
} from "./checks";
import type { DrivingLicenceActor } from "./context";
import { assertDrivingLicenceControlOn } from "./control-state";
import type { DrivingLicenceTransaction } from "./verifiers";

async function lockHistoryActor(
	tx: DrivingLicenceTransaction,
	actor: DrivingLicenceActor,
) {
	await tx
		.select({ id: member.id })
		.from(member)
		.where(
			and(
				eq(member.organizationId, actor.organizationId),
				eq(member.userId, actor.userId),
			),
		)
		.for("share");
	if (actor.employeeId)
		await tx
			.select({ id: drivingLicenceVerifierGrant.id })
			.from(drivingLicenceVerifierGrant)
			.where(
				and(
					eq(drivingLicenceVerifierGrant.organizationId, actor.organizationId),
					eq(drivingLicenceVerifierGrant.verifierEmployeeId, actor.employeeId),
				),
			)
			.for("share");
}
const calendarDate = z.iso.date();
const correctionInput = z.discriminatedUnion("field", [
	z.strictObject({ field: z.literal("documentIssuedOn"), value: calendarDate }),
	z.strictObject({
		field: z.literal("documentExpiresOn"),
		value: calendarDate,
	}),
	z.strictObject({
		field: z.literal("classExpiry"),
		classCode: z.enum(LICENCE_CLASSES),
		value: calendarDate.nullable(),
	}),
	z.strictObject({
		field: z.literal("classRestrictions"),
		classCode: z.enum(LICENCE_CLASSES),
		value: z.string().trim().max(300),
	}),
	z.strictObject({
		field: z.literal("classResult"),
		classCode: z.enum(LICENCE_CLASSES),
		value: z.enum(["successful", "unsuccessful", "inconclusive"]),
	}),
]);
const supplementInput = z.strictObject({
	employeeId: z.uuid(),
	checkId: z.uuid(),
	commandId: z.uuid(),
	reason: z.enum(["recording_error", "missing_detail"]),
	correction: correctionInput,
});
export async function supplementDrivingLicenceCheck(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = supplementInput.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		await lockHistoryActor(tx, actor);
		const now = systemClock.nowInstant();
		const retentionBefore = await beginDrivingLicenceRetentionChange(
			tx,
			actor.organizationId,
			now,
		);
		await assertDrivingLicenceVerifierAccess(tx, {
			organizationId: actor.organizationId,
			userId: actor.userId,
			employeeId: input.employeeId,
			now,
		});
		if (!actor.employeeId) throw new Error("unavailable");
		const [original] = await tx
			.select()
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, actor.organizationId),
					eq(drivingLicenceCheck.employeeId, input.employeeId),
					eq(drivingLicenceCheck.id, input.checkId),
				),
			);
		if (!original) throw new Error("unavailable");
		const correctionClass =
			"classCode" in input.correction ? input.correction.classCode : null;
		if (
			correctionClass &&
			!original.classes.some((c) => c.code === correctionClass)
		)
			throw new Error("unavailable");
		const [duplicate] = await tx
			.select()
			.from(drivingLicenceSupplement)
			.where(
				and(
					eq(drivingLicenceSupplement.organizationId, actor.organizationId),
					eq(drivingLicenceSupplement.commandId, input.commandId),
				),
			);
		if (duplicate) {
			if (
				duplicate.employeeId !== input.employeeId ||
				duplicate.checkId !== input.checkId ||
				duplicate.authorUserId !== actor.userId ||
				duplicate.reason !== input.reason ||
				JSON.stringify(correctionInput.parse(duplicate.correction)) !==
					JSON.stringify(input.correction)
			)
				throw new Error("unavailable");
			return { supplementId: duplicate.id };
		}
		const [author] = await tx
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, actor.userId));
		const [saved] = await tx
			.insert(drivingLicenceSupplement)
			.values({
				organizationId: actor.organizationId,
				employeeId: input.employeeId,
				checkId: input.checkId,
				commandId: input.commandId,
				authorEmployeeId: actor.employeeId,
				authorUserId: actor.userId,
				authorName: author?.name ?? actor.userId,
				recordedAt: dateFromInstant(now),
				reason: input.reason,
				correction: input.correction,
			})
			.returning({ id: drivingLicenceSupplement.id });
		if (!saved) throw new Error("save_failed");
		// Corrections are evidence only. Negative facts invalidate supported clearance;
		// positive facts cannot renew a check or satisfy explicit reinstatement.
		const correction = input.correction;
		const inspected =
			"classCode" in correction
				? original.classes.find((c) => c.code === correction.classCode)
				: null;
		const negative =
			correction.field === "documentExpiresOn"
				? correction.value < original.documentExpiresOn
				: correction.field === "classExpiry"
					? correction.value !== null &&
						(!inspected?.expiryDate || correction.value < inspected.expiryDate)
					: correction.field === "classRestrictions"
						? !!correction.value && correction.value !== inspected?.restrictions
						: correction.field === "classResult" &&
							correction.value !== "successful";
		if (negative) {
			await materializeExpiredDrivingAuthorizations(
				tx,
				actor.organizationId,
				now,
				input.employeeId,
			);
			const affected = await tx
				.update(drivingAuthorization)
				.set({
					state: "suspended",
					suspensionReason: "evidence_corrected",
					suspendedAt: dateFromInstant(now),
				})
				.where(
					and(
						eq(drivingAuthorization.organizationId, actor.organizationId),
						eq(drivingAuthorization.employeeId, input.employeeId),
						eq(drivingAuthorization.supportingCheckId, input.checkId),
						eq(drivingAuthorization.state, "active"),
						"classCode" in correction
							? eq(drivingAuthorization.classCode, correction.classCode)
							: undefined,
					),
				)
				.returning();
			for (const row of affected)
				await tx.insert(drivingAuthorizationEvent).values({
					organizationId: actor.organizationId,
					employeeId: input.employeeId,
					employmentPeriodId: row.employmentPeriodId,
					classCode: row.classCode,
					checkId: input.checkId,
					kind: "suspended",
					reason: "evidence_corrected",
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
		return { supplementId: saved.id };
	});
}
export const historyQueryInput = z
	.strictObject({
		employeeId: z.uuid(),
		from: z.iso.datetime({ offset: true }).optional(),
		to: z.iso.datetime({ offset: true }).optional(),
	})
	.refine(
		(input) =>
			!input.from ||
			!input.to ||
			parseInstant(input.from).epochNanoseconds <
				parseInstant(input.to).epochNanoseconds,
		{ message: "Period end must follow its start" },
	);
export type DrivingLicenceHistoryPeriod = { from?: string; to?: string };
/** Internal evidence seam for authorized history/export callers. Call after checking current rights in the same transaction. */
export async function readDrivingLicenceHistoryEvidence(
	tx: DrivingLicenceTransaction,
	organizationId: string,
	employeeId: string,
	period: DrivingLicenceHistoryPeriod,
	now: Instant,
) {
	await materializeExpiredDrivingAuthorizations(
		tx,
		organizationId,
		now,
		employeeId,
	);
	const checks = await tx
		.select()
		.from(drivingLicenceCheck)
		.where(
			and(
				eq(drivingLicenceCheck.organizationId, organizationId),
				eq(drivingLicenceCheck.employeeId, employeeId),
			),
		)
		.orderBy(
			asc(drivingLicenceCheck.controlledAt),
			asc(drivingLicenceCheck.id),
		);
	const supplements = await tx
		.select()
		.from(drivingLicenceSupplement)
		.where(
			and(
				eq(drivingLicenceSupplement.organizationId, organizationId),
				eq(drivingLicenceSupplement.employeeId, employeeId),
			),
		)
		.orderBy(
			asc(drivingLicenceSupplement.recordedAt),
			asc(drivingLicenceSupplement.id),
		);
	const events = await tx
		.select()
		.from(drivingAuthorizationEvent)
		.where(
			and(
				eq(drivingAuthorizationEvent.organizationId, organizationId),
				eq(drivingAuthorizationEvent.employeeId, employeeId),
			),
		)
		.orderBy(
			asc(drivingAuthorizationEvent.effectiveAt),
			asc(drivingAuthorizationEvent.id),
		);
	const start = period.from ? parseInstant(period.from).epochNanoseconds : null;
	const end = period.to ? parseInstant(period.to).epochNanoseconds : null;
	const beforeEnd = (date: Date) =>
		end === null || instantFromDate(date).epochNanoseconds < end;
	const inPeriod = (date: Date) =>
		beforeEnd(date) &&
		(start === null || instantFromDate(date).epochNanoseconds >= start);
	// Last decisions at the opening boundary explain permissions carried into the period.
	const opening = new Map<
		string,
		typeof drivingAuthorizationEvent.$inferSelect
	>();
	for (const event of events) {
		if (
			start !== null &&
			instantFromDate(event.effectiveAt).epochNanoseconds < start
		)
			opening.set(event.classCode ?? "global", event);
	}
	const selectedEvents = events.filter(
		(event) =>
			inPeriod(event.effectiveAt) ||
			opening.get(event.classCode ?? "global")?.id === event.id,
	);
	const selectedIds = new Set(selectedEvents.map((event) => event.id));
	const byId = new Map(events.map((event) => [event.id, event]));
	for (const event of selectedEvents) {
		if (event.reason?.startsWith("reported_impediment:")) {
			const report = byId.get(
				event.reason.slice("reported_impediment:".length),
			);
			if (report && !selectedIds.has(report.id)) {
				selectedEvents.push(report);
				selectedIds.add(report.id);
			}
		}
	}
	selectedEvents.sort(
		(a, b) =>
			Number(
				instantFromDate(a.effectiveAt).epochMilliseconds -
					instantFromDate(b.effectiveAt).epochMilliseconds,
			) || a.id.localeCompare(b.id),
	);
	const checkIds = new Set(
		selectedEvents.flatMap((event) => (event.checkId ? [event.checkId] : [])),
	);
	for (const supplement of supplements)
		if (inPeriod(supplement.recordedAt)) checkIds.add(supplement.checkId);
	const selectedChecks = checks.filter(
		(check) => inPeriod(check.controlledAt) || checkIds.has(check.id),
	);
	const selectedCheckIds = new Set(selectedChecks.map((check) => check.id));
	const versions = new Set(selectedChecks.map((check) => check.policyVersion));
	for (const event of selectedEvents)
		if (event.reason?.startsWith("policy_version:")) {
			const version = Number(event.reason.slice("policy_version:".length));
			if (Number.isSafeInteger(version)) versions.add(version);
		}
	const revisions = versions.size
		? await tx
				.select()
				.from(drivingLicencePolicyRevision)
				.where(
					and(
						eq(drivingLicencePolicyRevision.organizationId, organizationId),
						inArray(drivingLicencePolicyRevision.version, [...versions]),
					),
				)
				.orderBy(asc(drivingLicencePolicyRevision.version))
		: [];
	return {
		period: { from: period.from ?? null, to: period.to ?? null },
		policies: revisions.map((revision) => ({
			version: revision.version,
			intervalMonths: revision.policy.intervalMonths,
			timezone: revision.policy.timezone,
			changedAt: revision.changedAt.toISOString(),
			changedBy: revision.changedBy,
		})),
		checks: selectedChecks.map((c) => ({
			...c,
			controlledAt: c.controlledAt.toISOString(),
			inPeriod: inPeriod(c.controlledAt),
		})),
		supplements: supplements
			.filter((s) => selectedCheckIds.has(s.checkId) && beforeEnd(s.recordedAt))
			.map((s) => ({
				...s,
				recordedAt: s.recordedAt.toISOString(),
				inPeriod: inPeriod(s.recordedAt),
			})),
		events: selectedEvents.map((e) => ({
			...e,
			effectiveAt: e.effectiveAt.toISOString(),
			recordedAt: e.recordedAt.toISOString(),
			inPeriod: inPeriod(e.effectiveAt),
		})),
	};
}
export async function readDrivingLicenceHistory(
	actor: DrivingLicenceActor,
	raw: unknown,
) {
	const input = historyQueryInput.parse(raw);
	return db.transaction(async (tx) => {
		await lockDrivingLicenceOrganization(tx, actor.organizationId);
		await assertDrivingLicenceControlOn(tx, actor.organizationId);
		await lockHistoryActor(tx, actor);
		const now = systemClock.nowInstant();
		const accessInput = {
			organizationId: actor.organizationId,
			userId: actor.userId,
			employeeId: input.employeeId,
			now,
		};
		await assertDrivingLicenceRecordAccess(tx, accessInput);
		const access = await resolveDrivingLicenceEmployeeAccess(tx, accessInput);
		const evidence = await readDrivingLicenceHistoryEvidence(
			tx,
			actor.organizationId,
			input.employeeId,
			input,
			now,
		);
		const authorization = await readEffectiveDrivingAuthorization(
			tx,
			actor.organizationId,
			input.employeeId,
			now,
		);
		return {
			employeeId: input.employeeId,
			canSupplement: access.canVerify,
			authorization,
			...evidence,
		};
	});
}
export type DrivingLicenceHistory = Awaited<
	ReturnType<typeof readDrivingLicenceHistory>
>;
