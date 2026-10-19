"use server";
import { Effect } from "effect";
import { runServerActionSafe } from "@/lib/effect/result";
import {
	type DatabaseClient,
	DatabaseService,
} from "@/lib/effect/services/database.service";
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
	return run("list", (client) =>
		listCompatiblePayrollBaselines(request, client),
	);
}
export async function preparePayrollComparisonAction(
	request: PayrollComparisonRequest,
) {
	return run("prepare", (client) => preparePayrollComparison(request, client));
}
export async function getPayrollComparisonAction(id: string) {
	return run("view", (client) => getPayrollComparison(id, client));
}
async function run<T>(
	operation: string,
	action: (client: DatabaseClient) => Promise<T>,
) {
	const t = await getTranslate();
	return runServerActionSafe(
		Effect.gen(function* () {
			const database = yield* DatabaseService;
			return yield* database
				.query(`payroll.comparison.${operation}`, () => action(database.db))
				.pipe(
					Effect.mapError((error) =>
						mapPayrollWorkspaceActionError(error.cause, t),
					),
				);
		}),
	);
}
