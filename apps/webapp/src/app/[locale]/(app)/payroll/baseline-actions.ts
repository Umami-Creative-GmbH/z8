"use server";

import { Effect } from "effect";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import {
	inspectPayrollBaseline,
	listPayrollBaselines,
	type PayrollBaselineDetail,
	type PayrollBaselineSummary,
} from "@/lib/payroll-export/baseline-access";
import { getTranslate } from "@/tolgee/server";
import { mapPayrollWorkspaceActionError } from "./action-errors";

export async function listPayrollBaselinesAction(
	request: { startDate?: string; endDate?: string } = {},
): Promise<ServerActionResult<PayrollBaselineSummary[]>> {
	return runBaselineAction(() => listPayrollBaselines(request));
}

export async function inspectPayrollBaselineAction(
	baselineId: string,
): Promise<ServerActionResult<PayrollBaselineDetail | null>> {
	return runBaselineAction(() => inspectPayrollBaseline(baselineId));
}

async function runBaselineAction<T>(
	action: () => Promise<T>,
): Promise<ServerActionResult<T>> {
	const t = await getTranslate();
	return runServerActionSafe(
		Effect.tryPromise({
			try: action,
			catch: (error) => mapPayrollWorkspaceActionError(error, t),
		}),
	);
}
