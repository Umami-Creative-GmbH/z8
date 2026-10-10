/**
 * The billable toggle's state where work is recorded or its project changes
 * (#900). The form keeps only the user's explicit choice; everything else
 * follows the rule the server applies: the work keeps its billability while its
 * project stays, a chosen project prefills its billable default, and only a
 * project with a customer can make work billable. An untouched toggle sends
 * nothing, so the server applies the default under its own locks.
 */

/** A project's billable facts, as the project choices carry them. */
export type BillableProjectFacts = { hasCustomer: boolean; billableDefault: boolean };

export type BillableChoice = {
	visible: boolean;
	enabled: boolean;
	checked: boolean;
	/** What the request carries; undefined lets the server apply the rule. */
	request: boolean | undefined;
};

export function billableChoice(input: {
	/** The chosen project, or null without one. */
	project: BillableProjectFacts | null | undefined;
	/** The user's explicit choice; undefined while untouched. */
	explicit: boolean | undefined;
	/** The work's current billability while its project stays unchanged. */
	kept?: boolean;
}): BillableChoice {
	const { project, explicit, kept } = input;
	if (!project) return { visible: false, enabled: false, checked: false, request: undefined };
	if (!project.hasCustomer) {
		// Work on such a project is never made billable; work that already is can be switched off.
		if (!kept) return { visible: true, enabled: false, checked: false, request: undefined };
		return {
			visible: true,
			enabled: true,
			checked: explicit ?? true,
			request: explicit === false ? false : undefined,
		};
	}
	const prefill = kept ?? project.billableDefault;
	// Choosing the billability the work already has is no change.
	const request = kept !== undefined && explicit === kept ? undefined : explicit;
	return { visible: true, enabled: true, checked: explicit ?? prefill, request };
}
