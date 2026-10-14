/**
 * What a historical repair asks work records to write (#1226), and whether the
 * repaired pair would agree. Pure, no I/O: the field repair proposal and the
 * gap repair planner refuse or hold a repair whose result would still disagree,
 * so an approved repair is one work records accepts.
 *
 * A repair changes both records (Time Tracking ADR 0010): each repaired value
 * is what the repaired work holds, in its work period and in its canonical
 * work record. Anything a repair does not name is the work period's own value;
 * the period's interval mirrors hashed entries and never moves.
 */
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import type { GapRepairFill } from "./historical-gap-repair";
import type { RepairChange } from "./historical-repair-proposal";
import {
	agreementPeriodOf,
	agreementRecordOf,
	type HistoricalPeriodEvidence,
	type HistoricalRecordEvidence,
} from "./historical-work-diagnostics";
import type { WorkLocationType } from "./work-location";
import type { AmendAttributionPatch } from "./work-records/amend-change";
import { planAttachment, planRepair } from "./work-records/repair-plan";
import type { WorkAttributionPatch } from "./work-records/work-attribution";

/** The resolution of a repair, as work records' repair change takes it. */
export type HistoricalRepairResolution = {
	durationMinutes?: number;
	startAt?: Instant;
	endAt?: Instant;
	attribution?: AmendAttributionPatch;
};

/**
 * The resolution an explicit field repair names. A repaired project takes the
 * task and billability the canonical record already allocates to it (#873,
 * #900); otherwise the task follows the project (kept on the same project,
 * cleared on another) and a new project's billable default applies.
 * Record endpoints name the interval; work records requires them to be the
 * period's own, since a repair never moves an endpoint.
 */
export function fieldRepairResolution(
	changes: readonly Pick<RepairChange, "field" | "after">[],
	record: Pick<HistoricalRecordEvidence, "allocations"> | null,
): HistoricalRepairResolution {
	const resolution: HistoricalRepairResolution = {};
	const attribution: AmendAttributionPatch = {};
	for (const change of changes) {
		switch (change.field) {
			case "duration_minutes":
				resolution.durationMinutes = change.after as number;
				break;
			case "work_category_id":
				attribution.workCategoryId = change.after as string;
				break;
			case "work_location_type":
				attribution.workLocationType = change.after as WorkLocationType;
				break;
			case "project_id": {
				const projectId = change.after as string;
				attribution.project = projectId;
				const allocated = record?.allocations.find(
					(allocation) =>
						allocation.allocationKind === "project" && allocation.projectId === projectId,
				);
				// Otherwise the task follows the project and a new project's default applies.
				if (allocated) {
					attribution.task = allocated.taskId;
					attribution.billable = allocated.isBillable;
				}
				break;
			}
			case "start_at":
				resolution.startAt = parseInstant(change.after as string);
				break;
			case "end_at":
				resolution.endAt = parseInstant(change.after as string);
				break;
		}
	}
	return Object.keys(attribution).length > 0 ? { ...resolution, attribution } : resolution;
}

/**
 * The resolution of an evidence-only gap repair: each fill names the value the
 * agreeing representation established, so work records writes it into the side
 * that misses it. A missing detail or link names nothing: work records gives the
 * record the period's whole attribution, vehicle use included, and links it.
 */
export function gapRepairResolution(fills: readonly GapRepairFill[]): HistoricalRepairResolution {
	const resolution: HistoricalRepairResolution = {};
	const attribution: AmendAttributionPatch = {};
	for (const fill of fills) {
		switch (fill.kind) {
			case "canonical_duration":
			case "period_duration":
				resolution.durationMinutes = fill.durationMinutes;
				break;
			case "canonical_completion":
				resolution.endAt = parseInstant(fill.endAt);
				if (fill.durationMinutes !== null) resolution.durationMinutes = fill.durationMinutes;
				break;
			case "period_completion":
				resolution.endAt = parseInstant(fill.endTime);
				if (fill.durationMinutes !== null) resolution.durationMinutes = fill.durationMinutes;
				break;
			case "canonical_metadata":
				if (fill.field === "project") attribution.project = fill.value;
				if (fill.field === "work_category") attribution.workCategoryId = fill.value;
				if (fill.field === "work_location_type") {
					attribution.workLocationType = fill.value as WorkLocationType;
				}
				break;
			case "canonical_record":
			case "canonical_link":
			case "canonical_detail":
				break;
		}
	}
	return Object.keys(attribution).length > 0 ? { ...resolution, attribution } : resolution;
}

/**
 * Whether work records would write the repaired pair: the plan step's own
 * answer, on the evidence. Without a record, the repair is an attachment.
 */
export function repairedWorkAgrees(
	period: HistoricalPeriodEvidence,
	record: HistoricalRecordEvidence | null,
	resolution: HistoricalRepairResolution,
): boolean {
	const workPeriod = agreementPeriodOf(period);
	if (!record) return !("kind" in planAttachment(workPeriod));
	const plan = planRepair(
		workPeriod,
		{ ...agreementRecordOf(record), linked: true },
		{
			durationMinutes: resolution.durationMinutes,
			startAt: resolution.startAt,
			endAt: resolution.endAt,
			attribution: resolution.attribution && plannablePatch(resolution.attribution),
		},
	);
	return !("kind" in plan) || plan.kind === "unchanged";
}

/**
 * The patch as the plan step applies it. Agreement does not depend on the
 * billable default: both records take the same one, read when the repair is
 * written.
 */
function plannablePatch(patch: AmendAttributionPatch): WorkAttributionPatch {
	const { project, ...rest } = patch;
	if (project === undefined) return rest;
	return {
		...rest,
		project: project === null ? null : { projectId: project, billableDefault: false },
	};
}
