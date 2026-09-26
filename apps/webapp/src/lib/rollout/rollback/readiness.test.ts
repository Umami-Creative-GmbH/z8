import { describe, expect, it } from "vitest";
import { assessRollbackReadiness, type RollbackSnapshot } from "./readiness";

/** An organization that never adopted anything: nothing constrains a rollback. */
function untouched(overrides: Partial<RollbackSnapshot> = {}): RollbackSnapshot {
	return {
		organizationId: "org-rollback",
		append: {
			mode: "inactive",
			activatedAt: null,
			positions: { empty_history: 0, verified_lineage: 0, authorized_continuation: 0 },
		},
		receipts: { kinds: {}, writers: {} },
		cards: {
			deliveryControls: [],
			presentationControls: [],
			openWork: [],
			messages: {},
			invocations: {},
			legacyLifecycleRows: 0,
			cycleRows: 0,
			replacementRows: 0,
		},
		escalation: { owner: null, automationPaused: false, pendingTransferred: [] },
		durable: {
			rebuildIntents: { organization: 0, user: 0 },
			breakAdjustments: 0,
			payrollJobsInFlight: 0,
			payrollStoredInputs: 0,
			payrollControl: false,
			heldImportRows: 0,
			proposals: 0,
			repairControl: false,
		},
		...overrides,
	};
}

const ADOPTED_APPEND: RollbackSnapshot["append"] = {
	mode: "active",
	activatedAt: "2026-09-20T06:00:00.000Z",
	positions: { empty_history: 2, verified_lineage: 3, authorized_continuation: 0 },
};

describe("assessRollbackReadiness", () => {
	it("reports an organization that never adopted anything as ready with no schema floor", () => {
		const report = assessRollbackReadiness(untouched());

		expect(report.verdict).toBe("ready");
		for (const section of [report.append, report.cards, report.escalation, report.durable]) {
			expect(section).toMatchObject({ verdict: "ready", findings: [] });
		}
		expect(report.schemaFloor).toEqual({ migration: null, pins: [] });
	});

	it("blocks an adopted organization: append admission has no compatible pause", () => {
		const report = assessRollbackReadiness(untouched({ append: ADOPTED_APPEND }));

		expect(report.append).toMatchObject({
			mode: "active",
			activatedAt: "2026-09-20T06:00:00.000Z",
			positions: { total: 5, empty_history: 2, verified_lineage: 3, authorized_continuation: 0 },
			verdict: "blocked",
			findings: [{ code: "append_pause_unavailable", severity: "blocker" }],
		});
		expect(report.verdict).toBe("blocked");
		expect(report.schemaFloor.pins).toEqual([
			{ migration: "0079_time_entry_append_position", subject: "append positions", rows: 5 },
		]);
	});

	it("holds continuation positions, which an older release must keep and never drop", () => {
		const report = assessRollbackReadiness(
			untouched({
				append: {
					...ADOPTED_APPEND,
					positions: { empty_history: 0, verified_lineage: 1, authorized_continuation: 2 },
				},
			}),
		);

		expect(report.append.findings).toEqual([
			{ code: "append_pause_unavailable", severity: "blocker" },
			{ code: "continuation_positions", severity: "hold", count: 2 },
		]);
		expect(report.schemaFloor.pins).toContainEqual({
			migration: "0105_historical_work_proposals",
			subject: "authorized continuation positions",
			rows: 2,
		});
	});

	it("blocks an organization already returned to inactive over adopted positions", () => {
		const report = assessRollbackReadiness(
			untouched({ append: { ...ADOPTED_APPEND, mode: "inactive", activatedAt: null } }),
		);

		// Legacy head selection writes again against the kept positions.
		expect(report.append.findings).toEqual([
			{ code: "adopted_history_unfenced", severity: "blocker", count: 5 },
		]);
		expect(report.verdict).toBe("blocked");
	});

	it("holds every card pause that is not neutral and blocks pending replacement delivery", () => {
		const report = assessRollbackReadiness(
			untouched({
				cards: {
					deliveryControls: [
						{ workflowType: "absence", provider: "telegram" },
						{ workflowType: "absence", provider: "slack" },
					],
					presentationControls: [
						{ workflowType: "absence", provider: "telegram", mode: "actionable" },
						{ workflowType: "absence", provider: "slack", mode: "review_only" },
					],
					openWork: [
						{ provider: "telegram", effect: "replacement", count: 1 },
						{ provider: "slack", effect: "initial", count: 2 },
						{ provider: "telegram", effect: "refresh", count: 1 },
					],
					messages: { telegram: 4, slack: 2 },
					invocations: { telegram_callback_query: 3 },
					legacyLifecycleRows: 0,
					cycleRows: 0,
					replacementRows: 1,
				},
			}),
		);

		expect(report.cards).toMatchObject({
			deliveryControls: [
				{ workflowType: "absence", provider: "telegram" },
				{ workflowType: "absence", provider: "slack" },
			],
			actionable: [{ workflowType: "absence", provider: "telegram" }],
			verdict: "blocked",
			findings: [
				// Canonical submissions send no card at all once a control is deleted.
				{ code: "delivery_pause_gap", severity: "hold", count: 2 },
				{ code: "presentation_actionable", severity: "hold", count: 1 },
				// A pre-#300 worker cancels replacement cards as purged.
				{ code: "replacement_work_pending", severity: "blocker", count: 1 },
				{ code: "delivery_work_pending", severity: "hold", count: 3 },
			],
		});
		expect(report.schemaFloor.pins).toEqual([
			{ migration: "0081_approval_invocation", subject: "telegram invocations", rows: 3 },
			{ migration: "0086_approval_delivery", subject: "telegram delivery messages", rows: 4 },
			{ migration: "0090_approval_delivery_slack", subject: "slack delivery messages", rows: 2 },
			{
				migration: "0096_escalation_replacement_delivery",
				subject: "replacement delivery work",
				rows: 1,
			},
		]);
		expect(report.schemaFloor.migration).toBe("0096_escalation_replacement_delivery");
	});

	it("pins each provider's remote identities and the legacy card lifecycles", () => {
		const report = assessRollbackReadiness(
			untouched({
				cards: {
					...untouched().cards,
					messages: { teams: 1, discord: 1 },
					invocations: { teams_adaptive_card_action: 1, discord_interaction: 2 },
					legacyLifecycleRows: 3,
					cycleRows: 2,
				},
			}),
		);

		expect(report.schemaFloor).toEqual({
			migration: "0108_legacy_absence_presentation",
			pins: [
				{ migration: "0091_teams_approval_actions", subject: "teams delivery messages", rows: 1 },
				{ migration: "0091_teams_approval_actions", subject: "teams invocations", rows: 1 },
				{
					migration: "0093_legacy_expense_presentation",
					subject: "legacy card lifecycles",
					rows: 3,
				},
				{
					migration: "0094_discord_approval_delivery",
					subject: "discord delivery messages",
					rows: 1,
				},
				{ migration: "0094_discord_approval_delivery", subject: "discord invocations", rows: 2 },
				{
					migration: "0108_legacy_absence_presentation",
					subject: "cycle-keyed legacy delivery",
					rows: 2,
				},
			],
		});
		// Pins constrain the rollback target; they are not findings.
		expect(report.verdict).toBe("ready");
	});

	it("holds running escalation automation and blocks transferred approvals still pending", () => {
		const running = assessRollbackReadiness(
			untouched({
				escalation: {
					owner: "escalation",
					automationPaused: false,
					pendingTransferred: [
						{ authorityMode: "legacy", workflowType: "manual_time_submission", count: 2 },
						{ authorityMode: "canonical", workflowType: "travel_expense", count: 1 },
					],
				},
			}),
		);

		expect(running.escalation).toMatchObject({
			owner: "escalation",
			automationPaused: false,
			verdict: "blocked",
			findings: [
				{ code: "escalation_automation_running", severity: "hold" },
				{ code: "transferred_approvals_pending", severity: "blocker", count: 3 },
			],
		});

		const paused = assessRollbackReadiness(
			untouched({
				escalation: { owner: "escalation", automationPaused: true, pendingTransferred: [] },
			}),
		);
		expect(paused.escalation).toMatchObject({ verdict: "ready", findings: [] });
		// Legacy escalation ownership has no automation to pause.
		const legacy = assessRollbackReadiness(
			untouched({
				escalation: { owner: "legacy", automationPaused: false, pendingTransferred: [] },
			}),
		);
		expect(legacy.escalation.findings).toEqual([]);
	});

	it("blocks durable work an older release would ignore and holds work it leaves alone", () => {
		const report = assessRollbackReadiness(
			untouched({
				durable: {
					rebuildIntents: { organization: 1, user: 2 },
					breakAdjustments: 4,
					payrollJobsInFlight: 1,
					payrollStoredInputs: 5,
					payrollControl: true,
					heldImportRows: 6,
					proposals: 1,
					repairControl: true,
				},
			}),
		);

		expect(report.durable).toMatchObject({
			verdict: "blocked",
			findings: [
				{ code: "rebuild_intents_pending", severity: "blocker", count: 3 },
				{ code: "payroll_jobs_in_flight", severity: "blocker", count: 1 },
				{ code: "break_adjustments_pending", severity: "hold", count: 4 },
				{ code: "import_rows_held", severity: "hold", count: 6 },
			],
		});
		expect(report.schemaFloor).toEqual({
			migration: "0106_automatic_break_adjustment",
			pins: [
				{
					migration: "0099_work_balance_rebuild_intent",
					subject: "organization rebuild intents",
					rows: 1,
				},
				{
					migration: "0101_user_timezone_rebuild_intent",
					subject: "user rebuild intents",
					rows: 2,
				},
				{ migration: "0102_historical_gap_repair", subject: "historical repair control", rows: 1 },
				{
					migration: "0104_payroll_work_collection",
					subject: "payroll collection control",
					rows: 1,
				},
				{ migration: "0104_payroll_work_collection", subject: "payroll stored inputs", rows: 5 },
				{
					migration: "0105_historical_work_proposals",
					subject: "historical work proposals",
					rows: 1,
				},
				{
					migration: "0106_automatic_break_adjustment",
					subject: "break adjustment intents",
					rows: 4,
				},
			],
		});
	});

	it("pins every receipt kind and writer to the migration that admitted it", () => {
		const report = assessRollbackReadiness(
			untouched({
				receipts: {
					kinds: { close_active_work: 4, close_resume_work: 1, start_live_work: 0 },
					writers: { web_clock_out: 3, direct_http: 1, manager_on_behalf: 1 },
				},
			}),
		);

		// Committed receipts keep replaying only under a release that knows them.
		expect(report.schemaFloor).toEqual({
			migration: "0097_close_resume_work",
			pins: [
				{
					migration: "0083_completed_work_operation",
					subject: "receipt kind close_active_work",
					rows: 4,
				},
				{
					migration: "0083_completed_work_operation",
					subject: "receipt writer web_clock_out",
					rows: 3,
				},
				{ migration: "0084_direct_clock_commands", subject: "receipt writer direct_http", rows: 1 },
				{
					migration: "0092_on_behalf_clock_out_writer",
					subject: "receipt writer manager_on_behalf",
					rows: 1,
				},
				{ migration: "0097_close_resume_work", subject: "receipt kind close_resume_work", rows: 1 },
			],
		});
	});

	it("takes the worst section verdict", () => {
		const report = assessRollbackReadiness(
			untouched({
				escalation: { owner: "escalation", automationPaused: false, pendingTransferred: [] },
			}),
		);
		expect(report.verdict).toBe("hold");
		expect(
			assessRollbackReadiness(
				untouched({
					escalation: { owner: "escalation", automationPaused: false, pendingTransferred: [] },
					durable: { ...untouched().durable, payrollJobsInFlight: 1 },
				}),
			).verdict,
		).toBe("blocked");
	});
});
