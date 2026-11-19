import { describe, expect, it, vi } from "vitest";
import {
	type AllowanceSaveStepPlan,
	runAllowanceSaveSteps,
	type SavedAllowanceSteps,
} from "./allowance-save-steps";

function plans(overrides: Partial<Record<"policy" | "allowance" | "adjustment", () => unknown>> = {}) {
	const run = {
		policy: vi.fn(async () => ({ success: true as const })),
		allowance: vi.fn(async () => ({ success: true as const })),
		adjustment: vi.fn(async () => ({ success: true as const })),
	};
	for (const [step, implementation] of Object.entries(overrides)) {
		run[step as keyof typeof run].mockImplementation(implementation as never);
	}
	const list: AllowanceSaveStepPlan[] = [
		{ step: "policy", signature: "policy-2", run: run.policy },
		{ step: "allowance", signature: "[2026,\"30\",\"\"]", run: run.allowance },
		{ step: "adjustment", signature: "[2026,\"2\",\"Bonus\"]", run: run.adjustment },
	];
	return { list, run };
}

describe("runAllowanceSaveSteps", () => {
	it("runs every step in order and reports a complete save", async () => {
		const { list, run } = plans();
		const saved: SavedAllowanceSteps = new Map();

		const outcome = await runAllowanceSaveSteps(list, saved);

		expect(outcome).toEqual({ status: "complete", saved: ["policy", "allowance", "adjustment"] });
		expect(run.policy).toHaveBeenCalledTimes(1);
		expect(run.allowance).toHaveBeenCalledTimes(1);
		expect(run.adjustment).toHaveBeenCalledTimes(1);
	});

	it("stops at the first failure and lists what was saved, failed and not attempted", async () => {
		const { list, run } = plans({
			allowance: async () => ({ success: false, error: "Allowance is locked" }),
		});
		const saved: SavedAllowanceSteps = new Map();

		const outcome = await runAllowanceSaveSteps(list, saved);

		expect(outcome).toEqual({
			status: "failed",
			saved: ["policy"],
			failed: { step: "allowance", error: "Allowance is locked" },
			pending: ["adjustment"],
		});
		expect(run.adjustment).not.toHaveBeenCalled();
	});

	it("retries only the failed and remaining steps", async () => {
		let allowanceAttempts = 0;
		const { list, run } = plans({
			allowance: async () =>
				++allowanceAttempts === 1 ? { success: false } : { success: true },
		});
		const saved: SavedAllowanceSteps = new Map();

		await runAllowanceSaveSteps(list, saved);
		const outcome = await runAllowanceSaveSteps(list, saved);

		expect(outcome.status).toBe("complete");
		expect(run.policy).toHaveBeenCalledTimes(1);
		expect(run.allowance).toHaveBeenCalledTimes(2);
		expect(run.adjustment).toHaveBeenCalledTimes(1);
	});

	it("never records an adjustment twice after a later attempt", async () => {
		const { list, run } = plans();
		const saved: SavedAllowanceSteps = new Map([["adjustment", list[2].signature]]);

		await runAllowanceSaveSteps(list, saved);

		expect(run.adjustment).not.toHaveBeenCalled();
	});

	it("re-runs a saved step whose values changed since", async () => {
		const { list, run } = plans({
			adjustment: async () => ({ success: false }),
		});
		const saved: SavedAllowanceSteps = new Map([["policy", "policy-1"]]);

		const outcome = await runAllowanceSaveSteps(list, saved);

		expect(run.policy).toHaveBeenCalledTimes(1);
		expect(outcome).toMatchObject({ status: "failed", saved: ["policy", "allowance"] });
	});

	it("treats a thrown action as a failure without a server reason", async () => {
		const { list } = plans({
			policy: async () => {
				throw new Error("network");
			},
		});

		const outcome = await runAllowanceSaveSteps(list, new Map());

		expect(outcome).toEqual({
			status: "failed",
			saved: [],
			failed: { step: "policy", error: undefined },
			pending: ["allowance", "adjustment"],
		});
	});
});
