/**
 * Work attribution (Time Tracking glossary; ADR 0010): what a completed work
 * period is recorded against — its project with task and billable flag, its work
 * category, work location and vehicle use (ADR 0009). An internal seam of work
 * records: pure, no I/O, no server-only imports.
 *
 * The project, its task and the billable flag travel together, so a billable
 * flag or a task without a project cannot be represented. The work period stores
 * the attribution in its own columns; the canonical work record stores it in
 * `time_record_work` (the detail) and one whole project allocation.
 */
import { namedTaskIntent, taskIdFollowingProject } from "../task-attribution";
import {
	sameWorkVehicleUse,
	vehicleUseColumns,
	vehicleUseFromColumns,
	type WorkVehicleUse,
	type WorkVehicleUseColumns,
} from "../vehicle-use/work-vehicle-use";
import type { WorkLocationType } from "../work-location";

/** The project a work period is booked to, with its task and billability. */
export type WorkAttributionProject = {
	readonly projectId: string;
	readonly taskId: string | null;
	readonly billable: boolean;
};

/** One part of a work attribution; `differences` lists them in this order. */
export type WorkAttributionPart =
	| "project"
	| "task"
	| "billable"
	| "work_category"
	| "work_location"
	| "vehicle_use";

/** A work period's attribution columns. */
export type WorkPeriodAttributionColumns = WorkVehicleUseColumns & {
	projectId: string | null;
	taskId: string | null;
	isBillable: boolean;
	/** Missing task (#884, Projects ADR 0002): booked without the task its project required. */
	missingTask: boolean;
	workCategoryId: string | null;
	workLocationType: WorkLocationType | null;
};

/** The attribution columns of a canonical work record's detail (`time_record_work`). */
export type CanonicalWorkDetailColumns = WorkVehicleUseColumns & {
	workCategoryId: string | null;
	workLocationType: WorkLocationType | null;
};

/** A canonical allocation as stored (`time_record_allocation`). */
export type CanonicalAllocationShape = {
	allocationKind: "project" | "cost_center";
	projectId: string | null;
	taskId: string | null;
	costCenterId: string | null;
	weightPercent: number;
	isBillable: boolean;
	/** Missing task (#884); only on a project allocation without a task. */
	missingTask: boolean;
};

/** The weight of a work period's single project allocation. */
export const WHOLE_ALLOCATION_WEIGHT = 100;

/** The project allocation a work attribution writes. */
export type ProjectAllocation = CanonicalAllocationShape & {
	allocationKind: "project";
	projectId: string;
	costCenterId: null;
	weightPercent: typeof WHOLE_ALLOCATION_WEIGHT;
};

/**
 * A change of work attribution. Every key left out keeps that part; null clears it.
 */
export type WorkAttributionPatch = {
	/**
	 * The project to book. `billableDefault` is the default it gives new work
	 * (`projectBillableDefault` in work-billability.ts: only a project with an
	 * active customer has one); it applies only when the project changes and
	 * `billable` is left out.
	 */
	project?: { projectId: string; billableDefault: boolean } | null;
	/** A task of the resulting project. Left out, the task follows the project. */
	task?: string | null;
	/**
	 * Explicit billability; wins over the project's default. Whether the project
	 * has a customer to bill is checked by the writer, which reads the project.
	 */
	billable?: boolean;
	workCategoryId?: string | null;
	workLocationType?: WorkLocationType | null;
	vehicleUse?: WorkVehicleUse | null;
	/**
	 * Marks the work as missing a task (#884): decided only where the booking's
	 * project is set without a task while its task requirement is active. Left
	 * out, the marker stays while the project stays and no task is booked.
	 * Work with a task or without a project is never marked.
	 */
	missingTask?: boolean;
};

/** Why stored or requested parts cannot form a work attribution. */
export type UnrepresentableWorkAttribution =
	| "billable_without_project"
	| "task_without_project"
	| "missing_task_without_project"
	| "missing_task_with_task";

const UNREPRESENTABLE_MESSAGES: Record<UnrepresentableWorkAttribution, string> = {
	billable_without_project: "Work without a project cannot be billable",
	task_without_project: "Work without a project cannot be booked to a task",
	missing_task_without_project: "Work without a project cannot be missing a task",
	missing_task_with_task: "Work booked to a task cannot be missing a task",
};

export class UnrepresentableWorkAttributionError extends Error {
	constructor(readonly reason: UnrepresentableWorkAttribution) {
		super(UNREPRESENTABLE_MESSAGES[reason]);
		this.name = "UnrepresentableWorkAttributionError";
	}
}

type Parts = {
	project: WorkAttributionProject | null;
	missingTask: boolean;
	workCategoryId: string | null;
	workLocationType: WorkLocationType | null;
	vehicleUse: WorkVehicleUse | null;
};

export class WorkAttribution {
	readonly project: WorkAttributionProject | null;
	/**
	 * Missing task (#884): the work was booked to its project without the task
	 * the project's active requirement asked for. Only on project work without a
	 * task; it travels with the task, so the record agreement compares it there.
	 */
	readonly missingTask: boolean;
	readonly workCategoryId: string | null;
	readonly workLocationType: WorkLocationType | null;
	readonly vehicleUse: WorkVehicleUse | null;

	private constructor(parts: Parts) {
		this.project = parts.project ? Object.freeze({ ...parts.project }) : null;
		this.missingTask = parts.missingTask;
		this.workCategoryId = parts.workCategoryId;
		this.workLocationType = parts.workLocationType;
		this.vehicleUse = parts.vehicleUse;
		Object.freeze(this);
	}

	/** The attribution a work period's columns record. */
	static fromWorkPeriod(columns: WorkPeriodAttributionColumns): WorkAttribution {
		const project = projectOf(columns.projectId, columns.taskId, columns.isBillable);
		return new WorkAttribution({
			project,
			missingTask: storedMissingTask(project, columns.missingTask),
			workCategoryId: columns.workCategoryId,
			workLocationType: columns.workLocationType,
			vehicleUse: vehicleUseFromColumns(columns),
		});
	}

	/**
	 * The attribution a canonical work record's detail and allocations record. The
	 * project comes from the first project allocation in the given order; whether
	 * there is exactly one whole project allocation is the record agreement rule's
	 * question, not this value's. Cost-centre allocations are not attribution.
	 */
	static fromCanonical(
		detail: CanonicalWorkDetailColumns,
		allocations: readonly CanonicalAllocationShape[],
	): WorkAttribution {
		const allocation = allocations.find(({ allocationKind }) => allocationKind === "project");
		const project = allocation
			? projectOf(allocation.projectId, allocation.taskId, allocation.isBillable)
			: projectOf(null, null, false);
		return new WorkAttribution({
			project,
			missingTask: storedMissingTask(project, allocation?.missingTask ?? false),
			workCategoryId: detail.workCategoryId,
			workLocationType: detail.workLocationType,
			vehicleUse: vehicleUseFromColumns(detail),
		});
	}

	/** The parts in which this attribution differs from `other`, in a fixed order. */
	differences(other: WorkAttribution): WorkAttributionPart[] {
		const parts: WorkAttributionPart[] = [];
		if ((this.project?.projectId ?? null) !== (other.project?.projectId ?? null)) {
			parts.push("project");
		}
		// The marker is the task's state (#884): disagreeing on it is a task difference.
		if (
			(this.project?.taskId ?? null) !== (other.project?.taskId ?? null) ||
			this.missingTask !== other.missingTask
		) {
			parts.push("task");
		}
		if ((this.project?.billable ?? false) !== (other.project?.billable ?? false)) {
			parts.push("billable");
		}
		if (this.workCategoryId !== other.workCategoryId) parts.push("work_category");
		if (this.workLocationType !== other.workLocationType) parts.push("work_location");
		if (!sameWorkVehicleUse(this.vehicleUse, other.vehicleUse)) parts.push("vehicle_use");
		return parts;
	}

	equals(other: WorkAttribution): boolean {
		return this.differences(other).length === 0;
	}

	/**
	 * This attribution with a patch applied; this value is left unchanged.
	 *
	 * - The task follows the project (#873): left out, it stays while the project
	 *   stays and is cleared when the project changes or is cleared.
	 * - A changed project takes its billable default unless `billable` is given;
	 *   the same project keeps its billability (#900).
	 * - A billable flag or a task without a project is refused.
	 * - The missing-task marker (#884) is set only by the patch. Left out, it
	 *   stays while the project stays and no task is booked; it ends when a task
	 *   is booked or the project changes or clears.
	 */
	apply(patch: WorkAttributionPatch): WorkAttribution {
		const currentProjectId = this.project?.projectId ?? null;
		const projectId =
			patch.project === undefined ? currentProjectId : (patch.project?.projectId ?? null);
		const projectChanged = projectId !== currentProjectId;
		const taskId = taskIdFollowingProject({
			task: namedTaskIntent(patch.task).task,
			projectId,
			current: { projectId: currentProjectId, taskId: this.project?.taskId ?? null },
		});
		const billable =
			patch.billable ??
			(projectChanged
				? (patch.project?.billableDefault ?? false)
				: (this.project?.billable ?? false));
		const project = projectOf(projectId, taskId, billable);
		const missingTask =
			project !== null &&
			project.taskId === null &&
			(patch.missingTask ?? (!projectChanged && this.missingTask));
		return new WorkAttribution({
			project,
			missingTask,
			workCategoryId:
				patch.workCategoryId === undefined ? this.workCategoryId : patch.workCategoryId,
			workLocationType:
				patch.workLocationType === undefined ? this.workLocationType : patch.workLocationType,
			vehicleUse: patch.vehicleUse === undefined ? this.vehicleUse : patch.vehicleUse,
		});
	}

	/** The work period's attribution columns. */
	workPeriodColumns(): WorkPeriodAttributionColumns {
		return {
			projectId: this.project?.projectId ?? null,
			taskId: this.project?.taskId ?? null,
			isBillable: this.project?.billable ?? false,
			missingTask: this.missingTask,
			workCategoryId: this.workCategoryId,
			workLocationType: this.workLocationType,
			...vehicleUseColumns(this.vehicleUse),
		};
	}

	/** The canonical work record's detail (`time_record_work`) attribution columns. */
	canonicalDetail(): CanonicalWorkDetailColumns {
		return {
			workCategoryId: this.workCategoryId,
			workLocationType: this.workLocationType,
			...vehicleUseColumns(this.vehicleUse),
		};
	}

	/**
	 * The canonical work record's allocations: the given cost-centre allocations,
	 * unchanged and in order, then the project as one whole (weight 100)
	 * allocation carrying task and billability. Existing project allocations are
	 * replaced; work without a project has none.
	 */
	canonicalAllocations<T extends CanonicalAllocationShape>(
		existing: readonly T[],
	): (T | ProjectAllocation)[] {
		const kept = existing.filter(({ allocationKind }) => allocationKind !== "project");
		if (!this.project) return kept;
		return [
			...kept,
			{
				allocationKind: "project",
				projectId: this.project.projectId,
				taskId: this.project.taskId,
				costCenterId: null,
				weightPercent: WHOLE_ALLOCATION_WEIGHT,
				isBillable: this.project.billable,
				missingTask: this.missingTask,
			},
		];
	}
}

/** A stored marker, refused where it cannot be: without a project or with a task. */
function storedMissingTask(project: WorkAttributionProject | null, missingTask: boolean): boolean {
	if (!missingTask) return false;
	if (project === null) {
		throw new UnrepresentableWorkAttributionError("missing_task_without_project");
	}
	if (project.taskId !== null) {
		throw new UnrepresentableWorkAttributionError("missing_task_with_task");
	}
	return true;
}

function projectOf(
	projectId: string | null,
	taskId: string | null,
	billable: boolean,
): WorkAttributionProject | null {
	if (projectId === null) {
		if (billable) throw new UnrepresentableWorkAttributionError("billable_without_project");
		if (taskId !== null) throw new UnrepresentableWorkAttributionError("task_without_project");
		return null;
	}
	return { projectId, taskId, billable };
}
