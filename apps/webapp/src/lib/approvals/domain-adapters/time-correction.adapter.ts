import { and, asc, eq, inArray } from "drizzle-orm";
import { member } from "@/db/auth-schema";
import {
	employee,
	employeeGroupMember,
	teamMembership,
	timeEntry,
	timeRecord,
	timeRecordWork,
	workPeriod,
} from "@/db/schema";
import {
	type Clock,
	compareInstants,
	type Instant,
} from "@/lib/datetime/temporal-core";
import {
	instantFromTimeCorrectionBoundary,
	validateTimeCorrectionTimezoneEvidence,
} from "@/lib/time-tracking/time-correction-temporal";
import { normalizeWorkLocationType } from "@/lib/time-tracking/work-location";
import type {
	CancelledTimeCorrectionSourceEvidence,
	FinalizeTimeCorrectionTerminalInput,
	TimeCorrectionTerminalResult,
} from "../server/time-correction-approvals";
import type { ApprovalDbService as ServerApprovalDbService } from "../server/types";
import type {
	ApprovalDbService,
	ApprovalSourceIdentity,
	ApprovalWorkflowSnapshot,
	JsonObject,
} from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";
import {
	type CurrentTimeCorrectionWorkflowContract,
	normalizeTimeCorrectionOriginalWorkMetadata,
	normalizeTimeCorrectionWorkflowPayload,
	type TimeCorrectionEndpointEvidence,
	type TimeCorrectionOriginalWorkMetadata,
	type TimeCorrectionWorkflowPayload,
} from "./time-correction-contract";
import type {
	ApprovalDomainAdapter,
	ApprovalDomainAdapterContext,
	ApprovalTerminalAdapterInput,
	ApprovalTerminalFinalizationResult,
} from "./types";

const TIMEZONE_SOURCES = new Set([
	"browser",
	"user_setting",
	"manager_target_user_setting",
	"historical_inference",
	"backfill",
]);

type OvertimeRisk = "none" | "warning" | "violation";

export interface TimeCorrectionApprovalSource {
	id: string;
	organizationId: string;
	employeeId: string;
	requesterUserId: string;
	approvalWorkflowId: string;
	canonicalRecordId: string;
	correction: TimeCorrectionWorkflowPayload["timeCorrection"];
	originalWorkMetadata?: TimeCorrectionOriginalWorkMetadata;
	clockIn: TimeCorrectionEndpointEvidence | null;
	clockOut: TimeCorrectionEndpointEvidence | null;
	requesterName: string;
	teamIds: string[];
	locationId: string | null;
	overtimeRisk: OvertimeRisk | null;
	employeeGroupIds: string[];
	workPeriod: {
		clockInId: string;
		clockOutId: string | null;
		startTime: Instant;
		endTime: Instant | null;
		durationMinutes: number | null;
		isActive: boolean;
		approvalStatus: "approved";
		pendingChanges: null;
		workLocationType:
			| CurrentTimeCorrectionWorkflowContract["workLocationType"]
			| null;
		workCategoryId: string | null;
	};
	canonicalRecord: {
		id: string;
		employeeId: string;
		recordKind: "work";
		startAt: Instant;
		endAt: Instant | null;
		durationMinutes: number | null;
		approvalState: "approved";
	};
	canonicalWork: CancelledTimeCorrectionSourceEvidence["canonicalWork"];
	currentEndpoints: CancelledTimeCorrectionSourceEvidence["currentEndpoints"];
	pendingCorrections: CancelledTimeCorrectionSourceEvidence["pendingCorrections"];
}

export interface DeleteCancelledTimeCorrectionInput {
	dbService: ApprovalDbService;
	organizationId: string;
	workPeriodId: string;
	expectedSource: CancelledTimeCorrectionSourceEvidence;
	correction: TimeCorrectionWorkflowPayload["timeCorrection"];
}

export interface TimeCorrectionApprovalAdapterDependencies {
	clock: Clock;
	finalizeTimeCorrectionTerminal(
		input: FinalizeTimeCorrectionTerminalInput,
	): Promise<TimeCorrectionTerminalResult>;
	deleteCancelledCorrections(
		input: DeleteCancelledTimeCorrectionInput,
	): Promise<void>;
}

export class TimeCorrectionApprovalAdapterError extends Error {
	constructor(
		message = "Time correction approval adapter scope or state is invalid",
	) {
		super(message);
		this.name = "TimeCorrectionApprovalAdapterError";
	}
}

function fail(message?: string): never {
	throw new TimeCorrectionApprovalAdapterError(message);
}

function validateIdentity(
	workflow: ApprovalWorkflowSnapshot,
	sourceIdentity: ApprovalSourceIdentity,
	organizationId: string,
): void {
	if (
		workflow.organizationId !== organizationId ||
		sourceIdentity.organizationId !== organizationId ||
		workflow.workflowType !== "time_correction" ||
		sourceIdentity.workflowType !== "time_correction" ||
		workflow.sourceType !== "time_entry" ||
		sourceIdentity.sourceType !== "time_entry" ||
		workflow.sourceId !== sourceIdentity.sourceId ||
		!workflow.requesterEmployeeId
	) {
		fail();
	}
}

function correctionFromContext(
	contextSnapshot: JsonObject,
): TimeCorrectionWorkflowPayload["timeCorrection"] {
	try {
		const descriptor = Object.getOwnPropertyDescriptor(
			contextSnapshot,
			"timeCorrection",
		);
		if (!descriptor?.enumerable || !("value" in descriptor)) return fail();
		return normalizeTimeCorrectionWorkflowPayload({
			timeCorrection: descriptor.value,
		}).timeCorrection;
	} catch {
		return fail();
	}
}

function originalWorkMetadataFromContext(
	contextSnapshot: JsonObject,
	correction: TimeCorrectionWorkflowPayload["timeCorrection"],
): TimeCorrectionOriginalWorkMetadata | undefined {
	const descriptor = Object.getOwnPropertyDescriptor(
		contextSnapshot,
		"timeCorrectionOriginalWorkMetadata",
	);
	if (!descriptor) {
		return Object.hasOwn(correction, "workLocationType") ? fail() : undefined;
	}
	if (!descriptor.enumerable || !("value" in descriptor)) return fail();
	try {
		return normalizeTimeCorrectionOriginalWorkMetadata(descriptor.value);
	} catch {
		return fail();
	}
}

function sameOriginalWorkMetadata(
	left: TimeCorrectionOriginalWorkMetadata | undefined,
	right: TimeCorrectionOriginalWorkMetadata | undefined,
): boolean {
	return (
		left?.workLocationType === right?.workLocationType &&
		left?.workCategoryId === right?.workCategoryId
	);
}

function sameCorrection(
	left: TimeCorrectionWorkflowPayload["timeCorrection"],
	right: TimeCorrectionWorkflowPayload["timeCorrection"],
): boolean {
	const leftIsCurrent = Object.hasOwn(left, "workLocationType");
	const rightIsCurrent = Object.hasOwn(right, "workLocationType");
	return (
		left.action === right.action &&
		left.clockInCorrectionId === right.clockInCorrectionId &&
		left.clockOutCorrectionId === right.clockOutCorrectionId &&
		leftIsCurrent === rightIsCurrent &&
		(!leftIsCurrent ||
			((left as CurrentTimeCorrectionWorkflowContract).workLocationType ===
				(right as CurrentTimeCorrectionWorkflowContract).workLocationType &&
				(left as CurrentTimeCorrectionWorkflowContract).workCategoryId ===
					(right as CurrentTimeCorrectionWorkflowContract).workCategoryId))
	);
}

function sameInstant(left: Date | null, right: Date | null): boolean {
	if (left === null || right === null) return left === right;
	try {
		return (
			compareInstants(
				instantFromTimeCorrectionBoundary(left),
				instantFromTimeCorrectionBoundary(right),
			) === 0
		);
	} catch {
		return false;
	}
}

interface PersistedEntry {
	id: string;
	organizationId: string;
	employeeId: string;
	type: string;
	timestamp: Date;
	utcOffsetMinutes: number;
	timezone: string | null;
	timezoneSource: string;
	replacesEntryId: string | null;
	isSuperseded: boolean;
	supersededById: string | null;
}

function currentEndpointPredecessorId(
	entry: PersistedEntry | undefined,
	input: {
		id: string;
		organizationId: string;
		employeeId: string;
		type: "clock_in" | "clock_out";
	},
): string | null {
	if (
		!entry ||
		entry.id !== input.id ||
		entry.organizationId !== input.organizationId ||
		entry.employeeId !== input.employeeId ||
		entry.isSuperseded ||
		entry.supersededById !== null
	) {
		return fail();
	}
	validateEntryTimezone(entry);
	if (entry.type === input.type) {
		if (entry.replacesEntryId !== null) return fail();
		return null;
	}
	if (
		entry.type !== "correction" ||
		!entry.replacesEntryId ||
		entry.replacesEntryId === entry.id
	) {
		return fail();
	}
	return entry.replacesEntryId;
}

function validateCurrentEndpoint(
	entry: PersistedEntry | undefined,
	predecessor: PersistedEntry | undefined,
	input: {
		id: string;
		organizationId: string;
		employeeId: string;
		type: "clock_in" | "clock_out";
	},
): PersistedEntry {
	const predecessorId = currentEndpointPredecessorId(entry, input);
	if (!entry) return fail();
	if (predecessorId === null) {
		if (predecessor !== undefined) return fail();
		return entry;
	}
	if (
		!predecessor ||
		predecessor.id !== predecessorId ||
		predecessor.id === entry.id ||
		predecessor.organizationId !== input.organizationId ||
		predecessor.employeeId !== input.employeeId ||
		(predecessor.type !== input.type && predecessor.type !== "correction") ||
		predecessor.isSuperseded !== true ||
		predecessor.supersededById !== entry.id ||
		(predecessor.type === input.type && predecessor.replacesEntryId !== null) ||
		(predecessor.type === "correction" &&
			(!predecessor.replacesEntryId ||
				predecessor.replacesEntryId === predecessor.id ||
				predecessor.replacesEntryId === entry.id))
	) {
		return fail();
	}
	validateEntryTimezone(predecessor);
	return entry;
}

function validateEntryTimezone(entry: PersistedEntry): Instant {
	if (!entry.timezone || !TIMEZONE_SOURCES.has(entry.timezoneSource)) {
		return fail();
	}
	try {
		const instant = instantFromTimeCorrectionBoundary(entry.timestamp);
		validateTimeCorrectionTimezoneEvidence({
			instant,
			timezone: entry.timezone,
			utcOffsetMinutes: entry.utcOffsetMinutes,
		});
		return instant;
	} catch {
		return fail();
	}
}

function cancellationEntryEvidence(
	entry: PersistedEntry,
	logicalRole: "clock_in" | "clock_out",
): CancelledTimeCorrectionSourceEvidence["currentEndpoints"]["clockIn"] {
	if (
		(entry.type !== "clock_in" &&
			entry.type !== "clock_out" &&
			entry.type !== "correction") ||
		!entry.timezone
	) {
		return fail();
	}
	return {
		id: entry.id,
		organizationId: entry.organizationId,
		employeeId: entry.employeeId,
		logicalRole,
		type: entry.type,
		replacesEntryId: entry.replacesEntryId,
		timestamp: validateEntryTimezone(entry),
		utcOffsetMinutes: entry.utcOffsetMinutes,
		timezone: entry.timezone,
		timezoneSource: entry.timezoneSource,
		isSuperseded: entry.isSuperseded,
		supersededById: entry.supersededById,
	};
}

function validateCorrection(
	entry: PersistedEntry | undefined,
	input: {
		id: string | undefined;
		organizationId: string;
		employeeId: string;
		originalId: string | null;
		endpointType: "clock_in" | "clock_out";
	},
): TimeCorrectionEndpointEvidence | null {
	if (!input.id) return null;
	if (
		!entry ||
		!input.originalId ||
		entry.id !== input.id ||
		entry.organizationId !== input.organizationId ||
		entry.employeeId !== input.employeeId ||
		entry.type !== "correction" ||
		entry.replacesEntryId !== input.originalId ||
		!entry.isSuperseded ||
		entry.supersededById !== null ||
		!entry.timezone
	) {
		return fail();
	}
	return {
		endpointType: input.endpointType,
		originalEntryId: input.originalId,
		correctionEntryId: entry.id,
		instant: validateEntryTimezone(entry),
		utcOffsetMinutes: entry.utcOffsetMinutes,
		timezone: entry.timezone,
		timezoneSource: entry.timezoneSource,
	};
}

function validateContext(
	input: ApprovalDomainAdapterContext<TimeCorrectionApprovalSource>,
): void {
	validateIdentity(input.workflow, input.sourceIdentity, input.organizationId);
	const expectedCorrection = correctionFromContext(
		input.workflow.contextSnapshot,
	);
	const expectedOriginalWorkMetadata = originalWorkMetadataFromContext(
		input.workflow.contextSnapshot,
		expectedCorrection,
	);
	if (
		input.source.id !== input.sourceIdentity.sourceId ||
		input.source.organizationId !== input.organizationId ||
		input.source.approvalWorkflowId !== input.workflow.id ||
		input.source.employeeId !== input.workflow.requesterEmployeeId ||
		!sameCorrection(input.source.correction, expectedCorrection) ||
		!sameOriginalWorkMetadata(
			input.source.originalWorkMetadata,
			expectedOriginalWorkMetadata,
		)
	) {
		fail();
	}
}

function actorForFinalizer(
	input: ApprovalTerminalAdapterInput<TimeCorrectionApprovalSource>,
): { actorEmployeeId: string; actorUserId: string } {
	if (input.actor.kind === "employee" && input.actor.userId) {
		return {
			actorEmployeeId: input.actor.employeeId,
			actorUserId: input.actor.userId,
		};
	}
	if (
		input.actor.kind === "system" &&
		input.finalizationCause === "activation" &&
		input.transition.kind === "approve"
	) {
		return {
			actorEmployeeId: input.source.employeeId,
			actorUserId: input.source.requesterUserId,
		};
	}
	return fail("Time correction terminal transition requires an employee actor");
}

function endpointLabels(source: TimeCorrectionApprovalSource): string[] {
	return [
		...(source.clockIn ? ["Clock in"] : []),
		...(source.clockOut ? ["Clock out"] : []),
	];
}

function terminalEvidence(
	input: ApprovalTerminalAdapterInput<TimeCorrectionApprovalSource>,
): ApprovalTerminalFinalizationResult {
	const status = input.transition.to;
	const endpointTypes = [
		...(input.source.clockIn ? ["clock_in"] : []),
		...(input.source.clockOut ? ["clock_out"] : []),
	];
	return normalizeStableData({
		organizationId: input.organizationId,
		workflowId: input.workflow.id,
		sourceIdentity: {
			organizationId: input.organizationId,
			workflowType: "time_correction",
			sourceType: "time_entry",
			sourceId: input.source.id,
		},
		transitionKind: input.transition.kind,
		terminalStatus: status,
		sourceSnapshot: {
			id: input.source.id,
			organizationId: input.organizationId,
			employeeId: input.source.employeeId,
			canonicalRecordId: input.source.canonicalRecordId,
			approvalWorkflowId: input.source.approvalWorkflowId,
			status,
			action: input.source.correction.action,
			endpoints: endpointTypes,
		},
		eventPayload: {
			workPeriodId: input.source.id,
			status,
			action: input.source.correction.action,
		},
		compatibilityPayload: {
			entityId: input.source.id,
			entityType: "time_entry",
			status,
		},
		finalizedAt: input.finalizedAt,
	}) as ApprovalTerminalFinalizationResult;
}

export function createTimeCorrectionApprovalAdapter(
	dependencies: TimeCorrectionApprovalAdapterDependencies,
): ApprovalDomainAdapter<TimeCorrectionApprovalSource> {
	return {
		workflowType: "time_correction",
		sourceType: "time_entry",
		async loadSource(input) {
			validateIdentity(
				input.workflow,
				input.sourceIdentity,
				input.organizationId,
			);
			const requesterEmployeeId = input.workflow.requesterEmployeeId;
			if (!requesterEmployeeId) return fail();
			const correction = correctionFromContext(input.workflow.contextSnapshot);
			const originalWorkMetadata = originalWorkMetadataFromContext(
				input.workflow.contextSnapshot,
				correction,
			);
			const db = (input.dbService as unknown as ServerApprovalDbService).db;
			const employeeIds = [
				requesterEmployeeId,
				...(input.actor.kind === "employee" ? [input.actor.employeeId] : []),
			].sort();
			const expectedEmployeeIds = [...new Set(employeeIds)].sort();
			const lockedEmployees = await db
				.select({
					id: employee.id,
					organizationId: employee.organizationId,
					isActive: employee.isActive,
				})
				.from(employee)
				.where(
					and(
						eq(employee.organizationId, input.organizationId),
						eq(employee.isActive, true),
						inArray(employee.id, expectedEmployeeIds),
					),
				)
				.orderBy(asc(employee.id))
				.for("update");
			if (
				lockedEmployees.length !== expectedEmployeeIds.length ||
				lockedEmployees.some(
					(row, index) =>
						row.id !== expectedEmployeeIds[index] ||
						row.organizationId !== input.organizationId ||
						row.isActive !== true,
				)
			) {
				return fail();
			}
			const periodRows = await db
				.select()
				.from(workPeriod)
				.where(
					and(
						eq(workPeriod.id, input.sourceIdentity.sourceId),
						eq(workPeriod.organizationId, input.organizationId),
						eq(workPeriod.employeeId, requesterEmployeeId),
					),
				)
				.for("update");
			const period = periodRows[0];
			if (
				periodRows.length !== 1 ||
				!period ||
				period.id !== input.sourceIdentity.sourceId ||
				period.organizationId !== input.organizationId ||
				period.employeeId !== requesterEmployeeId ||
				period.approvalWorkflowId !== input.workflow.id ||
				!period.canonicalRecordId ||
				period.approvalStatus !== "approved" ||
				period.pendingChanges !== null ||
				period.deletedAt !== null ||
				period.isActive !== (period.clockOutId === null)
			) {
				return fail();
			}
			if (correction.clockOutCorrectionId && !period.clockOutId) return fail();
			const entryIds = [
				period.clockInId,
				period.clockOutId,
				correction.clockInCorrectionId,
				correction.clockOutCorrectionId,
			].filter((id): id is string => Boolean(id));
			if (new Set(entryIds).size !== entryIds.length) return fail();

			const entries = (await db
				.select()
				.from(timeEntry)
				.where(
					and(
						eq(timeEntry.organizationId, input.organizationId),
						eq(timeEntry.employeeId, requesterEmployeeId),
						inArray(timeEntry.id, entryIds),
					),
				)
				.orderBy(asc(timeEntry.id))
				.for("update")) as PersistedEntry[];
			const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
			if (entriesById.size !== entryIds.length) return fail();
			const currentInCandidate = entriesById.get(period.clockInId);
			const currentOutCandidate = period.clockOutId
				? entriesById.get(period.clockOutId)
				: undefined;
			const predecessorIds = [
				currentEndpointPredecessorId(currentInCandidate, {
					id: period.clockInId,
					organizationId: input.organizationId,
					employeeId: requesterEmployeeId,
					type: "clock_in",
				}),
				...(period.clockOutId
					? [
							currentEndpointPredecessorId(currentOutCandidate, {
								id: period.clockOutId,
								organizationId: input.organizationId,
								employeeId: requesterEmployeeId,
								type: "clock_out",
							}),
						]
					: []),
			].filter((id): id is string => id !== null);
			if (new Set(predecessorIds).size !== predecessorIds.length) return fail();
			const predecessorRows =
				predecessorIds.length === 0
					? []
					: ((await db
							.select()
							.from(timeEntry)
							.where(
								and(
									eq(timeEntry.organizationId, input.organizationId),
									eq(timeEntry.employeeId, requesterEmployeeId),
									inArray(timeEntry.id, predecessorIds),
								),
							)
							.orderBy(asc(timeEntry.id))
							.for("update")) as PersistedEntry[]);
			if (predecessorRows.length !== predecessorIds.length) return fail();
			const predecessorsById = new Map(
				predecessorRows.map((entry) => [entry.id, entry]),
			);
			if (predecessorsById.size !== predecessorIds.length) return fail();
			const canonicalRows = await db
				.select()
				.from(timeRecord)
				.where(
					and(
						eq(timeRecord.id, period.canonicalRecordId),
						eq(timeRecord.organizationId, input.organizationId),
						eq(timeRecord.employeeId, requesterEmployeeId),
						eq(timeRecord.recordKind, "work"),
					),
				)
				.orderBy(asc(timeRecord.id))
				.for("update");
			const canonical = canonicalRows[0];
			const canonicalWorkRows = await db
				.select({
					recordId: timeRecordWork.recordId,
					organizationId: timeRecordWork.organizationId,
					recordKind: timeRecordWork.recordKind,
					workLocationType: timeRecordWork.workLocationType,
					workCategoryId: timeRecordWork.workCategoryId,
				})
				.from(timeRecordWork)
				.where(
					and(
						eq(timeRecordWork.recordId, period.canonicalRecordId),
						eq(timeRecordWork.organizationId, input.organizationId),
						eq(timeRecordWork.recordKind, "work"),
					),
				)
				.orderBy(asc(timeRecordWork.recordId))
				.for("update");
			const canonicalWork = canonicalWorkRows[0];
			const requester = await db.query.employee.findFirst({
				where: and(
					eq(employee.id, requesterEmployeeId),
					eq(employee.organizationId, input.organizationId),
					eq(employee.isActive, true),
				),
				with: { user: true },
			});
			if (
				!requester ||
				requester.id !== requesterEmployeeId ||
				requester.organizationId !== input.organizationId ||
				requester.isActive !== true ||
				!requester.userId ||
				requester.user?.id !== requester.userId ||
				!requester.user.name
			) {
				return fail();
			}
			const [memberships, teamRows, groupRows] = await Promise.all([
				db.query.member.findMany({
					where: and(
						eq(member.organizationId, input.organizationId),
						eq(member.userId, requester.userId),
					),
					limit: 2,
				}),
				db.query.teamMembership.findMany({
					where: and(
						eq(teamMembership.organizationId, input.organizationId),
						eq(teamMembership.employeeId, requesterEmployeeId),
					),
				}),
				db.query.employeeGroupMember.findMany({
					where: and(
						eq(employeeGroupMember.organizationId, input.organizationId),
						eq(employeeGroupMember.employeeId, requesterEmployeeId),
					),
				}),
			]);
			const membership = memberships[0];
			if (
				memberships.length !== 1 ||
				!membership ||
				membership.organizationId !== input.organizationId ||
				membership.userId !== requester.userId ||
				membership.status !== "approved" ||
				canonicalRows.length !== 1 ||
				!canonical ||
				canonical.id !== period.canonicalRecordId ||
				canonical.organizationId !== input.organizationId ||
				canonical.employeeId !== requesterEmployeeId ||
				canonical.recordKind !== "work" ||
				canonical.approvalState !== period.approvalStatus ||
				!sameInstant(canonical.startAt, period.startTime) ||
				!sameInstant(canonical.endAt, period.endTime) ||
				canonical.durationMinutes !== period.durationMinutes ||
				canonicalWorkRows.length !== 1 ||
				!canonicalWork ||
				canonicalWork.recordId !== period.canonicalRecordId ||
				canonicalWork.organizationId !== input.organizationId ||
				canonicalWork.recordKind !== "work" ||
				canonicalWork.workLocationType !== (period.workLocationType ?? null) ||
				canonicalWork.workCategoryId !== (period.workCategoryId ?? null) ||
				(originalWorkMetadata !== undefined &&
					(normalizeWorkLocationType(period.workLocationType) !==
						originalWorkMetadata.workLocationType ||
						period.workCategoryId !== originalWorkMetadata.workCategoryId ||
						normalizeWorkLocationType(canonicalWork.workLocationType) !==
							originalWorkMetadata.workLocationType ||
						canonicalWork.workCategoryId !==
							originalWorkMetadata.workCategoryId)) ||
				entries.length !== entryIds.length
			) {
				return fail();
			}
			const originalIn = validateCurrentEndpoint(
				currentInCandidate,
				currentInCandidate?.replacesEntryId
					? predecessorsById.get(currentInCandidate.replacesEntryId)
					: undefined,
				{
					id: period.clockInId,
					organizationId: input.organizationId,
					employeeId: requesterEmployeeId,
					type: "clock_in",
				},
			);
			const originalOut = period.clockOutId
				? validateCurrentEndpoint(
						currentOutCandidate,
						currentOutCandidate?.replacesEntryId
							? predecessorsById.get(currentOutCandidate.replacesEntryId)
							: undefined,
						{
							id: period.clockOutId,
							organizationId: input.organizationId,
							employeeId: requesterEmployeeId,
							type: "clock_out",
						},
					)
				: null;
			if (
				!sameInstant(period.startTime, originalIn.timestamp) ||
				!sameInstant(period.endTime, originalOut?.timestamp ?? null)
			) {
				return fail();
			}
			const clockInCorrectionEntry = entriesById.get(
				correction.clockInCorrectionId ?? "",
			);
			const clockOutCorrectionEntry = entriesById.get(
				correction.clockOutCorrectionId ?? "",
			);
			const clockIn = validateCorrection(clockInCorrectionEntry, {
				id: correction.clockInCorrectionId,
				organizationId: input.organizationId,
				employeeId: requesterEmployeeId,
				originalId: period.clockInId,
				endpointType: "clock_in",
			});
			const clockOut = validateCorrection(clockOutCorrectionEntry, {
				id: correction.clockOutCorrectionId,
				organizationId: input.organizationId,
				employeeId: requesterEmployeeId,
				originalId: period.clockOutId,
				endpointType: "clock_out",
			});
			const teamIds = teamRows.map((row) => {
				if (
					row.organizationId !== input.organizationId ||
					row.employeeId !== requesterEmployeeId ||
					!row.teamId
				) {
					return fail();
				}
				return row.teamId;
			});
			if (requester.teamId && !teamIds.includes(requester.teamId))
				return fail();
			const employeeGroupIds = groupRows.map((row) => {
				if (
					row.organizationId !== input.organizationId ||
					row.employeeId !== requesterEmployeeId ||
					!row.groupId
				) {
					return fail();
				}
				return row.groupId;
			});
			if (
				new Set(teamIds).size !== teamIds.length ||
				new Set(employeeGroupIds).size !== employeeGroupIds.length
			) {
				return fail();
			}

			return normalizeStableData({
				id: period.id,
				organizationId: period.organizationId,
				employeeId: requesterEmployeeId,
				requesterUserId: requester.userId,
				approvalWorkflowId: period.approvalWorkflowId,
				canonicalRecordId: period.canonicalRecordId,
				correction,
				...(originalWorkMetadata ? { originalWorkMetadata } : {}),
				clockIn,
				clockOut,
				requesterName: requester.user.name,
				teamIds: [...teamIds].sort(),
				locationId: null,
				overtimeRisk: null,
				employeeGroupIds: [...employeeGroupIds].sort(),
				workPeriod: {
					clockInId: period.clockInId,
					clockOutId: period.clockOutId,
					startTime: instantFromTimeCorrectionBoundary(period.startTime),
					endTime: period.endTime
						? instantFromTimeCorrectionBoundary(period.endTime)
						: null,
					durationMinutes: period.durationMinutes,
					isActive: period.isActive,
					approvalStatus: "approved",
					pendingChanges: null,
					workLocationType: period.workLocationType ?? null,
					workCategoryId: period.workCategoryId ?? null,
				},
				canonicalRecord: {
					id: canonical.id,
					employeeId: canonical.employeeId,
					recordKind: "work",
					startAt: instantFromTimeCorrectionBoundary(canonical.startAt),
					endAt: canonical.endAt
						? instantFromTimeCorrectionBoundary(canonical.endAt)
						: null,
					durationMinutes: canonical.durationMinutes,
					approvalState: "approved",
				},
				canonicalWork: {
					recordId: canonicalWork.recordId,
					organizationId: canonicalWork.organizationId,
					recordKind: "work",
					workLocationType: canonicalWork.workLocationType,
					workCategoryId: canonicalWork.workCategoryId,
				},
				currentEndpoints: {
					clockIn: cancellationEntryEvidence(originalIn, "clock_in"),
					clockOut: originalOut
						? cancellationEntryEvidence(originalOut, "clock_out")
						: null,
				},
				pendingCorrections: {
					clockIn: clockIn
						? cancellationEntryEvidence(
								clockInCorrectionEntry ?? fail(),
								"clock_in",
							)
						: null,
					clockOut: clockOut
						? cancellationEntryEvidence(
								clockOutCorrectionEntry ?? fail(),
								"clock_out",
							)
						: null,
				},
			}) as TimeCorrectionApprovalSource;
		},
		async getTrustedCapabilities(input) {
			validateContext(input);
			return { canCancelAfterApproval: false };
		},
		async produceRoutingContext(input) {
			validateContext(input);
			return normalizeStableData({
				organizationId: input.organizationId,
				workflowType: "time_correction",
				source: { type: "time_entry", id: input.source.id },
				requesterEmployeeId: input.source.employeeId,
				teamIds: input.source.teamIds,
				locationId: input.source.locationId,
				absenceCategoryId: null,
				travelExpenseAmount: null,
				overtimeRisk: input.source.overtimeRisk,
				employeeGroupIds: input.source.employeeGroupIds,
			}) as JsonObject;
		},
		async preflightCommand(input) {
			validateContext(input);
			const expectedStatus = {
				submit: "pending",
				approve: "approved",
				reject: "rejected",
				cancel: "cancelled",
			}[input.command.kind];
			if (
				input.workflow.status !== "pending" ||
				input.proposedStatus !== expectedStatus
			) {
				return fail(
					"Time correction command is incompatible with source state",
				);
			}
			if (
				input.command.kind === "cancel" &&
				(input.actor.kind !== "employee" ||
					input.actor.employeeId !== input.source.employeeId ||
					input.actor.userId !== input.source.requesterUserId)
			) {
				return fail("Only the requester may cancel a pending time correction");
			}
		},
		async preflightTerminal(input) {
			validateContext(input);
			if (
				input.workflow.status !== input.transition.to ||
				input.transition.from !== "pending" ||
				(input.transition.kind !== "approve" &&
					input.transition.kind !== "reject" &&
					input.transition.kind !== "cancel_pending")
			) {
				return fail(
					"Time correction terminal transition is incompatible with source state",
				);
			}
			if (
				input.transition.kind === "cancel_pending" &&
				(input.actor.kind !== "employee" ||
					input.actor.employeeId !== input.source.employeeId ||
					input.actor.userId !== input.source.requesterUserId)
			) {
				return fail("Only the requester may cancel a pending time correction");
			}
			if (input.transition.kind !== "cancel_pending") actorForFinalizer(input);
		},
		async finalizeTerminal(input) {
			await this.preflightTerminal(input);
			if (input.transition.kind === "cancel_pending") {
				await dependencies.deleteCancelledCorrections({
					dbService: input.dbService,
					organizationId: input.organizationId,
					workPeriodId: input.source.id,
					expectedSource: {
						employeeId: input.source.employeeId,
						approvalWorkflowId: input.source.approvalWorkflowId,
						canonicalRecordId: input.source.canonicalRecordId,
						...input.source.workPeriod,
						canonicalRecord: input.source.canonicalRecord,
						canonicalWork: input.source.canonicalWork,
						currentEndpoints: input.source.currentEndpoints,
						pendingCorrections: input.source.pendingCorrections,
					},
					correction: input.source.correction,
				});
				return terminalEvidence(input);
			}
			const actor = actorForFinalizer(input);
			const transition =
				input.transition.kind === "approve"
					? { kind: "approve" as const, reason: input.transition.reason }
					: input.transition.kind === "reject"
						? { kind: "reject" as const, reason: input.transition.reason }
						: fail("Unsupported time correction terminal transition");
			await dependencies.finalizeTimeCorrectionTerminal({
				dbService: input.dbService as unknown as ServerApprovalDbService,
				organizationId: input.organizationId,
				workPeriodId: input.source.id,
				expectedApprovalWorkflowId: input.workflow.id,
				expectedApprovalWorkflowVersion: input.workflow.version,
				expectedRequesterEmployeeId: input.source.employeeId,
				expectedSource: {
					employeeId: input.source.employeeId,
					approvalWorkflowId: input.source.approvalWorkflowId,
					canonicalRecordId: input.source.canonicalRecordId,
					...input.source.workPeriod,
					canonicalRecord: input.source.canonicalRecord,
					canonicalWork: input.source.canonicalWork,
					currentEndpoints: input.source.currentEndpoints,
					pendingCorrections: input.source.pendingCorrections,
				},
				...actor,
				correction: input.source.correction,
				expectedOriginalWorkMetadata: input.source.originalWorkMetadata,
				legacyApprovalRequestId: null,
				transition,
				finalizedAt: input.finalizedAt,
				allowMetadataLessLegacyFallback: false,
			});
			return terminalEvidence(input);
		},
		async projectDisplay(input) {
			validateContext(input);
			const endpoints = endpointLabels(input.source);
			return normalizeStableData({
				displayPayload: {
					requesterEmployeeId: input.source.employeeId,
					requesterName: input.source.requesterName,
					title: "Time correction",
					action: input.source.correction.action,
					endpoints,
				},
				searchText: [
					input.source.requesterName,
					"Time correction",
					input.source.correction.action,
					...endpoints,
				]
					.join(" ")
					.toLocaleLowerCase("en-US"),
			}) as { displayPayload: JsonObject; searchText: string };
		},
	};
}
