import type {
	ApprovalDeliveryEffect,
	ApprovalDeliveryProvider,
} from "@/db/schema/approval-delivery";
import type { ApprovalPresentationMode } from "@/db/schema/approval-evidence";
import type { CompletedWorkOperationKind, CompletedWorkWriter } from "@/db/schema/completed-work";
import {
	TIME_ENTRY_APPEND_ADMISSIONS,
	type TimeEntryAppendAdmission,
	type TimeEntryAppendMode,
} from "@/db/schema/time-entry-append";

/**
 * Rollback readiness of one organization (#331 / T66): what a compatible
 * rollback, by pausing fresh work or by rolling code back, must first drain,
 * pause or accept, and which committed rows the rollback target must still
 * read. This module only classifies a snapshot the reader took; it changes
 * nothing. Every pause, drain and deployment stays a separately authorized
 * operator step (docs/refs/rollback.md).
 */

export type RollbackVerdict = "ready" | "hold" | "blocked";

export type RollbackFindingCode =
	// Append adoption (#262/#273)
	| "append_pause_unavailable"
	| "adopted_history_unfenced"
	| "continuation_positions"
	// Approval cards and their delivery (#291–#296, #300, #325, #384)
	| "delivery_pause_gap"
	| "presentation_actionable"
	| "replacement_work_pending"
	| "delivery_work_pending"
	// Escalation (#326, #439)
	| "escalation_automation_running"
	| "transferred_approvals_pending"
	// Durable work an older release ignores or leaves alone
	| "rebuild_intents_pending"
	| "payroll_jobs_in_flight"
	| "break_adjustments_pending"
	| "import_rows_held";

export interface RollbackFinding {
	code: RollbackFindingCode;
	/** A blocker must be drained, decided or resolved first; a hold needs an explicit operator decision. */
	severity: "blocker" | "hold";
	/** Number of affected rows, controls or requests, when the finding counts them. */
	count?: number;
}

export type ApprovalInvocationScheme =
	| "telegram_callback_query"
	| "teams_adaptive_card_action"
	| "discord_interaction";

// ---------------------------------------------------------------------------
// Snapshot (what the reader collects)
// ---------------------------------------------------------------------------

export interface RollbackSnapshot {
	organizationId: string;
	append: {
		mode: TimeEntryAppendMode;
		/** The control's last update while `active` (it has no setter). */
		activatedAt: string | null;
		/** Employee append positions by how they were admitted. */
		positions: Record<TimeEntryAppendAdmission, number>;
	};
	/** Every committed completed-work receipt, by kind and by writer. */
	receipts: {
		kinds: Partial<Record<CompletedWorkOperationKind, number>>;
		writers: Partial<Record<CompletedWorkWriter, number>>;
	};
	cards: {
		deliveryControls: Array<{ workflowType: string; provider: ApprovalDeliveryProvider }>;
		presentationControls: Array<{
			workflowType: string;
			provider: string;
			mode: ApprovalPresentationMode;
		}>;
		/** Delivery work still `pending` or `processing`. */
		openWork: Array<{
			provider: ApprovalDeliveryProvider;
			effect: ApprovalDeliveryEffect;
			count: number;
		}>;
		/** Delivered messages in any state: the only remote identities of sent cards. */
		messages: Partial<Record<ApprovalDeliveryProvider, number>>;
		invocations: Partial<Record<ApprovalInvocationScheme, number>>;
		/** Delivery, binding and invocation rows of legacy-authoritative lifecycles (#296). */
		legacyLifecycleRows: number;
		/** Cycle-keyed legacy delivery rows and withdrawn intents (#384). */
		cycleRows: number;
		/** Replacement delivery work in any state (#300). */
		replacementRows: number;
	};
	escalation: {
		/** Null without a control row: legacy ownership. */
		owner: "legacy" | "escalation" | null;
		automationPaused: boolean;
		/** Pending approvals of time kinds and expenses with a committed transfer. */
		pendingTransferred: Array<{
			authorityMode: "canonical" | "legacy";
			workflowType: string;
			count: number;
		}>;
	};
	durable: {
		rebuildIntents: { organization: number; user: number };
		breakAdjustments: number;
		/** Payroll export jobs not yet finished whose work input is stored (#322). */
		payrollJobsInFlight: number;
		payrollStoredInputs: number;
		payrollControl: boolean;
		/** Reviewed-import rows the commit held (#284). */
		heldImportRows: number;
		/** Historical work proposals in any status (#323). */
		proposals: number;
		repairControl: boolean;
	};
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

interface Section {
	verdict: RollbackVerdict;
	findings: RollbackFinding[];
}

export interface RollbackAppendReadiness extends Section {
	mode: TimeEntryAppendMode;
	activatedAt: string | null;
	positions: Record<TimeEntryAppendAdmission, number> & { total: number };
}

export interface RollbackCardReadiness extends Section {
	deliveryControls: RollbackSnapshot["cards"]["deliveryControls"];
	/** Presentation combinations whose sent cards still decide. */
	actionable: Array<{ workflowType: string; provider: string }>;
	openWork: RollbackSnapshot["cards"]["openWork"];
}

export interface RollbackEscalationReadiness extends Section {
	owner: RollbackSnapshot["escalation"]["owner"];
	automationPaused: boolean;
	pendingTransferred: RollbackSnapshot["escalation"]["pendingTransferred"];
}

export interface RollbackDurableReadiness extends Section {
	rebuildIntents: { organization: number; user: number };
	breakAdjustments: number;
	payrollJobsInFlight: number;
	heldImportRows: number;
}

/** Committed rows that only a schema and release from `migration` on can keep reading. */
export interface RollbackPin {
	migration: string;
	subject: string;
	rows: number;
}

export interface RollbackReadiness {
	organizationId: string;
	/** The worst section verdict. */
	verdict: RollbackVerdict;
	append: RollbackAppendReadiness;
	cards: RollbackCardReadiness;
	escalation: RollbackEscalationReadiness;
	durable: RollbackDurableReadiness;
	/**
	 * The newest migration among the pins: never narrow or drop the schema
	 * below it, and a code rollback target older than it cannot read or replay
	 * the pinned rows. Null when nothing is pinned.
	 */
	schemaFloor: { migration: string | null; pins: RollbackPin[] };
}

// ---------------------------------------------------------------------------
// Migrations that admitted each committed value
// ---------------------------------------------------------------------------

const RECEIPT_KIND_MIGRATIONS: Record<CompletedWorkOperationKind, string> = {
	close_active_work: "0083_completed_work_operation",
	start_live_work: "0084_direct_clock_commands",
	import_completed_work: "0085_reviewed_import_operation",
	import_open_work: "0085_reviewed_import_operation",
	create_completed_work: "0087_runtime_demo_work",
	amend_completed_work: "0089_completed_work_amendment",
	close_resume_work: "0097_close_resume_work",
	submit_time_correction: "0098_correction_lifecycle_operation",
	finalize_time_correction: "0098_correction_lifecycle_operation",
	cancel_time_correction: "0098_correction_lifecycle_operation",
	split_policy_clock_out_break: "0100_policy_clock_out_break_split",
	repair_historical_gap: "0102_historical_gap_repair",
	split_completed_work: "0103_completed_work_split",
	apply_historical_repair_proposal: "0105_historical_work_proposals",
	automatic_break_adjustment: "0106_automatic_break_adjustment",
};

const RECEIPT_WRITER_MIGRATIONS: Record<CompletedWorkWriter, string> = {
	web_clock_out: "0083_completed_work_operation",
	direct_http: "0084_direct_clock_commands",
	reviewed_import: "0085_reviewed_import_operation",
	runtime_demo: "0087_runtime_demo_work",
	bot_clock_out: "0088_bot_clock_out_writer",
	admin_time_edit: "0089_completed_work_amendment",
	self_service_time_edit: "0089_completed_work_amendment",
	http_direct_correction: "0089_completed_work_amendment",
	work_period_attribution_edit: "0089_completed_work_amendment",
	manager_on_behalf: "0092_on_behalf_clock_out_writer",
	manual_entry: "0095_manual_entry_operation",
	time_correction_request: "0098_correction_lifecycle_operation",
	time_correction_decision: "0098_correction_lifecycle_operation",
	time_correction_cancellation: "0098_correction_lifecycle_operation",
	policy_clock_out_decision: "0100_policy_clock_out_break_split",
	historical_gap_repair: "0102_historical_gap_repair",
	work_period_split: "0103_completed_work_split",
	historical_repair_proposal: "0105_historical_work_proposals",
	automatic_break_enforcement: "0106_automatic_break_adjustment",
};

const PROVIDER_MIGRATIONS: Record<ApprovalDeliveryProvider, string> = {
	telegram: "0086_approval_delivery",
	slack: "0090_approval_delivery_slack",
	teams: "0091_teams_approval_actions",
	discord: "0094_discord_approval_delivery",
};

const INVOCATION_SCHEMES: Record<
	ApprovalInvocationScheme,
	{ provider: string; migration: string }
> = {
	telegram_callback_query: { provider: "telegram", migration: "0081_approval_invocation" },
	teams_adaptive_card_action: { provider: "teams", migration: "0091_teams_approval_actions" },
	discord_interaction: { provider: "discord", migration: "0094_discord_approval_delivery" },
};

// ---------------------------------------------------------------------------
// Assessment
// ---------------------------------------------------------------------------

function verdictOf(findings: readonly RollbackFinding[]): RollbackVerdict {
	if (findings.some((finding) => finding.severity === "blocker")) return "blocked";
	return findings.length > 0 ? "hold" : "ready";
}

/** Adds a counted finding only when something is affected. */
function counted(
	findings: RollbackFinding[],
	code: RollbackFindingCode,
	severity: RollbackFinding["severity"],
	count: number,
) {
	if (count > 0) findings.push({ code, severity, count });
}

function section<T extends object>(details: T, findings: RollbackFinding[]): T & Section {
	return { ...details, verdict: verdictOf(findings), findings };
}

function assessAppend({ append }: RollbackSnapshot): RollbackAppendReadiness {
	const total = TIME_ENTRY_APPEND_ADMISSIONS.reduce(
		(sum, admission) => sum + append.positions[admission],
		0,
	);
	const findings: RollbackFinding[] = [];
	if (append.mode === "active") {
		// There is no paused state: `inactive` resumes legacy writers against the
		// adopted positions, and bot and on-behalf code rollbacks need `inactive`.
		findings.push({ code: "append_pause_unavailable", severity: "blocker" });
	} else {
		// The organization was adopted and returned to inactive: legacy head
		// selection writes again, and re-activation holds interrupted employees.
		counted(findings, "adopted_history_unfenced", "blocker", total);
	}
	// An older release holds these employees' appends; dropping the position loses its provenance.
	counted(findings, "continuation_positions", "hold", append.positions.authorized_continuation);
	return section(
		{
			mode: append.mode,
			activatedAt: append.activatedAt,
			positions: { ...append.positions, total },
		},
		findings,
	);
}

function assessCards({ cards }: RollbackSnapshot): RollbackCardReadiness {
	const actionable = cards.presentationControls
		.filter((control) => control.mode === "actionable")
		.map(({ workflowType, provider }) => ({ workflowType, provider }));
	const sum = (effects: readonly ApprovalDeliveryEffect[]) =>
		cards.openWork
			.filter((work) => effects.includes(work.effect))
			.reduce((total, work) => total + work.count, 0);
	const findings: RollbackFinding[] = [];
	// Deleting a control stops the owner, and canonical submissions then send no card at all.
	counted(findings, "delivery_pause_gap", "hold", cards.deliveryControls.length);
	// Set `review_only` first so older binaries show review notices instead of failures.
	counted(findings, "presentation_actionable", "hold", actionable.length);
	// A pre-#300 worker cancels replacement cards as `purged`.
	counted(findings, "replacement_work_pending", "blocker", sum(["replacement"]));
	// An older worker without the provider's adapter exhausts it.
	counted(findings, "delivery_work_pending", "hold", sum(["initial", "refresh"]));
	return section(
		{ deliveryControls: cards.deliveryControls, actionable, openWork: cards.openWork },
		findings,
	);
}

function assessEscalation({ escalation }: RollbackSnapshot): RollbackEscalationReadiness {
	const findings: RollbackFinding[] = [];
	if (escalation.owner === "escalation" && !escalation.automationPaused) {
		findings.push({ code: "escalation_automation_running", severity: "hold" });
	}
	// Older decision owners lack the revocation checks (#326) or reject the
	// transfer lineage (#439): let the replacements decide these first.
	counted(
		findings,
		"transferred_approvals_pending",
		"blocker",
		escalation.pendingTransferred.reduce((total, group) => total + group.count, 0),
	);
	return section(
		{
			owner: escalation.owner,
			automationPaused: escalation.automationPaused,
			pendingTransferred: escalation.pendingTransferred,
		},
		findings,
	);
}

function assessDurable({ durable }: RollbackSnapshot): RollbackDurableReadiness {
	const findings: RollbackFinding[] = [];
	// Pre-#421 binaries ignore intents, and pre-#428 ones widen user intents.
	counted(
		findings,
		"rebuild_intents_pending",
		"blocker",
		durable.rebuildIntents.organization + durable.rebuildIntents.user,
	);
	// A release without #322 ignores stored inputs, so a retry would reread work.
	counted(findings, "payroll_jobs_in_flight", "blocker", durable.payrollJobsInFlight);
	// A binary without #441 ignores intents; they stay inert until re-adoption.
	counted(findings, "break_adjustments_pending", "hold", durable.breakAdjustments);
	// Older code neither clears nor re-commits them: never reset them by hand.
	counted(findings, "import_rows_held", "hold", durable.heldImportRows);
	return section(
		{
			rebuildIntents: durable.rebuildIntents,
			breakAdjustments: durable.breakAdjustments,
			payrollJobsInFlight: durable.payrollJobsInFlight,
			heldImportRows: durable.heldImportRows,
		},
		findings,
	);
}

function assessSchemaFloor(snapshot: RollbackSnapshot): RollbackReadiness["schemaFloor"] {
	const pins: RollbackPin[] = [];
	const pin = (migration: string, subject: string, rows: number) => {
		if (rows > 0) pins.push({ migration, subject, rows });
	};
	const { append, receipts, cards, durable } = snapshot;

	pin(
		"0079_time_entry_append_position",
		"append positions",
		append.positions.empty_history + append.positions.verified_lineage,
	);
	pin(
		"0105_historical_work_proposals",
		"authorized continuation positions",
		append.positions.authorized_continuation,
	);
	for (const [kind, rows] of Object.entries(receipts.kinds)) {
		pin(
			RECEIPT_KIND_MIGRATIONS[kind as CompletedWorkOperationKind],
			`receipt kind ${kind}`,
			rows ?? 0,
		);
	}
	for (const [writer, rows] of Object.entries(receipts.writers)) {
		pin(
			RECEIPT_WRITER_MIGRATIONS[writer as CompletedWorkWriter],
			`receipt writer ${writer}`,
			rows ?? 0,
		);
	}
	for (const [provider, rows] of Object.entries(cards.messages)) {
		pin(
			PROVIDER_MIGRATIONS[provider as ApprovalDeliveryProvider],
			`${provider} delivery messages`,
			rows ?? 0,
		);
	}
	for (const [scheme, rows] of Object.entries(cards.invocations)) {
		const { provider, migration } = INVOCATION_SCHEMES[scheme as ApprovalInvocationScheme];
		pin(migration, `${provider} invocations`, rows ?? 0);
	}
	pin("0093_legacy_expense_presentation", "legacy card lifecycles", cards.legacyLifecycleRows);
	pin("0096_escalation_replacement_delivery", "replacement delivery work", cards.replacementRows);
	pin("0108_legacy_absence_presentation", "cycle-keyed legacy delivery", cards.cycleRows);
	pin(
		"0099_work_balance_rebuild_intent",
		"organization rebuild intents",
		durable.rebuildIntents.organization,
	);
	pin("0101_user_timezone_rebuild_intent", "user rebuild intents", durable.rebuildIntents.user);
	pin("0102_historical_gap_repair", "historical repair control", durable.repairControl ? 1 : 0);
	pin("0104_payroll_work_collection", "payroll collection control", durable.payrollControl ? 1 : 0);
	pin("0104_payroll_work_collection", "payroll stored inputs", durable.payrollStoredInputs);
	pin("0105_historical_work_proposals", "historical work proposals", durable.proposals);
	pin("0106_automatic_break_adjustment", "break adjustment intents", durable.breakAdjustments);

	pins.sort(
		(left, right) =>
			left.migration.localeCompare(right.migration) || left.subject.localeCompare(right.subject),
	);
	return { migration: pins.at(-1)?.migration ?? null, pins };
}

const VERDICT_ORDER: readonly RollbackVerdict[] = ["ready", "hold", "blocked"];

export function assessRollbackReadiness(snapshot: RollbackSnapshot): RollbackReadiness {
	const sections = {
		append: assessAppend(snapshot),
		cards: assessCards(snapshot),
		escalation: assessEscalation(snapshot),
		durable: assessDurable(snapshot),
	};
	const verdict = Object.values(sections).reduce<RollbackVerdict>(
		(worst, { verdict: next }) =>
			VERDICT_ORDER.indexOf(next) > VERDICT_ORDER.indexOf(worst) ? next : worst,
		"ready",
	);
	return {
		organizationId: snapshot.organizationId,
		verdict,
		...sections,
		schemaFloor: assessSchemaFloor(snapshot),
	};
}
