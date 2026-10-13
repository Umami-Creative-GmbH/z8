/**
 * The README's explanation of every part and field of the Approvals category
 * (#811, #1172). See "Field guide" in `../collector.ts`.
 */

import { commonFieldExplanations, type PersonalDataFieldGuide } from "../collector";

export const approvalsFieldGuide: PersonalDataFieldGuide = (t) => {
	const common = (...names: Parameters<typeof commonFieldExplanations>[1]) =>
		commonFieldExplanations(t, names);
	const recordKind = () =>
		t(
			"personalDataExport.readme.fields.approvals.shared.recordKind",
			"What kind of record the request is about, for example an absence or a time correction.",
		);
	const recordId = () =>
		t(
			"personalDataExport.readme.fields.approvals.shared.recordId",
			"The ID of that record, for example of an absence in absences.json.",
		);
	const workflowId = () =>
		t(
			"personalDataExport.readme.fields.approvals.shared.workflowId",
			"The ID of the approval in workflows.",
		);
	const decisionReason = () =>
		t(
			"personalDataExport.readme.fields.approvals.shared.decisionReason",
			"The reason given with the decision.",
		);
	const stageLabel = () =>
		t(
			"personalDataExport.readme.fields.approvals.shared.stageLabel",
			"The name of the approval step.",
		);

	return {
		requests: {
			summary: t(
				"personalDataExport.readme.fields.approvals.requests.summary",
				"Your requests for approval, as recorded by an earlier version of the approval system.",
			),
			fields: {
				...common("id", "created_at", "updated_at"),
				record_kind: recordKind(),
				record_id: recordId(),
				status: t(
					"personalDataExport.readme.fields.approvals.requests.status",
					"Whether the request is pending, approved or rejected.",
				),
				reason: t(
					"personalDataExport.readme.fields.approvals.requests.reason",
					"Your reason for the request.",
				),
				notes: t(
					"personalDataExport.readme.fields.approvals.requests.notes",
					"Notes on the request.",
				),
				approver: t(
					"personalDataExport.readme.fields.approvals.requests.approver",
					"The person asked to decide.",
				),
				approved_at: t(
					"personalDataExport.readme.fields.approvals.requests.approvedAt",
					"When the request was decided (UTC).",
				),
				rejection_reason: t(
					"personalDataExport.readme.fields.approvals.requests.rejectionReason",
					"Why the request was rejected.",
				),
			},
		},
		workflows: {
			summary: t(
				"personalDataExport.readme.fields.approvals.workflows.summary",
				"Your requests for approval in the current approval system, one per request.",
			),
			fields: {
				...common("id"),
				workflow_type: t(
					"personalDataExport.readme.fields.approvals.workflows.workflowType",
					"What is being approved, for example an absence, a time correction or a period submission.",
				),
				record_kind: recordKind(),
				record_id: recordId(),
				status: t(
					"personalDataExport.readme.fields.approvals.workflows.status",
					"Where the approval stands: pending, approved, rejected, cancelled or expired.",
				),
				submitted_at: t(
					"personalDataExport.readme.fields.approvals.workflows.submittedAt",
					"When the request was submitted (UTC).",
				),
				completed_at: t(
					"personalDataExport.readme.fields.approvals.workflows.completedAt",
					"When the final decision was made (UTC).",
				),
				cancelled_at: t(
					"personalDataExport.readme.fields.approvals.workflows.cancelledAt",
					"When the request was cancelled (UTC).",
				),
				decision_reason: decisionReason(),
			},
		},
		workflow_stages: {
			summary: t(
				"personalDataExport.readme.fields.approvals.workflowStages.summary",
				"The steps each of your approvals went through, in order.",
			),
			fields: {
				workflow_id: workflowId(),
				stage_order: t(
					"personalDataExport.readme.fields.approvals.workflowStages.stageOrder",
					"The step's position: 1 is the first step.",
				),
				label: stageLabel(),
				status: t(
					"personalDataExport.readme.fields.approvals.workflowStages.status",
					"Where the step stands: waiting (not started), pending, approved, rejected, cancelled or expired.",
				),
				activated_at: t(
					"personalDataExport.readme.fields.approvals.workflowStages.activatedAt",
					"When the step started (UTC).",
				),
				decided_at: t(
					"personalDataExport.readme.fields.approvals.workflowStages.decidedAt",
					"When the step was decided (UTC).",
				),
				decision_reason: decisionReason(),
			},
		},
		workflow_approvers: {
			summary: t(
				"personalDataExport.readme.fields.approvals.workflowApprovers.summary",
				"The people asked to decide on each step of your approvals.",
			),
			fields: {
				workflow_id: workflowId(),
				stage: stageLabel(),
				approver: t(
					"personalDataExport.readme.fields.approvals.workflowApprovers.approver",
					"The person asked to decide.",
				),
				status: t(
					"personalDataExport.readme.fields.approvals.workflowApprovers.status",
					"Where their part stands: pending, approved, rejected, cancelled or expired.",
				),
				assigned_at: t(
					"personalDataExport.readme.fields.approvals.workflowApprovers.assignedAt",
					"When they were asked (UTC).",
				),
				resolved_at: t(
					"personalDataExport.readme.fields.approvals.workflowApprovers.resolvedAt",
					"When their part was settled (UTC).",
				),
				decided_by: t(
					"personalDataExport.readme.fields.approvals.workflowApprovers.decidedBy",
					"Who actually decided: a person's name, or system when the app settled it (legacy_unknown for old records).",
				),
				reassigned_by: t(
					"personalDataExport.readme.fields.approvals.workflowApprovers.reassignedBy",
					"Who passed the decision on to someone else.",
				),
			},
		},
		workflow_events: {
			summary: t(
				"personalDataExport.readme.fields.approvals.workflowEvents.summary",
				"Everything that happened to your approvals, in order.",
			),
			fields: {
				workflow_id: workflowId(),
				event_type: t(
					"personalDataExport.readme.fields.approvals.workflowEvents.eventType",
					"What happened, for example stage.activated, assignment.approved or assignment.escalated.",
				),
				actor: t(
					"personalDataExport.readme.fields.approvals.workflowEvents.actor",
					"Who did it: a person's name, or system when the app did it (legacy_unknown for old records).",
				),
				reason: t(
					"personalDataExport.readme.fields.approvals.workflowEvents.reason",
					"The reason given.",
				),
				occurred_at: t(
					"personalDataExport.readme.fields.approvals.workflowEvents.occurredAt",
					"When it happened (UTC).",
				),
			},
		},
		approval_chains: {
			summary: t(
				"personalDataExport.readme.fields.approvals.approvalChains.summary",
				"Multi-step approvals of your requests, as recorded by an earlier version of the approval system.",
			),
			fields: {
				...common("id", "created_at"),
				policy: t(
					"personalDataExport.readme.fields.approvals.approvalChains.policy",
					"The approval policy that set the steps, by its name at the time.",
				),
				record_kind: recordKind(),
				record_id: recordId(),
				status: t(
					"personalDataExport.readme.fields.approvals.approvalChains.status",
					"Where the approval stands.",
				),
				completed_at: t(
					"personalDataExport.readme.fields.approvals.approvalChains.completedAt",
					"When the last step was decided (UTC).",
				),
			},
		},
		approval_chain_stages: {
			summary: t(
				"personalDataExport.readme.fields.approvals.approvalChainStages.summary",
				"The steps of those multi-step approvals.",
			),
			fields: {
				chain_id: t(
					"personalDataExport.readme.fields.approvals.approvalChainStages.chainId",
					"The ID of the approval in approval_chains.",
				),
				step: t(
					"personalDataExport.readme.fields.approvals.approvalChainStages.step",
					"The step's position: 1 is the first step.",
				),
				label: stageLabel(),
				approver: t(
					"personalDataExport.readme.fields.approvals.approvalChainStages.approver",
					"The person asked to decide on the step.",
				),
				status: t(
					"personalDataExport.readme.fields.approvals.approvalChainStages.status",
					"Where the step stands.",
				),
				decided_by: t(
					"personalDataExport.readme.fields.approvals.approvalChainStages.decidedBy",
					"Who decided on the step.",
				),
				decided_at: t(
					"personalDataExport.readme.fields.approvals.approvalChainStages.decidedAt",
					"When the step was decided (UTC).",
				),
			},
		},
		deputy_decisions: {
			summary: t(
				"personalDataExport.readme.fields.approvals.deputyDecisions.summary",
				"Decisions on your requests made by a deputy standing in for the approver.",
			),
			fields: {
				authority: t(
					"personalDataExport.readme.fields.approvals.deputyDecisions.authority",
					"Which approval system the decision belongs to: legacy (earlier) or canonical (current).",
				),
				record_kind: recordKind(),
				request_id: t(
					"personalDataExport.readme.fields.approvals.deputyDecisions.requestId",
					"The ID of the request in requests, for the earlier system.",
				),
				workflow_id: t(
					"personalDataExport.readme.fields.approvals.deputyDecisions.workflowId",
					"The ID of the approval in workflows, for the current system.",
				),
				decision: t(
					"personalDataExport.readme.fields.approvals.deputyDecisions.decision",
					"What the deputy decided: approved or rejected.",
				),
				decided_by: t(
					"personalDataExport.readme.fields.approvals.deputyDecisions.decidedBy",
					"The deputy who decided.",
				),
				acting_for: t(
					"personalDataExport.readme.fields.approvals.deputyDecisions.actingFor",
					"The approver the deputy stood in for.",
				),
				decided_at: t(
					"personalDataExport.readme.fields.approvals.deputyDecisions.decidedAt",
					"When the deputy decided (UTC).",
				),
			},
		},
		period_submissions: {
			summary: t(
				"personalDataExport.readme.fields.approvals.periodSubmissions.summary",
				"The weeks or months of working time you submitted for approval. Submitting a period again adds a new row.",
			),
			fields: {
				...common("id"),
				cadence: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.cadence",
					"Whether you submit your time per week (weekly) or per month (monthly).",
				),
				week_start_day: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.weekStartDay",
					"For weekly submissions: the day a week starts on.",
				),
				timezone: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.timezone",
					"The time zone the period's days are counted in.",
				),
				start_date: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.startDate",
					"The first day you submitted (YYYY-MM-DD).",
				),
				end_date: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.endDate",
					"The last day you submitted (YYYY-MM-DD).",
				),
				cadence_start_date: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.cadenceStartDate",
					"The first day of the whole week or month (YYYY-MM-DD).",
				),
				cadence_end_date: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.cadenceEndDate",
					"The last day of the whole week or month (YYYY-MM-DD).",
				),
				range_start: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.rangeStart",
					"The start of the submitted days as a point in time (UTC).",
				),
				range_end: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.rangeEnd",
					"The end of the submitted days as a point in time (UTC), not included.",
				),
				status: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.status",
					"Where the submission stands: pending, approved, rejected, withdrawn, or outdated when a later change made an approval out of date.",
				),
				submitted_at: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.submittedAt",
					"When the period was submitted (UTC).",
				),
				submitted_by: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.submittedBy",
					"Who submitted the period.",
				),
				decided_at: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.decidedAt",
					"When the submission was approved or rejected (UTC).",
				),
				decided_by: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.decidedBy",
					"Who approved or rejected the submission.",
				),
				decision_reason: decisionReason(),
				closed_at: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.closedAt",
					"When the submission was withdrawn, or its approval went out of date after a change (UTC).",
				),
				closed_cause: t(
					"personalDataExport.readme.fields.approvals.periodSubmissions.closedCause",
					"Why the submission was closed: you withdrew it (employee), or your time changed after it (change).",
				),
			},
		},
		decisions_on_others: {
			summary: t(
				"personalDataExport.readme.fields.approvals.decisionsOnOthers.summary",
				"The decisions you made on other people's requests. The other person appears only as an anonymous ID.",
			),
			fields: {
				record_kind: t(
					"personalDataExport.readme.fields.approvals.decisionsOnOthers.recordKind",
					"What kind of request you decided on, for example an absence or a shift request.",
				),
				authority: t(
					"personalDataExport.readme.fields.approvals.decisionsOnOthers.authority",
					"Where the decision is recorded: the current approval system (canonical), the earlier one (legacy), or only on the record itself (record).",
				),
				action: t(
					"personalDataExport.readme.fields.approvals.decisionsOnOthers.action",
					"What you decided: approved or rejected, or reassigned when you handed the request on to another approver.",
				),
				acted_at: t(
					"personalDataExport.readme.fields.approvals.decisionsOnOthers.actedAt",
					"When you decided (UTC).",
				),
				as_deputy: t(
					"personalDataExport.readme.fields.approvals.decisionsOnOthers.asDeputy",
					"Whether you decided as a deputy standing in for the approver.",
				),
				other_person: t(
					"personalDataExport.readme.fields.approvals.decisionsOnOthers.otherPerson",
					"An anonymous ID for the person whose request it was. The same person has the same ID throughout this export, and a different one in any other export.",
				),
			},
		},
	};
};
