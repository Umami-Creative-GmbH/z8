import { describe, expect, it, vi } from "vitest";
import { runAutoClockOutFollowUps } from "./follow-ups";
import { decision } from "./testing.test.fixture";

describe("durable automatic follow-ups", () => {
	it("resumes after the failed step without repeating completed compliance and breaks", async () => {
		const d = decision();
		const progress: Record<string, unknown> = {};
		const effects = {
			checkCompliance: vi.fn(async () => []),
			enforceBreaks: vi.fn(async () => ({
				wasAdjusted: false,
				affectedWorkPeriodIds: [d.workPeriodId],
			})),
			reconcileSurcharges: vi.fn(),
			markBalanceDirty: vi
				.fn()
				.mockRejectedValueOnce(new Error("offline"))
				.mockResolvedValue(undefined),
			checkProjectBudget: vi.fn(),
		};
		const closure = {
			...d,
			end: d.cutoff,
			durationMinutes: 720,
			actorUserId: d.provenanceUserId,
			projectId: "project",
			surchargeSnapshot: null,
			balanceRefreshCommitted: false,
		};
		const context = {
			recordProgress: async (patch: Record<string, unknown>) => {
				Object.assign(progress, patch);
			},
		};
		await expect(runAutoClockOutFollowUps(closure, progress, context, effects)).rejects.toThrow(
			"offline",
		);
		await runAutoClockOutFollowUps(closure, progress, context, effects);
		expect(effects.checkCompliance).toHaveBeenCalledTimes(1);
		expect(effects.enforceBreaks).toHaveBeenCalledTimes(1);
		expect(effects.markBalanceDirty).toHaveBeenCalledTimes(2);
		expect(effects.checkProjectBudget).toHaveBeenCalledTimes(1);
		await runAutoClockOutFollowUps(closure, progress, context, effects);
		expect(effects.checkProjectBudget).toHaveBeenCalledTimes(1);
	});
	it("honors the committed balance intent while retaining the break owner's idempotent reconciliation", async () => {
		const d = decision();
		const effects = {
			checkCompliance: vi.fn(async () => []),
			enforceBreaks: vi.fn(async () => ({
				wasAdjusted: false,
				affectedWorkPeriodIds: [d.workPeriodId],
			})),
			reconcileSurcharges: vi.fn(),
			markBalanceDirty: vi.fn(),
			checkProjectBudget: vi.fn(),
		};
		await runAutoClockOutFollowUps(
			{
				...d,
				end: d.cutoff,
				durationMinutes: 720,
				actorUserId: d.provenanceUserId,
				projectId: null,
				surchargeSnapshot: null,
				balanceRefreshCommitted: true,
			},
			{},
			{ recordProgress: async () => {} },
			effects,
		);
		expect(effects.markBalanceDirty).not.toHaveBeenCalled();
		expect(effects.enforceBreaks).toHaveBeenCalledTimes(1);
	});
});
