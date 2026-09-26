import { env } from "@/env";
import { createLogger } from "@/lib/logger";
import {
	processWorkBalanceRebuildIntents,
	type WorkBalanceRebuildResult,
} from "@/lib/work-balance/rebuild-intents";
import {
	listEmployeesForWorkBalanceBatch,
	markEmployeeWorkBalanceFailed,
	refreshEmployeeWorkBalanceFromPeriods,
} from "@/lib/work-balance/service";

const logger = createLogger("WorkBalanceJob");

export interface WorkBalanceJobResult {
	success: boolean;
	employeesProcessed: number;
	balancesUpdated: number;
	skipped: number;
	batchLimit: number;
	errors: Array<{ employeeId: string; organizationId: string; error: string }>;
	rebuildIntents: WorkBalanceRebuildResult;
}

export async function runWorkBalanceRefresh(): Promise<WorkBalanceJobResult> {
	const batchLimit = Number(env.WORK_BALANCE_JOB_BATCH_LIMIT);
	// Recover pending rebuild intents (#311) first, so their reset projections
	// are refreshed in this same run.
	const rebuildIntents = await processWorkBalanceRebuildIntents();
	for (const failure of rebuildIntents.failures) {
		logger.error(failure, "Failed to rebuild organization work balances");
	}
	const employees = await listEmployeesForWorkBalanceBatch(batchLimit);
	const result: WorkBalanceJobResult = {
		success: true,
		employeesProcessed: 0,
		balancesUpdated: 0,
		skipped: 0,
		batchLimit,
		errors: [],
		rebuildIntents,
	};

	const employeeResults = await Promise.all(
		employees.map(async (employee) => {
			let balanceUpdated = false;
			let skipped = false;
			let failure: WorkBalanceJobResult["errors"][number] | null = null;

			try {
				const refreshStartedAt = new Date();
				const forceFullRebuild =
					employee.balanceId === null ||
					(employee.isDirty === true &&
						employee.dirtyFromDate === null &&
						employee.refreshRequestedAt !== null);
				const refreshResult = await refreshEmployeeWorkBalanceFromPeriods({
					employeeId: employee.id,
					organizationId: employee.organizationId,
					dirtyFromDate: employee.dirtyFromDate,
					forceFullRebuild,
					now: refreshStartedAt,
				});
				if (!refreshResult.updated) {
					skipped = true;
				} else {
					balanceUpdated = true;
				}
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error(
					{ error: message, employeeId: employee.id },
					"Failed to refresh employee work balance",
				);
				await markEmployeeWorkBalanceFailed({
					employeeId: employee.id,
					organizationId: employee.organizationId,
					error: message,
				});
				failure = {
					employeeId: employee.id,
					organizationId: employee.organizationId,
					error: message,
				};
			}

			return { balanceUpdated, skipped, failure };
		}),
	);

	for (const employeeResult of employeeResults) {
		result.employeesProcessed += 1;
		if (employeeResult.balanceUpdated) {
			result.balancesUpdated += 1;
		}
		if (employeeResult.skipped) {
			result.skipped += 1;
		}
		if (employeeResult.failure) {
			result.errors.push(employeeResult.failure);
		}
	}

	result.success = result.errors.length === 0 && rebuildIntents.failures.length === 0;
	return result;
}
