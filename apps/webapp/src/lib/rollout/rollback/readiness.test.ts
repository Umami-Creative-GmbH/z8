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
	activatedAt: "2026-09-20T06:00:00Z",
	positions: { empty_history: 2, verified_lineage: 3, authorized_continuation: 0 },
};

describe("assessRollbackReadiness", () => {
	it("reports an organization that never adopted anything as ready with no floor", () => {
		const report = assessRollbackReadiness(untouched());

		expect(report.verdict).toBe("ready");
		for (const section of [report.append, report.cards, report.escalation, report.durable]) {
			expect(section).toMatchObject({ verdict: "ready", findings: [] });
		}
		expect(report.floor).toEqual({ schema: null, release: null, pins: [] });
	});

	it("blocks an adopted organization: append admission has no compatible pause", () => {
		const report = assessRollbackReadiness(untouched({ append: ADOPTED_APPEND }));

		expect(report.append).toMatchObject({
			mode: "active",
			activatedAt: "2026-09-20T06:00:00Z",
			positions: { total: 5, empty_history: 2, verified_lineage: 3, authorized_continuation: 0 },
			verdict: "blocked",
			findings: [{ code: "append_pause_unavailable", severity: "blocker" }],
		});
		expect(report.verdict).toBe("blocked");
		// Older code ignores positions: they only limit the schema.
		expect(report.floor).toEqual({
			schema: "0079_time_entry_append_position",
			release: null,
			pins: [
				{
					migration: "0079_time_entry_append_position",
					subject: "append positions",
					rows: 5,
					limits: "schema",
				},
			],
		});
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
		expect(report.floor.pins).toContainEqual({
			migration: "0105_historical_work_proposals",
			subject: "authorized continuation positions",
			rows: 2,
			limits: "schema",
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

	it("holds pauses that leave no card, and blocks replacement work a control still exposes", () => {
		const report = assessRollbackReadiness(
			untouched({
				cards: {
					deliveryControls: [
						{ workflowType: "absence", provider: "telegram", lifecycleMode: "canonical" },
						{ workflowType: "absence", provider: "slack", lifecycleMode: "canonical" },
						{ workflowType: "travel_expense", provider: "telegram", lifecycleMode: null },
						// Time kinds (#325) and legacy absences (#384) fall back to the existing path.
						{ workflowType: "policy_clock_out", provider: "telegram", lifecycleMode: "canonical" },
						{ workflowType: "absence", provider: "discord", lifecycleMode: "legacy" },
					],
					presentationControls: [
						{ workflowType: "absence", provider: "telegram", mode: "actionable" },
						{ workflowType: "absence", provider: "slack", mode: "review_only" },
					],
					openWork: [
						{ provider: "telegram", effect: "replacement", count: 1 },
						{ provider: "slack", effect: "initial", count: 2 },
						// Telegram has had an adapter since #291.
						{ provider: "telegram", effect: "refresh", count: 1 },
						// Without a Teams control an older worker never claims it.
						{ provider: "teams", effect: "initial", count: 4 },
						{ provider: "teams", effect: "replacement", count: 1 },
					],
					messages: { telegram: 4, slack: 2 },
					invocations: { telegram_callback_query: 3 },
					legacyLifecycleRows: 0,
					cycleRows: 0,
					replacementRows: 2,
				},
			}),
		);

		expect(report.cards).toMatchObject({
			actionable: [{ workflowType: "absence", provider: "telegram" }],
			verdict: "blocked",
			findings: [
				{ code: "delivery_pause_gap", severity: "hold", count: 3 },
				{ code: "presentation_actionable", severity: "hold", count: 1 },
				// A pre-#300 worker cancels replacement cards as purged.
				{ code: "replacement_work_pending", severity: "blocker", count: 1 },
				{ code: "delivery_work_pending", severity: "hold", count: 2 },
			],
		});
		expect(report.floor).toEqual({
			schema: "0096_escalation_replacement_delivery",
			release: null,
			pins: [
				{
					migration: "0081_approval_invocation",
					subject: "telegram invocations",
					rows: 3,
					limits: "schema",
				},
				{
					migration: "0086_approval_delivery",
					subject: "telegram delivery messages",
					rows: 4,
					limits: "schema",
				},
				{
					migration: "0090_approval_delivery_slack",
					subject: "slack delivery messages",
					rows: 2,
					limits: "schema",
				},
				{
					migration: "0096_escalation_replacement_delivery",
					subject: "replacement delivery work",
					rows: 2,
					limits: "schema",
				},
			],
		});
	});

	it("clears the work findings once the controls are deleted, as #294 and #300 prescribe", () => {
		const report = assessRollbackReadiness(
			untouched({
				cards: {
					...untouched().cards,
					openWork: [
						{ provider: "telegram", effect: "replacement", count: 1 },
						{ provider: "slack", effect: "initial", count: 2 },
					],
					replacementRows: 1,
				},
			}),
		);

		expect(report.cards).toMatchObject({ verdict: "ready", findings: [] });
	});

	it("pins each provider's remote identities, legacy lifecycles and cycle-keyed delivery", () => {
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

		expect(report.floor).toEqual({
			schema: "0108_legacy_absence_presentation",
			// Binaries below #384 plan cycle rows source-wide.
			release: "0108_legacy_absence_presentation",
			pins: [
				{
					migration: "0091_teams_approval_actions",
					subject: "teams delivery messages",
					rows: 1,
					limits: "schema",
				},
				{
					migration: "0091_teams_approval_actions",
					subject: "teams invocations",
					rows: 1,
					limits: "schema",
				},
				{
					migration: "0093_legacy_expense_presentation",
					subject: "legacy card lifecycles",
					rows: 3,
					limits: "schema",
				},
				{
					migration: "0094_discord_approval_delivery",
					subject: "discord delivery messages",
					rows: 1,
					limits: "schema",
				},
				{
					migration: "0094_discord_approval_delivery",
					subject: "discord invocations",
					rows: 2,
					limits: "schema",
				},
				{
					migration: "0108_legacy_absence_presentation",
					subject: "cycle-keyed legacy delivery",
					rows: 2,
					limits: "release",
				},
			],
		});
		// Pins constrain the rollback target; they are not findings.
		expect(report.verdict).toBe("ready");
	});

	it("blocks pending legacy transfers, holds canonical ones and running automation", () => {
		const running = assessRollbackReadiness(
			untouched({
				escalation: {
					owner: "escalation",
					automationPaused: false,
					pendingTransferred: [
						{ authorityMode: "canonical", workflowType: "travel_expense", count: 1 },
						{ authorityMode: "legacy", workflowType: "manual_time_submission", count: 2 },
						{ authorityMode: "legacy", workflowType: "time_correction", count: 1 },
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
				// Pre-#439 owners reject the transfer lineage: the replacement could not decide.
				{ code: "legacy_transfers_pending", severity: "blocker", count: 3 },
				// #326 allows accepting the fallback exposure explicitly.
				{ code: "canonical_transfers_pending", severity: "hold", count: 1 },
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
		// Earlier releases ignore every one of these rows (#311, #320, #322, #323, #305).
		expect(report.floor).toEqual({
			schema: "0106_automatic_break_adjustment",
			release: null,
			pins: [
				{
					migration: "0099_work_balance_rebuild_intent",
					subject: "organization rebuild intents",
					rows: 1,
					limits: "schema",
				},
				{
					migration: "0101_user_timezone_rebuild_intent",
					subject: "user rebuild intents",
					rows: 2,
					limits: "schema",
				},
				{
					migration: "0102_historical_gap_repair",
					subject: "historical repair control",
					rows: 1,
					limits: "schema",
				},
				{
					migration: "0104_payroll_work_collection",
					subject: "payroll collection control",
					rows: 1,
					limits: "schema",
				},
				{
					migration: "0104_payroll_work_collection",
					subject: "payroll stored inputs",
					rows: 5,
					limits: "schema",
				},
				{
					migration: "0105_historical_work_proposals",
					subject: "historical work proposals",
					rows: 1,
					limits: "schema",
				},
				{
					migration: "0106_automatic_break_adjustment",
					subject: "break adjustment intents",
					rows: 4,
					limits: "schema",
				},
			],
		});
	});

	it("pins every receipt kind and writer to the release that can replay it", () => {
		const report = assessRollbackReadiness(
			untouched({
				receipts: {
					kinds: { close_active_work: 4, close_resume_work: 1, start_live_work: 0 },
					writers: { web_clock_out: 3, direct_http: 1, manager_on_behalf: 1 },
				},
			}),
		);

		expect(report.floor).toEqual({
			schema: "0097_close_resume_work",
			release: "0097_close_resume_work",
			pins: [
				{
					migration: "0083_completed_work_operation",
					subject: "receipt kind close_active_work",
					rows: 4,
					limits: "release",
				},
				{
					migration: "0083_completed_work_operation",
					subject: "receipt writer web_clock_out",
					rows: 3,
					limits: "release",
				},
				{
					migration: "0084_direct_clock_commands",
					subject: "receipt writer direct_http",
					rows: 1,
					limits: "release",
				},
				{
					migration: "0092_on_behalf_clock_out_writer",
					subject: "receipt writer manager_on_behalf",
					rows: 1,
					limits: "release",
				},
				{
					migration: "0097_close_resume_work",
					subject: "receipt kind close_resume_work",
					rows: 1,
					limits: "release",
				},
			],
		});
	});

	it("floors on values a newer release committed instead of failing", () => {
		const report = assessRollbackReadiness(
			untouched({
				receipts: {
					kinds: { close_active_work: 1, future_kind: 2 } as RollbackSnapshot["receipts"]["kinds"],
					writers: {},
				},
				cards: {
					...untouched().cards,
					messages: { matrix: 1 } as RollbackSnapshot["cards"]["messages"],
				},
			}),
		);

		expect(report.floor.schema).toBe("unknown (newer than this release)");
		expect(report.floor.release).toBe("unknown (newer than this release)");
		expect(report.floor.pins).toContainEqual({
			migration: "unknown (newer than this release)",
			subject: "receipt kind future_kind",
			rows: 2,
			limits: "release",
		});
		expect(report.floor.pins).toContainEqual({
			migration: "unknown (newer than this release)",
			subject: "matrix delivery messages",
			rows: 1,
			limits: "release",
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
