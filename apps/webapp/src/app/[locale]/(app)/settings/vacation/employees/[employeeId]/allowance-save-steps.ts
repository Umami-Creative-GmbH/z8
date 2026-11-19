/**
 * Saving an employee's vacation allowance runs up to three server actions in order: the policy
 * assignment, the custom allowance, then a manual adjustment. They are separate writes, so a
 * failure can leave the earlier ones saved. This sequencer records what each step saved, stops at
 * the first failure, and on the next attempt skips a step that already saved the same values, so
 * a retry runs only the failed and remaining steps (an adjustment is never recorded twice).
 */

export type AllowanceSaveStep = "policy" | "allowance" | "adjustment";

export type AllowanceSaveStepResult = { success: true } | { success: false; error?: string };

export interface AllowanceSaveStepPlan {
	step: AllowanceSaveStep;
	/** What the step writes; a step already saved with the same signature is skipped. */
	signature: string;
	run: () => Promise<AllowanceSaveStepResult>;
}

export type AllowanceSaveOutcome =
	| { status: "complete"; saved: AllowanceSaveStep[] }
	| {
			status: "failed";
			/** Steps saved since the last complete save, this attempt or an earlier one. */
			saved: AllowanceSaveStep[];
			failed: { step: AllowanceSaveStep; error?: string };
			/** Needed steps after the failed one, not attempted. */
			pending: AllowanceSaveStep[];
	  };

/** The signatures of the steps saved since the last complete save. */
export type SavedAllowanceSteps = Map<AllowanceSaveStep, string>;

export async function runAllowanceSaveSteps(
	plans: AllowanceSaveStepPlan[],
	savedSteps: SavedAllowanceSteps,
): Promise<AllowanceSaveOutcome> {
	// A step saved earlier counts as saved unless the form now asks it to write something else.
	const currentlySaved = () =>
		[...savedSteps.entries()].flatMap(([step, signature]) => {
			const plan = plans.find((candidate) => candidate.step === step);
			return !plan || plan.signature === signature ? [step] : [];
		});

	for (const [index, plan] of plans.entries()) {
		if (savedSteps.get(plan.step) === plan.signature) continue;

		let result: AllowanceSaveStepResult;
		try {
			result = await plan.run();
		} catch {
			result = { success: false };
		}

		if (!result.success) {
			return {
				status: "failed",
				saved: currentlySaved(),
				failed: { step: plan.step, error: result.error || undefined },
				pending: plans
					.slice(index + 1)
					.filter((next) => savedSteps.get(next.step) !== next.signature)
					.map((next) => next.step),
			};
		}
		savedSteps.set(plan.step, plan.signature);
	}

	return { status: "complete", saved: currentlySaved() };
}
