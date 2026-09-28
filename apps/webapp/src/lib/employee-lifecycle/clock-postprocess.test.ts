import { describe, expect, it, vi } from "vitest";
import { createClockPostprocessHandler } from "./clock-postprocess";
import type { DepartureTaskClaim } from "./outbox";

const snapshot = { version: 1, evaluatedAt: "2026-09-14T22:00:00Z", resolution: { kind: "none" } };

function claim(payload: Record<string, unknown>): DepartureTaskClaim {
	return {
		id: "task-1",
		organizationId: "org-1",
		employeeId: "employee-1",
		employmentPeriodId: "period-1",
		departureId: "departure-1",
		kind: "clock_postprocess",
		payload: {
			workPeriodId: "work-1",
			durationMinutes: 120,
			periodStartedAt: "2026-09-14T20:00:00.000Z",
			timezone: "Europe/Berlin",
			createdBy: "admin-1",
			surchargeSnapshot: snapshot,
			projectId: "project-1",
			balanceRefreshCommitted: false,
			...payload,
		},
		claimToken: "claim-1",
		attemptCount: 1,
	};
}

/** The shared clock-out follow-up effects a departure runs (#476 decision 14), recording their calls. */
function effects() {
	const calls: string[] = [];
	const effect = <T>(name: string, value: T) =>
		vi.fn(async () => {
			calls.push(name);
			return value;
		});
	return {
		calls,
		enforceBreaks: effect("breaks", {
			wasAdjusted: false,
			affectedWorkPeriodIds: ["work-1", "work-2"],
		}),
		reconcileSurcharges: effect("surcharges", undefined),
		markBalanceDirty: effect("balance", undefined),
		checkProjectBudget: effect("budget", undefined),
	};
}

describe("clock postprocess handler", () => {
	it("runs the shared follow-ups in the after-commit order, recording each step", async () => {
		const deps = effects();
		const recordProgress = vi.fn().mockResolvedValue(undefined);

		await createClockPostprocessHandler(deps)(claim({}), { recordProgress });

		expect(deps.calls).toEqual(["breaks", "surcharges", "balance", "budget"]);
		expect(deps.enforceBreaks).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			workPeriodId: "work-1",
			durationMinutes: 120,
			timezone: "Europe/Berlin",
			createdBy: "admin-1",
		});
		expect(deps.reconcileSurcharges).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			affectedWorkPeriodIds: ["work-1", "work-2"],
			snapshot,
		});
		expect(deps.markBalanceDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			dirtyFromDate: "2026-09-14",
		});
		expect(deps.checkProjectBudget).toHaveBeenCalledWith("project-1", "org-1");
		expect(recordProgress.mock.calls).toEqual([
			[{ breaksEnforced: true, affectedWorkPeriodIds: ["work-1", "work-2"] }],
			[{ surchargesReconciled: true }],
		]);
	});

	it("resumes after partial progress without replaying completed effects", async () => {
		const deps = effects();

		await createClockPostprocessHandler(deps)(
			claim({ breaksEnforced: true, affectedWorkPeriodIds: ["work-1"] }),
			{ recordProgress: vi.fn() },
		);

		expect(deps.enforceBreaks).not.toHaveBeenCalled();
		expect(deps.reconcileSurcharges).toHaveBeenCalledWith(
			expect.objectContaining({ affectedWorkPeriodIds: ["work-1"] }),
		);
	});

	it("propagates a failed step so the task retries from there", async () => {
		const deps = effects();
		deps.enforceBreaks.mockRejectedValueOnce(new Error("breaks unavailable"));
		const recordProgress = vi.fn().mockResolvedValue(undefined);

		await expect(
			createClockPostprocessHandler(deps)(claim({}), { recordProgress }),
		).rejects.toThrow("breaks unavailable");

		expect(recordProgress).not.toHaveBeenCalled();
		expect(deps.reconcileSurcharges).not.toHaveBeenCalled();
	});

	it("skips surcharges without a snapshot, and the budget without a project", async () => {
		const deps = effects();

		await createClockPostprocessHandler(deps)(claim({ surchargeSnapshot: null, projectId: null }), {
			recordProgress: vi.fn(),
		});

		expect(deps.reconcileSurcharges).not.toHaveBeenCalled();
		expect(deps.checkProjectBudget).not.toHaveBeenCalled();
		expect(deps.markBalanceDirty).toHaveBeenCalled();
	});

	it("leaves the balance to the refresh intent the append writer committed", async () => {
		const deps = effects();

		await createClockPostprocessHandler(deps)(claim({ balanceRefreshCommitted: true }), {
			recordProgress: vi.fn(),
		});

		expect(deps.markBalanceDirty).not.toHaveBeenCalled();
	});

	it("runs tasks staged before #485, which carry no project or balance evidence", async () => {
		const deps = effects();
		const staged = claim({ clockOutEntryId: "entry-1" });
		delete staged.payload.projectId;
		delete staged.payload.balanceRefreshCommitted;

		await createClockPostprocessHandler(deps)(staged, { recordProgress: vi.fn() });

		expect(deps.markBalanceDirty).toHaveBeenCalled();
		expect(deps.checkProjectBudget).not.toHaveBeenCalled();
	});
});
