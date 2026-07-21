import { and, eq } from "drizzle-orm";
import { organization } from "@/db/auth-schema";
import {
	absenceCategory,
	absenceEntry,
	employee,
	teamMembership,
	timeRecord,
	timeRecordAbsence,
} from "@/db/schema";
import {
	type Clock,
	comparePlainDates,
	type Instant,
	parsePlainDate,
} from "@/lib/datetime/temporal-core";
import type { ApprovalDbService as ServerApprovalDbService } from "../server/types";
import type {
	ApprovalSourceIdentity,
	ApprovalWorkflowSnapshot,
	JsonObject,
} from "../workflow/ports";
import { normalizeStableData } from "../workflow/stable-data";
import { isApprovedCancellationAuthorization } from "./registry";
import type {
	ApprovalDomainAdapter,
	ApprovalDomainAdapterContext,
	ApprovalTerminalAdapterInput,
	ApprovalTerminalFinalizationResult,
} from "./types";

type AbsenceStatus = "pending" | "approved" | "rejected";
type DayPeriod = "full_day" | "am" | "pm";

export interface AbsenceApprovalSource {
	id: string;
	organizationId: string;
	employeeId: string;
	requesterUserId: string;
	categoryId: string;
	canonicalRecordId: string;
	approvalWorkflowId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
	status: AbsenceStatus;
	notes: string | null;
	approvedBy: string | null;
	rejectionReason: string | null;
	requesterName: string;
	teamId: string | null;
	categoryName: string;
	categoryType: string;
	categoryColor: string | null;
	organizationTimezone: string;
}

interface AbsenceMutationInput {
	dbService: ServerApprovalDbService;
	organizationId: string;
	absenceId: string;
	actorEmployeeId: string;
	actorUserId: string;
	finalizedAt: Instant;
}

interface AbsenceFinalizerInput extends AbsenceMutationInput {
	expectedApprovalWorkflowId: string;
	expectedCanonicalRecordId: string;
}

interface DeleteCancelledAbsenceInput extends AbsenceFinalizerInput {
	expectedEmployeeId: string;
	expectedStatus: "pending" | "approved";
}

export interface AbsenceApprovalAdapterDependencies {
	clock: Clock;
	finalizeAbsenceTerminal(
		input: AbsenceFinalizerInput & {
			transition: { kind: "approve" } | { kind: "reject"; reason: string };
		},
	): Promise<unknown>;
	deleteCancelledAbsence(input: DeleteCancelledAbsenceInput): Promise<void>;
}

export class AbsenceApprovalAdapterError extends Error {
	constructor(message = "Absence approval adapter scope or state is invalid") {
		super(message);
		this.name = "AbsenceApprovalAdapterError";
	}
}

function fail(message?: string): never {
	throw new AbsenceApprovalAdapterError(message);
}

function validateIdentity(
	workflow: ApprovalWorkflowSnapshot,
	sourceIdentity: ApprovalSourceIdentity,
	organizationId: string,
): void {
	if (
		organizationId !== workflow.organizationId ||
		organizationId !== sourceIdentity.organizationId ||
		workflow.workflowType !== "absence" ||
		sourceIdentity.workflowType !== "absence" ||
		workflow.sourceType !== "absence_entry" ||
		sourceIdentity.sourceType !== "absence_entry" ||
		workflow.sourceId !== sourceIdentity.sourceId
	) {
		fail();
	}
}

function validateContextIdentity(
	input: ApprovalDomainAdapterContext<AbsenceApprovalSource>,
): void {
	validateIdentity(input.workflow, input.sourceIdentity, input.organizationId);
	if (
		input.source.organizationId !== input.organizationId ||
		input.source.id !== input.sourceIdentity.sourceId ||
		input.source.approvalWorkflowId !== input.workflow.id ||
		input.workflow.requesterEmployeeId !== input.source.employeeId
	) {
		fail();
	}
}

function validateContext(
	input: ApprovalDomainAdapterContext<AbsenceApprovalSource>,
): void {
	validateContextIdentity(input);
	if (input.workflow.status !== input.source.status) fail();
}

function finalizerActor(
	input: ApprovalTerminalAdapterInput<AbsenceApprovalSource>,
) {
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
	return fail("Absence terminal transition requires an employee actor");
}

function sourceSnapshot(
	source: AbsenceApprovalSource,
	status: string,
): JsonObject {
	return normalizeStableData({
		id: source.id,
		organizationId: source.organizationId,
		employeeId: source.employeeId,
		categoryId: source.categoryId,
		canonicalRecordId: source.canonicalRecordId,
		approvalWorkflowId: source.approvalWorkflowId,
		startDate: source.startDate,
		startPeriod: source.startPeriod,
		endDate: source.endDate,
		endPeriod: source.endPeriod,
		status,
	}) as JsonObject;
}

function terminalEvidence(
	input: ApprovalTerminalAdapterInput<AbsenceApprovalSource>,
): ApprovalTerminalFinalizationResult {
	const status = input.transition.to;
	return normalizeStableData({
		organizationId: input.organizationId,
		workflowId: input.workflow.id,
		sourceIdentity: {
			organizationId: input.organizationId,
			workflowType: "absence",
			sourceType: "absence_entry",
			sourceId: input.source.id,
		},
		transitionKind: input.transition.kind,
		terminalStatus: status,
		sourceSnapshot: sourceSnapshot(input.source, status),
		eventPayload: { absenceId: input.source.id, status },
		compatibilityPayload: {
			entityId: input.source.id,
			entityType: "absence_entry",
			status,
		},
		finalizedAt: input.finalizedAt,
	}) as ApprovalTerminalFinalizationResult;
}

export function createAbsenceApprovalAdapter(
	dependencies: AbsenceApprovalAdapterDependencies,
): ApprovalDomainAdapter<AbsenceApprovalSource> {
	return {
		workflowType: "absence",
		sourceType: "absence_entry",
		async loadSource(input) {
			validateIdentity(
				input.workflow,
				input.sourceIdentity,
				input.organizationId,
			);
			const db = (input.dbService as unknown as ServerApprovalDbService).db;
			const source = await db.query.absenceEntry.findFirst({
				where: and(
					eq(absenceEntry.id, input.sourceIdentity.sourceId),
					eq(absenceEntry.organizationId, input.organizationId),
				),
			});
			if (
				!source ||
				source.id !== input.sourceIdentity.sourceId ||
				source.organizationId !== input.organizationId ||
				source.approvalWorkflowId !== input.workflow.id ||
				input.workflow.requesterEmployeeId !== source.employeeId ||
				!source.canonicalRecordId
			) {
				return fail();
			}

			const [
				requester,
				category,
				canonicalRecord,
				canonicalAbsence,
				ownedOrganization,
			] = await Promise.all([
				db.query.employee.findFirst({
					where: and(
						eq(employee.id, source.employeeId),
						eq(employee.organizationId, input.organizationId),
					),
					with: { user: true },
				}),
				db.query.absenceCategory.findFirst({
					where: and(
						eq(absenceCategory.id, source.categoryId),
						eq(absenceCategory.organizationId, input.organizationId),
					),
				}),
				db.query.timeRecord.findFirst({
					where: and(
						eq(timeRecord.id, source.canonicalRecordId),
						eq(timeRecord.organizationId, input.organizationId),
						eq(timeRecord.recordKind, "absence"),
					),
				}),
				db.query.timeRecordAbsence.findFirst({
					where: and(
						eq(timeRecordAbsence.recordId, source.canonicalRecordId),
						eq(timeRecordAbsence.organizationId, input.organizationId),
						eq(timeRecordAbsence.recordKind, "absence"),
					),
				}),
				db.query.organization.findFirst({
					where: eq(organization.id, input.organizationId),
					columns: { id: true, timezone: true },
				}),
			]);
			if (
				!requester ||
				requester.id !== source.employeeId ||
				requester.organizationId !== input.organizationId ||
				!requester.userId ||
				requester.user.id !== requester.userId ||
				!category ||
				category.id !== source.categoryId ||
				category.organizationId !== input.organizationId ||
				!canonicalRecord ||
				canonicalRecord.id !== source.canonicalRecordId ||
				canonicalRecord.organizationId !== input.organizationId ||
				canonicalRecord.employeeId !== source.employeeId ||
				canonicalRecord.recordKind !== "absence" ||
				!canonicalAbsence ||
				canonicalAbsence.recordId !== source.canonicalRecordId ||
				canonicalAbsence.organizationId !== input.organizationId ||
				canonicalAbsence.recordKind !== "absence" ||
				canonicalAbsence.absenceCategoryId !== source.categoryId ||
				ownedOrganization?.id !== input.organizationId ||
				!ownedOrganization.timezone
			) {
				return fail();
			}
			try {
				dependencies.clock
					.nowInstant()
					.toZonedDateTimeISO(ownedOrganization.timezone);
			} catch {
				return fail();
			}

			let trustedTeamId: string | null = null;
			if (requester.teamId) {
				const membership = await db.query.teamMembership.findFirst({
					where: and(
						eq(teamMembership.organizationId, input.organizationId),
						eq(teamMembership.employeeId, source.employeeId),
						eq(teamMembership.teamId, requester.teamId),
					),
				});
				if (
					!membership ||
					membership.organizationId !== input.organizationId ||
					membership.employeeId !== source.employeeId ||
					membership.teamId !== requester.teamId
				) {
					return fail();
				}
				trustedTeamId = requester.teamId;
			}

			return normalizeStableData({
				id: source.id,
				organizationId: source.organizationId,
				employeeId: source.employeeId,
				requesterUserId: requester.userId,
				categoryId: source.categoryId,
				canonicalRecordId: source.canonicalRecordId,
				approvalWorkflowId: source.approvalWorkflowId,
				startDate: source.startDate,
				startPeriod: source.startPeriod,
				endDate: source.endDate,
				endPeriod: source.endPeriod,
				status: source.status,
				notes: source.notes,
				approvedBy: source.approvedBy,
				rejectionReason: source.rejectionReason,
				requesterName: requester.user.name,
				teamId: trustedTeamId,
				categoryName: category.name,
				categoryType: category.type,
				categoryColor: category.color,
				organizationTimezone: ownedOrganization.timezone,
			}) as AbsenceApprovalSource;
		},
		async getTrustedCapabilities(input) {
			validateContext(input);
			const owner =
				input.actor.kind === "employee" &&
				input.actor.employeeId === input.source.employeeId;
			const today = dependencies.clock
				.nowInstant()
				.toZonedDateTimeISO(input.source.organizationTimezone)
				.toPlainDate();
			return {
				canCancelAfterApproval:
					input.source.status === "approved" &&
					owner &&
					comparePlainDates(parsePlainDate(input.source.startDate), today) > 0,
			};
		},
		async produceRoutingContext(input) {
			validateContext(input);
			return normalizeStableData({
				organizationId: input.organizationId,
				workflowType: "absence",
				sourceType: "absence_entry",
				sourceId: input.source.id,
				requesterEmployeeId: input.source.employeeId,
				teamIds: input.source.teamId ? [input.source.teamId] : [],
				locationId: null,
				absenceCategoryId: input.source.categoryId,
				travelExpenseAmount: null,
				overtimeRisk: null,
				employeeGroupIds: [],
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
				input.proposedStatus !== expectedStatus ||
				(["approve", "reject"].includes(input.command.kind) &&
					input.source.status !== "pending") ||
				(input.command.kind === "cancel" &&
					!(["pending", "approved"] as string[]).includes(input.source.status))
			) {
				fail("Absence command is incompatible with source state");
			}
		},
		async preflightTerminal(input) {
			validateContextIdentity(input);
			const compatible =
				(["approve", "reject"].includes(input.transition.kind) &&
					input.transition.from === "pending") ||
				(input.transition.kind === "cancel_pending" &&
					input.transition.from === "pending") ||
				(input.transition.kind === "cancel_approved" &&
					input.transition.from === "approved");
			if (!compatible)
				fail("Absence terminal transition is incompatible with source state");
			if (
				input.source.status !== input.transition.from ||
				input.workflow.status !== input.transition.to
			) {
				fail("Absence terminal transition is incompatible with source state");
			}
			if (
				input.transition.kind === "cancel_approved" &&
				!isApprovedCancellationAuthorization(input.transition.authorization, {
					organizationId: input.organizationId,
					workflowId: input.workflow.id,
					workflowType: input.workflow.workflowType,
					sourceType: input.workflow.sourceType,
					sourceId: input.workflow.sourceId,
				})
			) {
				fail("Approved absence cancellation authorization is invalid");
			}
		},
		async finalizeTerminal(input) {
			await this.preflightTerminal(input);
			const actorIdentity = finalizerActor(input);
			const base = {
				dbService: input.dbService as unknown as ServerApprovalDbService,
				organizationId: input.organizationId,
				absenceId: input.source.id,
				expectedApprovalWorkflowId: input.source.approvalWorkflowId,
				expectedCanonicalRecordId: input.source.canonicalRecordId,
				...actorIdentity,
				finalizedAt: input.finalizedAt,
			};
			switch (input.transition.kind) {
				case "approve":
					await dependencies.finalizeAbsenceTerminal({
						...base,
						transition: { kind: "approve" },
					});
					break;
				case "reject":
					await dependencies.finalizeAbsenceTerminal({
						...base,
						transition: {
							kind: "reject",
							reason: input.transition.reason,
						},
					});
					break;
				case "cancel_pending":
				case "cancel_approved": {
					await dependencies.deleteCancelledAbsence({
						...base,
						expectedEmployeeId: input.source.employeeId,
						expectedStatus: input.transition.from,
					});
					break;
				}
				default:
					return fail("Absence expiration is not supported");
			}
			return terminalEvidence(input);
		},
		async projectDisplay(input) {
			validateContext(input);
			return normalizeStableData({
				displayPayload: {
					requesterEmployeeId: input.source.employeeId,
					requesterName: input.source.requesterName,
					categoryId: input.source.categoryId,
					categoryName: input.source.categoryName,
					categoryColor: input.source.categoryColor,
					startDate: input.source.startDate,
					startPeriod: input.source.startPeriod,
					endDate: input.source.endDate,
					endPeriod: input.source.endPeriod,
					status: input.source.status,
				},
				searchText: [
					input.source.requesterName,
					input.source.categoryName,
					input.source.startDate,
					input.source.endDate,
				]
					.join(" ")
					.toLocaleLowerCase("en-US"),
			}) as { displayPayload: JsonObject; searchText: string };
		},
	};
}
