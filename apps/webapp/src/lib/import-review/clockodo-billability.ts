import type { StagedWorkBillability } from "./staged-work-billability";

/**
 * Clockodo's billable value on a time entry (#907): 0 not billable, 1 billable,
 * 2 already billed. 1 and 2 import as billable work; "already billed" is never
 * imported as invoiced work, because Z8 has no invoice draft for it.
 */
const BILLABLE = 1;
const ALREADY_BILLED = 2;

/** The existing Z8 project a Clockodo project is mapped to, with its customer. */
export interface MappedClockodoProject {
	projectId: string;
	customerId: string | null;
}

export interface ClockodoEntryBillability {
	/**
	 * What the committer records (#900); null commits the work without a project.
	 * A billable value is staged as a request: if the project lost its customer by
	 * commit time, the work imports as non-billable instead of being held.
	 */
	attribution: { projectId: string; billable: boolean; nonBillableWhenRefused?: true } | null;
	/** The review screen's explanation. */
	billability: StagedWorkBillability;
}

/**
 * The project and billability a Clockodo entry is staged with. The usual rule
 * applies: work without a project, or on a project without a customer, is never
 * billable, so such entries import as non-billable and say why.
 */
export function clockodoEntryBillability(input: {
	billable: unknown;
	clockodoProjectId: number | null | undefined;
	mappedProject: MappedClockodoProject | null;
}): ClockodoEntryBillability {
	const providerValue = typeof input.billable === "number" ? input.billable : null;
	const requested = providerValue === BILLABLE || providerValue === ALREADY_BILLED;
	const nonBillable = (note: StagedWorkBillability["note"]) => ({
		providerValue,
		billable: false,
		note: requested ? note : null,
	});

	if (input.clockodoProjectId == null) {
		return { attribution: null, billability: nonBillable("no_project") };
	}
	const project = input.mappedProject;
	if (!project) return { attribution: null, billability: nonBillable("unmapped_project") };
	if (project.customerId === null) {
		return {
			attribution: { projectId: project.projectId, billable: false },
			billability: nonBillable("no_customer"),
		};
	}
	return {
		attribution: requested
			? { projectId: project.projectId, billable: true, nonBillableWhenRefused: true }
			: { projectId: project.projectId, billable: false },
		billability: {
			providerValue,
			billable: requested,
			note: providerValue === ALREADY_BILLED ? "already_billed" : null,
		},
	};
}
