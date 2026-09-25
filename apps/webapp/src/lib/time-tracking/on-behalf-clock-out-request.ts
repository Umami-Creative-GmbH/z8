import { CLOCK_COMMAND_OPERATION_ID } from "./clock-command";

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
	workCategoryId?: string | null;
};

function isAttribution(value: unknown): value is string | null | undefined {
	return value === undefined || value === null || (typeof value === "string" && value.length > 0);
}

/** Strict request parsing. Returns null for anything but the documented shape. */
export function parseOnBehalfClockOutRequest(value: unknown): OnBehalfClockOutRequest | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const { workPeriodId, operationId, projectId, workCategoryId } = value as Record<string, unknown>;
	if (
		typeof workPeriodId !== "string" ||
		workPeriodId.length === 0 ||
		(operationId !== undefined &&
			(typeof operationId !== "string" || !CLOCK_COMMAND_OPERATION_ID.test(operationId))) ||
		!isAttribution(projectId) ||
		!isAttribution(workCategoryId)
	) {
		return null;
	}
	return {
		workPeriodId,
		...(operationId === undefined ? {} : { operationId }),
		...(projectId === undefined ? {} : { projectId }),
		...(workCategoryId === undefined ? {} : { workCategoryId }),
	};
}
