"use server";

import { Effect } from "effect";
import {
	runServerActionSafe,
	type ServerActionResult,
} from "@/lib/effect/result";
import {
	type DatabaseClient,
	DatabaseService,
} from "@/lib/effect/services/database.service";
import {
	inspectPayrollBaseline,
	listPayrollBaselines,
	type PayrollBaselineDetail,
	type PayrollBaselineSummary,
} from "@/lib/payroll-export/baseline-access";
import { getTranslate } from "@/tolgee/server";
import { mapPayrollWorkspaceActionError } from "./action-errors";

export async function listPayrollBaselinesAction(
	request: { startDate?: string; endDate?: string; formatId?: string } = {},
): Promise<ServerActionResult<PayrollBaselineSummary[]>> {
	return runBaselineAction("list", (client) =>
		listPayrollBaselines(request, client),
	);
}

export async function inspectPayrollBaselineAction(
	baselineId: string,
): Promise<ServerActionResult<PayrollBaselineDetail | null>> {
	return runBaselineAction("inspect", (client) =>
		inspectPayrollBaseline(baselineId, client),
	);
}

async function runBaselineAction<T>(
	operation: string,
	action: (client: DatabaseClient) => Promise<T>,
): Promise<ServerActionResult<T>> {
	const t = await getTranslate();
	return runServerActionSafe(
		Effect.gen(function* () {
			const database = yield* DatabaseService;
			return yield* database
				.query(`payroll.baseline.${operation}`, () => action(database.db))
				.pipe(
					Effect.mapError((error) =>
						mapPayrollWorkspaceActionError(error.cause, t),
					),
				);
		}),
	);
}
