import { createLogger } from "@/lib/logger";
import {
	computeEmployeeWorkBalance,
	listEmployeesForWorkBalanceBatch,
	markEmployeeWorkBalanceFailed,
	upsertEmployeeWorkBalance,
} from "@/lib/work-balance/service";

const logger = createLogger("WorkBalanceJob");

export interface WorkBalanceJobResult {
	success: boolean;
	employeesProcessed: number;
	balancesUpdated: number;
	skipped: number;
	batchLimit: number;
	errors: Array<{ employeeId: string; organizationId: string; error: string }>;
}

export async function runWorkBalanceRefresh(): Promise<WorkBalanceJobResult> {
	const batchLimit = 1000;
	const employees = await listEmployeesForWorkBalanceBatch(batchLimit);
	const result: WorkBalanceJobResult = {
		success: true,
		employeesProcessed: 0,
		balancesUpdated: 0,
		skipped: 0,
		batchLimit,
		errors: [],
	};

	for (const employee of employees) {
		result.employeesProcessed += 1;
		try {
			const values = await computeEmployeeWorkBalance({
				employeeId: employee.id,
				organizationId: employee.organizationId,
			});
			if (!values) {
				result.skipped += 1;
				continue;
			}

			await upsertEmployeeWorkBalance(values);
			result.balancesUpdated += 1;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error({ error: message, employeeId: employee.id }, "Failed to refresh employee work balance");
			await markEmployeeWorkBalanceFailed({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				error: message,
			});
			result.errors.push({
				employeeId: employee.id,
				organizationId: employee.organizationId,
				error: message,
			});
		}
	}

	result.success = result.errors.length === 0;
	return result;
}
