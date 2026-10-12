import type { TimeOffInLieuPreview } from "@/lib/absences/time-off-in-lieu-preview";
import { loadTimeOffInLieuPreview } from "@/lib/absences/time-off-in-lieu-preview.server";
import { formatSignedWorkBalance } from "@/lib/work-balance/format";
import type { ApprovalInboxDetailSection } from "../inbox/types";

type DayPeriod = "full_day" | "am" | "pm";

const PERIODS = new Set<unknown>(["full_day", "am", "pm"]);

interface TimeOffInLieuEntity {
	organizationId: string;
	employeeId: string;
	startDate: string;
	startPeriod: DayPeriod;
	endDate: string;
	endPeriod: DayPeriod;
}

/** The live absence when its category draws on the work balance (#1000), else null. */
function timeOffInLieuEntity(entity: unknown): TimeOffInLieuEntity | null {
	if (typeof entity !== "object" || entity === null) return null;
	const value = entity as Record<string, unknown>;
	const category =
		typeof value.category === "object" && value.category !== null
			? (value.category as Record<string, unknown>)
			: null;
	if (
		category?.drawsOnWorkBalance !== true ||
		typeof value.organizationId !== "string" ||
		typeof value.employeeId !== "string" ||
		typeof value.startDate !== "string" ||
		typeof value.endDate !== "string" ||
		!PERIODS.has(value.startPeriod) ||
		!PERIODS.has(value.endPeriod)
	) {
		return null;
	}
	return {
		organizationId: value.organizationId,
		employeeId: value.employeeId,
		startDate: value.startDate,
		startPeriod: value.startPeriod as DayPeriod,
		endDate: value.endDate,
		endPeriod: value.endPeriod as DayPeriod,
	};
}

/**
 * The approver's projection of the employee's work balance after an absence of time off
 * in lieu: the same figure the employee saw when requesting it. Null for other absences
 * and while the balance is unavailable.
 */
export async function prepareAbsenceWorkBalance(input: {
	organizationId: string;
	entity: unknown;
}): Promise<TimeOffInLieuPreview | null> {
	const absence = timeOffInLieuEntity(input.entity);
	if (!absence || absence.organizationId !== input.organizationId) return null;
	return loadTimeOffInLieuPreview({
		organizationId: input.organizationId,
		employeeId: absence.employeeId,
		absence,
	});
}

/** A negative projection is a warning: the approval is never refused for it. */
export function buildAbsenceWorkBalanceSections(
	preview: TimeOffInLieuPreview,
): ApprovalInboxDetailSection[] {
	const sections: ApprovalInboxDetailSection[] = [
		{
			type: "key_value",
			title: { key: "approvals:approvals.workBalance.title", fallback: "Work balance" },
			rows: [
				{
					label: { key: "approvals:approvals.workBalance.current", fallback: "Current" },
					value: formatSignedWorkBalance(preview.currentBalanceMinutes),
				},
				{
					label: { key: "approvals:approvals.workBalance.drawn", fallback: "Drawn by request" },
					value: formatSignedWorkBalance(-preview.drawnMinutes),
				},
				{
					label: { key: "approvals:approvals.workBalance.after", fallback: "After approval" },
					value: formatSignedWorkBalance(preview.projectedBalanceMinutes),
					...(preview.wouldBeNegative ? { tone: "warning" as const } : {}),
				},
			],
		},
	];
	if (preview.wouldBeNegative) {
		sections.push({
			type: "callout",
			title: {
				key: "approvals:approvals.workBalance.negativeTitle",
				fallback: "Work balance would be negative",
			},
			body: {
				key: "approvals:approvals.workBalance.negativeBody",
				fallback:
					"Approving this time off in lieu leaves the employee's work balance negative. You can still approve it.",
			},
			tone: "warning",
		});
	}
	return sections;
}
