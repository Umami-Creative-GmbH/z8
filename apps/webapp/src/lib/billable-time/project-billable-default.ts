/**
 * A project's billable default (#900): whether new work on it starts as billable
 * work. Only a project with a customer can have it on, so removing the customer
 * also switches it off. Changing it never changes existing work: writers read it
 * only when they record new work or move work to the project.
 *
 * Per ADR 0001 its writer takes no organization configuration guard.
 */

export type ProjectBillableDefaultDecision =
	| { ok: true; billableDefault: boolean }
	| { ok: false; reason: "customer_required" };

/**
 * The billable default a project create or update stores.
 *
 * `requested` is the submitted value (undefined keeps `current`); `customerId` is
 * the customer the project has after the same change.
 */
export function decideProjectBillableDefault(input: {
	requested: boolean | undefined;
	current: boolean;
	customerId: string | null;
}): ProjectBillableDefaultDecision {
	if (input.requested === true && input.customerId === null) {
		return { ok: false, reason: "customer_required" };
	}
	if (input.customerId === null) return { ok: true, billableDefault: false };
	return { ok: true, billableDefault: input.requested ?? input.current };
}
