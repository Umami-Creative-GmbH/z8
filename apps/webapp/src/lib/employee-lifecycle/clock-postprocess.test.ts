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
			clockOutEntryId: "entry-1",
			durationMinutes: 120,
			periodStartedAt: "2026-09-14T20:00:00.000Z",
			timezone: "Europe/Berlin",
			createdBy: "admin-1",
			surchargeSnapshot: snapshot,
			...payload,
		},
		claimToken: "claim-1",
		attemptCount: 1,
	};
}

function effects() {
	return {
		enforceBreaks: vi.fn().mockResolvedValue({ affectedWorkPeriodIds: ["work-1", "work-2"] }),
		reconcileSurcharges: vi.fn().mockResolvedValue(undefined),
		markWorkBalanceDirty: vi.fn().mockResolvedValue(undefined),
	};
}

describe("clock postprocess handler", () => {
	it("runs breaks, then surcharges for the affected periods, then marks work balance", async () => {
		const deps = effects();
		const recordProgress = vi.fn().mockResolvedValue(undefined);

		await createClockPostprocessHandler(deps)(claim({}), { recordProgress });

		expect(deps.enforceBreaks).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			workPeriodId: "work-1",
			sessionDurationMinutes: 120,
			timezone: "Europe/Berlin",
			createdBy: "admin-1",
		});
		expect(deps.reconcileSurcharges).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			affectedWorkPeriodIds: ["work-1", "work-2"],
			snapshot,
		});
		expect(deps.markWorkBalanceDirty).toHaveBeenCalledWith({
			organizationId: "org-1",
			employeeId: "employee-1",
			dirtyFromDate: "2026-09-14",
		});
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

	it("skips surcharges when no snapshot was captured", async () => {
		const deps = effects();

		await createClockPostprocessHandler(deps)(claim({ surchargeSnapshot: null }), {
			recordProgress: vi.fn(),
		});

		expect(deps.reconcileSurcharges).not.toHaveBeenCalled();
		expect(deps.markWorkBalanceDirty).toHaveBeenCalled();
	});
});
