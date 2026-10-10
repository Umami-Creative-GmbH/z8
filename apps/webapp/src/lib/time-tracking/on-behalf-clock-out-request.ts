import { CLOCK_COMMAND_OPERATION_ID } from "./clock-command";
import { namedTaskId } from "./task-attribution";

/**
 * The manager on-behalf clock-out request body (#276). Omitted attribution
 * preserves the period's; `null` clears it; an ID replaces it.
 */
export type OnBehalfClockOutRequest = {
	workPeriodId: string;
	/**
	 * Client identity of this closure (a lowercase UUID), minted once and resent
	 * on every retry. Absent from old clients.
	 */
	operationId?: string;
	projectId?: string | null;
	/** The task of the project (#873); omitted, it follows the project. */
	taskId?: string | null;
	workCategoryId?: string | null;
	/** Explicit billability (#900); absent applies the project's billable default. */
	billable?: boolean;
};

function isAttribution(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || (typeof value === "string" && value.length > 0);
}

/** Strict request parsing. Returns null for anything but the documented shape. */
export function parseOnBehalfClockOutRequest(value: unknown): OnBehalfClockOutRequest | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const { workPeriodId, operationId, projectId, taskId, workCategoryId, billable } =
		value as Record<string, unknown>;
	if (
		typeof workPeriodId !== "string" ||
		workPeriodId.length === 0 ||
		(operationId !== undefined &&
			(typeof operationId !== "string" || !CLOCK_COMMAND_OPERATION_ID.test(operationId))) ||
		!isAttribution(projectId) ||
		!isAttribution(taskId) ||
		!isAttribution(workCategoryId) ||
		(billable !== undefined && typeof billable !== "boolean")
	) {
		return null;
	}
	return {
		workPeriodId,
		...(operationId === undefined ? {} : { operationId }),
		...(projectId === undefined ? {} : { projectId }),
		...namedTaskId(taskId),
		...(workCategoryId === undefined ? {} : { workCategoryId }),
		...(typeof billable === "boolean" ? { billable } : {}),
	};
}
