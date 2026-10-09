/**
 * Billable work (#900, spec #768): whether a work period is chargeable to its
 * project's customer. Billability is part of the work attribution and every
 * writer that records or changes a period's project decides it by this one rule:
 *
 * - An explicit request wins, but billable work needs a project with a customer.
 * - New work, or a changed project, takes the project's billable default.
 * - Otherwise the source's billability is preserved.
 *
 * Work without a project is never billable. The legacy period carries the flag in
 * `work_period.is_billable`, the canonical record on its project allocation.
 */
import { and, eq } from "drizzle-orm";
import type { db } from "@/db";
import { project } from "@/db/schema";
import { activeProjectCustomerIdSql } from "@/lib/billable-time/project-customer";

/** A request's explicit billability; absent (undefined) applies the rule. */
export type BillableRequest = boolean | undefined;

/** The billable facts of a project at write time. */
export type ProjectBillability = {
	projectId: string;
	/** The project's active customer; null without one or once it was deleted. */
	customerId: string | null;
	billableDefault: boolean;
};

export type BillableWorkRefusal = "no_project" | "no_customer";

/** A writer refused billable work without a project, or on a project without a customer. */
export class BillableWorkRefusedError extends Error {
	constructor(readonly reason: BillableWorkRefusal) {
		super(
			reason === "no_project"
				? "Work without a project cannot be billable"
				: "Work on a project without a customer cannot be billable",
		);
		this.name = "BillableWorkRefusedError";
	}
}

/** The billable default a project gives new work: only a project with a customer has one. */
export function projectBillableDefault(project: ProjectBillability | null): boolean {
	return project !== null && project.customerId !== null && project.billableDefault;
}

/**
 * The billability a writer records.
 *
 * `projectChosen` is true for new work and for a write that changes the project;
 * `current` is the source's billability (false for new work).
 */
export function resolveWorkBillability(input: {
	project: ProjectBillability | null;
	projectChosen: boolean;
	current: boolean;
	requested?: BillableRequest;
}): boolean {
	if (input.requested !== undefined) {
		if (input.requested) assertBillableAllowed(input.project);
		return input.requested;
	}
	if (input.project === null) return false;
	if (input.projectChosen) return projectBillableDefault(input.project);
	return input.current;
}

/** Refuses billable work without a project or on a project without a customer. */
export function assertBillableAllowed(project: ProjectBillability | null): void {
	if (project === null) throw new BillableWorkRefusedError("no_project");
	if (project.customerId === null) throw new BillableWorkRefusedError("no_customer");
}

/**
 * Whether the canonical record's allocations mirror the legacy period's project
 * and billability: exactly one whole project allocation carrying the period's
 * billability, or no project allocation for work without a project.
 */
export function projectAllocationAgrees(
	period: { projectId: string | null; isBillable: boolean },
	allocations: readonly {
		allocationKind: string;
		projectId: string | null;
		weightPercent: number;
		isBillable: boolean;
	}[],
): boolean {
	const projectAllocations = allocations.filter(
		({ allocationKind }) => allocationKind === "project",
	);
	if (!period.projectId) return projectAllocations.length === 0 && !period.isBillable;
	const [allocation] = projectAllocations;
	return (
		projectAllocations.length === 1 &&
		allocation?.projectId === period.projectId &&
		allocation.weightPercent === 100 &&
		allocation.isBillable === period.isBillable
	);
}

type ProjectReader = Pick<typeof db, "select">;

/**
 * The project's billable facts in its organization, or null without a project.
 * A deleted (inactive) customer counts as none (lib/billable-time/project-customer.ts).
 */
export async function readProjectBillability(
	reader: ProjectReader,
	organizationId: string,
	projectId: string | null,
): Promise<ProjectBillability | null> {
	if (projectId === null) return null;
	const [row] = await reader
		.select({ customerId: activeProjectCustomerIdSql(), billableDefault: project.billableDefault })
		.from(project)
		.where(and(eq(project.id, projectId), eq(project.organizationId, organizationId)))
		.limit(1);
	// A project of another organization never reaches a writer; treat it as none.
	if (!row) return null;
	return { projectId, customerId: row.customerId, billableDefault: row.billableDefault };
}

/**
 * Reads the resulting project only when the rule needs it: a preserved project
 * without an explicit request keeps the source's billability.
 */
export async function resolveWorkBillabilityInTransaction(
	reader: ProjectReader,
	organizationId: string,
	input: {
		projectId: string | null;
		projectChosen: boolean;
		current: boolean;
		requested?: BillableRequest;
	},
): Promise<boolean> {
	if (input.projectId === null) {
		return resolveWorkBillability({ ...input, project: null });
	}
	if (!input.projectChosen && input.requested === undefined) return input.current;
	const facts = await readProjectBillability(reader, organizationId, input.projectId);
	return resolveWorkBillability({ ...input, project: facts });
}
