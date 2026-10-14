import { and, eq } from "drizzle-orm";
import { absenceChangeRequest } from "@/db/schema";
import {
	type AbsenceChangeDatabase,
	type AbsenceChangeRow,
	auditAbsenceChange,
	loadChangeRequest,
} from "@/lib/absences/change-request-records";
import { type Clock, dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import type { JsonObject } from "../workflow/ports";
import { ABSENCE_CHANGE_OBSOLETE_REASON } from "../workflow/ports";
import type { ApprovalDomainAdapter, ApprovalDomainAdapterContext } from "./types";

export type AbsenceChangeApprovalSource = AbsenceChangeRow;

function validate(input: ApprovalDomainAdapterContext<AbsenceChangeApprovalSource>) {
	if (
		input.workflow.workflowType !== "absence_change" ||
		input.workflow.sourceType !== "absence_change_request" ||
		input.organizationId !== input.source.organizationId ||
		input.workflow.sourceId !== input.source.id ||
		input.workflow.id !== input.source.approvalWorkflowId ||
		input.workflow.requesterEmployeeId !== input.source.employeeId
	)
		throw new Error("Absence change approval scope mismatch");
}

export function createAbsenceChangeApprovalAdapter(
	clock: Clock = systemClock,
): ApprovalDomainAdapter<AbsenceChangeApprovalSource> {
	return {
		workflowType: "absence_change",
		sourceType: "absence_change_request",
		async loadSource(input) {
			const row = await loadChangeRequest(
				input.dbService.db as unknown as AbsenceChangeDatabase,
				input.organizationId,
				input.sourceIdentity.sourceId,
			);
			if (!row) throw new Error("Absence change request not found");
			validate({ ...input, source: row });
			return row;
		},
		async getTrustedCapabilities(input) {
			validate(input);
			return { canCancelAfterApproval: false };
		},
		async produceRoutingContext(input) {
			validate(input);
			return input.workflow.contextSnapshot;
		},
		async preflightCommand(input) {
			validate(input);
			if (
				input.source.status !== "pending" ||
				input.workflow.status !== "pending" ||
				input.command.kind === "submit"
			)
				throw new Error("Absence change request is not pending");
		},
		async preflightTerminal(input) {
			validate(input);
			if (input.source.status !== "pending" || input.transition.from !== "pending")
				throw new Error("Absence change transition is invalid");
			if (
				input.transition.kind === "approve" &&
				(input.actor.kind !== "employee" || input.actor.employeeId === input.source.employeeId)
			)
				throw new Error("Another employee must approve absence changes");
		},
		async finalizeTerminal(input) {
			await this.preflightTerminal(input);
			const database = input.dbService.db as unknown as AbsenceChangeDatabase;
			const actorUserId =
				input.actor.kind === "employee" ? input.actor.userId : input.source.submittedBy;
			if (!actorUserId) throw new Error("Absence change actor missing");
			const status =
				input.transition.kind === "cancel_pending"
					? input.transition.reason === ABSENCE_CHANGE_OBSOLETE_REASON
						? "obsolete"
						: "withdrawn"
					: input.transition.kind === "expire"
						? "expired"
						: input.transition.to === "approved"
							? "approved"
							: "rejected";
			const applied =
				status === "approved"
					? await (await import("@/lib/absences/change-request-store")).applyAbsenceChange(
							database,
							input.source,
							actorUserId,
							input.finalizedAt,
						)
					: null;
			await database
				.update(absenceChangeRequest)
				.set({
					status,
					decidedAt: dateFromInstant(input.finalizedAt),
					decidedBy: input.actor.kind === "employee" ? actorUserId : null,
					decisionReason: input.transition.reason,
				})
				.where(
					and(
						eq(absenceChangeRequest.id, input.source.id),
						eq(absenceChangeRequest.organizationId, input.organizationId),
						eq(absenceChangeRequest.status, "pending"),
					),
				);
			if (input.actor.kind === "employee")
				await auditAbsenceChange(database, {
					row: input.source,
					actorUserId,
					action: status,
					at: input.finalizedAt,
				});
			return {
				organizationId: input.organizationId,
				workflowId: input.workflow.id,
				sourceIdentity: input.sourceIdentity,
				transitionKind: input.transition.kind,
				terminalStatus: input.transition.to,
				sourceSnapshot: { id: input.source.id, status },
				eventPayload: { absenceId: input.source.absenceId, status },
				compatibilityPayload: {},
				finalizedAt: input.finalizedAt,
				...(applied ? { workOutcome: applied as unknown as JsonObject } : {}),
			};
		},
		async projectDisplay(input) {
			validate(input);
			return {
				displayPayload: input.workflow.displaySnapshot,
				searchText: "absence change",
			};
		},
		async preflightDecisionEvidence(input) {
			validate(input);
			await (await import("@/lib/absences/change-request-store")).validateEffectiveAbsence(
				input.dbService.db as unknown as AbsenceChangeDatabase,
				input.source,
				clock.nowInstant(),
			);
		},
	};
}
