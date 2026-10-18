"use server";
import { Effect } from "effect";
import { runServerActionSafe } from "@/lib/effect/result";
import type { PayrollComparisonRequest } from "@/lib/payroll-export/comparison-service";
import {
	getPayrollComparison,
	listCompatiblePayrollBaselines,
	preparePayrollComparison,
} from "@/lib/payroll-export/comparison-service";
import { getTranslate } from "@/tolgee/server";
import { mapPayrollWorkspaceActionError } from "./action-errors";
export async function listCompatiblePayrollBaselinesAction(
	request: Omit<PayrollComparisonRequest, "baselineId">,
) {
	return run(() => listCompatiblePayrollBaselines(request));
}
export async function preparePayrollComparisonAction(
	request: PayrollComparisonRequest,
) {
	return run(() => preparePayrollComparison(request));
}
export async function getPayrollComparisonAction(id: string) {
	return run(() => getPayrollComparison(id));
}
async function run<T>(action: () => Promise<T>) {
	const t = await getTranslate();
	return runServerActionSafe(
		Effect.tryPromise({
			try: action,
			catch: (error) => mapPayrollWorkspaceActionError(error, t),
		}),
	);
}
