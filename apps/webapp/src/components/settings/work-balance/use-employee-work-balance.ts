"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CancelBalanceAdjustmentInput,
	cancelBalanceAdjustmentAction,
	getEmployeeWorkBalanceSectionAction,
	type RecordOvertimePayoutInput,
	recordOvertimePayoutAction,
} from "@/app/[locale]/(app)/settings/employees/work-balance-actions";
import type {
	BalanceAdjustmentActionResult,
	BalanceAdjustmentErrorCode,
} from "@/lib/work-balance/adjustments/types";

export const EMPLOYEE_WORK_BALANCE_QUERY_KEY = ["employeeWorkBalanceSection"] as const;

export class BalanceAdjustmentActionError extends Error {
	constructor(readonly code: BalanceAdjustmentErrorCode | null) {
		super(code ?? "failed");
	}
}

/** A refusal the user cannot change by retrying, as opposed to an unexpected failure. */
export function isRefusal(error: unknown): error is BalanceAdjustmentActionError {
	return (
		error instanceof BalanceAdjustmentActionError && error.code !== null && error.code !== "failed"
	);
}

async function unwrap<T>(action: Promise<BalanceAdjustmentActionResult<T>>): Promise<T> {
	const result = await action.catch(() => null);
	if (!result) throw new BalanceAdjustmentActionError(null);
	if (!result.success) throw new BalanceAdjustmentActionError(result.code);
	return result.data;
}

/**
 * The employee's balance and balance adjustment history, as the employee, their
 * managers or an owner/admin may see it (#996). Shares its cache with the
 * Work balance section, so a record or cancel refreshes every view of it.
 */
export function useBalanceAdjustmentSection(employeeId: string) {
	return useQuery({
		queryKey: [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId],
		queryFn: () => unwrap(getEmployeeWorkBalanceSectionAction({ employeeId })),
		// A refusal (not permitted, not found) does not change on retry.
		retry: (failureCount, error) => !isRefusal(error) && failureCount < 3,
	});
}

/** The employee's Work balance section data and its two writes (#993). */
export function useEmployeeWorkBalance(employeeId: string) {
	const queryClient = useQueryClient();
	const queryKey = [...EMPLOYEE_WORK_BALANCE_QUERY_KEY, employeeId];
	const section = useBalanceAdjustmentSection(employeeId);
	const onSettled = () => queryClient.invalidateQueries({ queryKey });

	const recordPayout = useMutation({
		mutationFn: (input: Omit<RecordOvertimePayoutInput, "employeeId">) =>
			unwrap(recordOvertimePayoutAction({ ...input, employeeId })),
		onSettled,
	});
	const cancelAdjustment = useMutation({
		mutationFn: (input: Omit<CancelBalanceAdjustmentInput, "employeeId">) =>
			unwrap(cancelBalanceAdjustmentAction({ ...input, employeeId })),
		onSettled,
	});

	return { section, recordPayout, cancelAdjustment };
}
