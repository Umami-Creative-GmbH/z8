import type {
	ApprovalDeliveryEffect,
	ApprovalDeliveryProvider,
} from "@/db/schema/approval-delivery";
import type {
	ApprovalPresentationMode,
	ApprovalPresentationProvider,
	approvalInvocation,
} from "@/db/schema/approval-evidence";
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
	| "legacy_transfers_pending"
	| "canonical_transfers_pending"
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

export type ApprovalInvocationScheme = (typeof approvalInvocation.$inferSelect)["scheme"];

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
		deliveryControls: Array<{
			workflowType: string;
			provider: ApprovalDeliveryProvider;
			/** The kind's stored rollout mode; null without a rollout row. */
			lifecycleMode: string | null;
		}>;
		presentationControls: Array<{
			workflowType: string;
			provider: ApprovalPresentationProvider;
			mode: ApprovalPresentationMode;
		}>;
		/**
		 * Unfinished delivery work: pending, processing, or awaiting repair, exhausted
		 * or failed (still retryable). Older planners also cancel the retryable states.
		 */
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
		/** Legacy replacement and retirement work and `transferred` intents (#408). */
		legacyReplacementRows: number;
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
	actionable: Array<{ workflowType: string; provider: ApprovalPresentationProvider }>;
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

/**
 * Committed rows that need the schema from `migration` on. `release` pins also
 * need code from that migration on: older code cannot replay them (receipts),
 * mishandles them (cycle-keyed delivery), or never knew them (newer values).
 * `schema` pins are rows older code ignores safely.
 */
export interface RollbackPin {
	migration: string;
	subject: string;
	rows: number;
	limits: "schema" | "release";
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
	 * `schema`: the newest pinned migration; never narrow or drop the schema
	 * below it. `release`: the newest `release` pin; a code rollback target older
	 * than it cannot replay or mishandles committed rows. Null when nothing pins.
	 */
	floor: { schema: string | null; release: string | null; pins: RollbackPin[] };
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
	{ provider: ApprovalDeliveryProvider; migration: string }
> = {
	telegram_callback_query: { provider: "telegram", migration: "0081_approval_invocation" },
	teams_adaptive_card_action: { provider: "teams", migration: "0091_teams_approval_actions" },
	discord_interaction: { provider: "discord", migration: "0094_discord_approval_delivery" },
};

/**
 * A value this release does not know was committed by a newer release. It sorts
 * after every numbered migration, so it becomes the floor: no older target fits.
 */
const UNKNOWN_MIGRATION = "unknown (newer than this release)";

function migrationOf(migrations: Readonly<Record<string, string>>, value: string): string {
	return Object.hasOwn(migrations, value) ? migrations[value] : UNKNOWN_MIGRATION;
}

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

/**
 * Whether deleting the control leaves the combination without any card. Time
 * kinds (#325) and legacy-authority absences (#384) fall back to the existing
 * notification path; canonical absence submissions and expenses never used it.
 */
function pauseLeavesNoCard(control: RollbackSnapshot["cards"]["deliveryControls"][number]) {
	if (control.workflowType === "travel_expense") return true;
	return (
		control.workflowType === "absence" &&
		(control.lifecycleMode === "canonical" || control.lifecycleMode === "complete")
	);
}

function assessCards({ cards }: RollbackSnapshot): RollbackCardReadiness {
	const actionable = cards.presentationControls
		.filter((control) => control.mode === "actionable")
		.map(({ workflowType, provider }) => ({ workflowType, provider }));
	// Older workers only claim work of providers that still have a control, so
	// deleting the controls is the documented remedy for both work findings.
	const controlled = new Set(cards.deliveryControls.map((control) => control.provider));
	const unfinished = (
		effects: readonly ApprovalDeliveryEffect[],
		provider: (value: ApprovalDeliveryProvider) => boolean,
	) => {
		const wanted = new Set(effects);
		return cards.openWork
			.filter(
				(work) =>
					wanted.has(work.effect) && controlled.has(work.provider) && provider(work.provider),
			)
			.reduce((total, work) => total + work.count, 0);
	};
	const findings: RollbackFinding[] = [];
	counted(
		findings,
		"delivery_pause_gap",
		"hold",
		cards.deliveryControls.filter(pauseLeavesNoCard).length,
	);
	// Set `review_only` first so older binaries show review notices instead of failures.
	counted(findings, "presentation_actionable", "hold", actionable.length);
	// A pre-#300 worker cancels replacement cards as `purged`.
	counted(
		findings,
		"replacement_work_pending",
		"blocker",
		unfinished(["replacement"], () => true),
	);
	// An older worker without the provider's adapter exhausts it; Telegram has one since #291.
	counted(
		findings,
		"delivery_work_pending",
		"hold",
		unfinished(["initial", "refresh"], (provider) => provider !== "telegram"),
	);
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
	const pending = (authorityMode: "canonical" | "legacy") =>
		escalation.pendingTransferred
			.filter((group) => group.authorityMode === authorityMode)
			.reduce((total, group) => total + group.count, 0);
	// Pre-#439 legacy time owners reject the transfer lineage: the replacement
	// could no longer decide. Let the replacements decide these first.
	counted(findings, "legacy_transfers_pending", "blocker", pending("legacy"));
	// Pre-#326 owners lack the revocation checks: a former holder could decide
	// again through eligible-manager fallback. Decide first, or accept that exposure.
	counted(findings, "canonical_transfers_pending", "hold", pending("canonical"));
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

function assessFloor(snapshot: RollbackSnapshot): RollbackReadiness["floor"] {
	const pins: RollbackPin[] = [];
	const pin = (
		migration: string,
		subject: string,
		rows: number,
		limits: RollbackPin["limits"] = "schema",
	) => {
		if (rows <= 0) return;
		// A value this release does not know always limits the release too.
		pins.push({
			migration,
			subject,
			rows,
			limits: migration === UNKNOWN_MIGRATION ? "release" : limits,
		});
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
		pin(migrationOf(RECEIPT_KIND_MIGRATIONS, kind), `receipt kind ${kind}`, rows ?? 0, "release");
	}
	for (const [writer, rows] of Object.entries(receipts.writers)) {
		pin(
			migrationOf(RECEIPT_WRITER_MIGRATIONS, writer),
			`receipt writer ${writer}`,
			rows ?? 0,
			"release",
		);
	}
	for (const [provider, rows] of Object.entries(cards.messages)) {
		pin(migrationOf(PROVIDER_MIGRATIONS, provider), `${provider} delivery messages`, rows ?? 0);
	}
	for (const [scheme, rows] of Object.entries(cards.invocations)) {
		const known = INVOCATION_SCHEMES[scheme as ApprovalInvocationScheme];
		pin(
			known?.migration ?? UNKNOWN_MIGRATION,
			`${known?.provider ?? scheme} invocations`,
			rows ?? 0,
		);
	}
	pin("0093_legacy_expense_presentation", "legacy card lifecycles", cards.legacyLifecycleRows);
	pin("0096_escalation_replacement_delivery", "replacement delivery work", cards.replacementRows);
	// Binaries below #384 plan cycle rows source-wide.
	pin(
		"0108_legacy_absence_presentation",
		"cycle-keyed legacy delivery",
		cards.cycleRows,
		"release",
	);
	// Binaries below #408 plan initial cards for transferred legacy requests and
	// leave former holders' cards actionable-looking; the schema holds its intents.
	pin(
		"0109_legacy_escalation_replacement_delivery",
		"legacy replacement delivery",
		cards.legacyReplacementRows,
		"release",
	);
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
	return {
		schema: pins.at(-1)?.migration ?? null,
		release: pins.filter((entry) => entry.limits === "release").at(-1)?.migration ?? null,
		pins,
	};
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
		floor: assessFloor(snapshot),
	};
}
