import { and, eq } from "drizzle-orm";
import { employee } from "@/db/schema";
import type { ApprovalDatabase } from "../server/types";
import type {
	ApprovalWorkflowEventSnapshot,
	ApprovalWorkflowSnapshot,
} from "../workflow/ports";
import { fingerprintApprovalCommandActor } from "../workflow/state-machine";
import {
	type AbsenceCompatibilityEncoding,
	type AbsenceNormalizedCoverageInput,
	type AbsenceRawCoverageInput,
	buildAbsenceSubmittedFacts,
} from "./absence-facts";
import { ApprovalEvidenceError } from "./errors";
import {
	type AbsenceSubmittedRevisionRecord,
	captureAbsenceSubmittedRevision,
	loadCurrentAbsenceSubmittedRevision,
	readApprovalEvidenceMode,
	recordDecisionEvidence,
} from "./store";

export interface CanonicalAbsenceSubmissionEvidenceInput {
	organizationId: string;
	absenceId: string;
	submissionKey: string;
	start: {
		kind: "created" | "existing";
		snapshot: ApprovalWorkflowSnapshot;
		events: ApprovalWorkflowEventSnapshot[];
	};
	subjectEmployeeId: string;
	requesterEmployeeId: string;
	submitterUserId: string;
	category: { id: string; name: string };
	/** The request exactly as received, before duration normalization. */
	raw: AbsenceRawCoverageInput | undefined;
	normalized: AbsenceNormalizedCoverageInput;
	entry: AbsenceCompatibilityEncoding["entry"];
	canonicalRecord: { id: string; startAt: Date; endAt: Date };
}

async function loadEmployeeLabel(
	database: ApprovalDatabase,
	organizationId: string,
	where: { employeeId: string } | { userId: string },
) {
	const rows = await database.query.employee.findMany({
		where: and(
			eq(employee.organizationId, organizationId),
			"employeeId" in where
				? eq(employee.id, where.employeeId)
				: eq(employee.userId, where.userId),
		),
		columns: { id: true, organizationId: true, userId: true },
		with: { user: { columns: { name: true } } },
		limit: 2,
	});
	const row = rows[0];
	if (rows.length !== 1 || !row || row.organizationId !== organizationId) {
		return null;
	}
	return {
		employeeId: row.id,
		userId: row.userId,
		name: row.user?.name ?? null,
	};
}

/**
 * Captures the canonical absence submission's immutable evidence in the same
 * transaction that created the workflow. Returns null while capture is
 * inactive for the organization. Any failure throws and rolls back the
 * submission rather than leaving a success-shaped request without evidence.
 */
export async function captureCanonicalAbsenceSubmissionEvidence(
	database: ApprovalDatabase,
	input: CanonicalAbsenceSubmissionEvidenceInput,
): Promise<AbsenceSubmittedRevisionRecord | null> {
	const mode = await readApprovalEvidenceMode(database, {
		organizationId: input.organizationId,
		workflowType: "absence",
	});
	const workflow = input.start.snapshot;
	if (
		workflow.organizationId !== input.organizationId ||
		workflow.workflowType !== "absence" ||
		workflow.sourceType !== "absence_entry" ||
		workflow.sourceId !== input.absenceId ||
		workflow.requesterEmployeeId !== input.requesterEmployeeId
	) {
		throw new ApprovalEvidenceError("invariant", { field: "workflow_scope" });
	}
	if (input.start.kind === "existing") {
		// Same request cycle replayed inside its submission: never recapture.
		const existing = await loadCurrentAbsenceSubmittedRevision(database, {
			organizationId: input.organizationId,
			workflowId: workflow.id,
		});
		if (!existing && mode === "capture") {
			throw new ApprovalEvidenceError("evidence_incomplete", {
				field: "submitted_revision",
			});
		}
		return existing;
	}
	if (mode !== "capture") return null;
	if (!input.raw) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "raw_input",
		});
	}

	const [subject, submitter] = await Promise.all([
		loadEmployeeLabel(database, input.organizationId, {
			employeeId: input.subjectEmployeeId,
		}),
		loadEmployeeLabel(database, input.organizationId, {
			userId: input.submitterUserId,
		}),
	]);
	if (!subject || !submitter || submitter.userId !== input.submitterUserId) {
		throw new ApprovalEvidenceError("evidence_incomplete", { field: "roles" });
	}
	const requester =
		input.requesterEmployeeId === subject.employeeId
			? subject
			: await loadEmployeeLabel(database, input.organizationId, {
					employeeId: input.requesterEmployeeId,
				});
	if (!requester) {
		throw new ApprovalEvidenceError("evidence_incomplete", {
			field: "requester",
		});
	}

	const facts = buildAbsenceSubmittedFacts({
		organizationId: input.organizationId,
		absenceId: input.absenceId,
		subjectEmployeeId: subject.employeeId,
		requesterEmployeeId: requester.employeeId,
		categoryId: input.category.id,
		raw: input.raw,
		normalized: input.normalized,
		entry: input.entry,
		canonicalRecord: input.canonicalRecord,
	});
	const revision = await captureAbsenceSubmittedRevision(database, {
		organizationId: input.organizationId,
		workflowId: workflow.id,
		requestCycleKey: input.submissionKey,
		submittedAt: workflow.submittedAt,
		facts,
		labels: {
			subjectName: subject.name,
			requesterName: requester.name,
			submitterName: submitter.name,
			categoryName: input.category.name,
		},
		submitter: {
			kind: "employee",
			employeeId: submitter.employeeId,
			userId: submitter.userId,
		},
	});

	if (workflow.status === "approved" || workflow.status === "rejected") {
		// Routing resolved the request during submission (system activation).
		const decidedAt = workflow.completedAt;
		const decidingStages = workflow.stages.filter(
			(stage) => stage.status === workflow.status,
		);
		if (!decidedAt || decidingStages.length === 0) {
			throw new ApprovalEvidenceError("evidence_incomplete", {
				field: "activation_outcome",
			});
		}
		const systemActor = {
			kind: "system",
			employeeId: null,
			userId: null,
		} as const;
		await recordDecisionEvidence(database, {
			organizationId: input.organizationId,
			workflowId: workflow.id,
			submittedRevisionId: revision.id,
			operationKind: "submission_activation",
			receipt: {
				idempotencyKey: input.submissionKey,
				actorFingerprint: fingerprintApprovalCommandActor(systemActor),
				commandFingerprint: "approval-workflow-start",
			},
			action: workflow.status === "approved" ? "approve" : "reject",
			stageId: decidingStages.at(-1)?.id ?? null,
			assignmentId: null,
			assignmentOutcome: null,
			requestOutcome: workflow.status,
			actor: systemActor,
			decidedAt,
			eventIds: input.start.events.map((event) => event.id),
			result: { absenceStatus: workflow.status, terminalTransition: null },
			labels: { actorName: null },
			reviewedBindingId: null,
		});
	}
	return revision;
}
