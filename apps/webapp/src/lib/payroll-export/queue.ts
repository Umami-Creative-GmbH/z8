import { createLogger } from "@/lib/logger";
import { addJob } from "@/lib/queue";
import { markPayrollExportJobFailed } from "./export-service";

const logger = createLogger("PayrollExportQueue");

export async function enqueuePayrollExportJob(input: { jobId: string; organizationId: string }) {
	try {
		return await addJob(
			"process-payroll-export",
			{ ...input, type: "payroll-export" },
			{ priority: 4, jobId: `payroll-export-${input.jobId}` },
		);
	} catch (error) {
		logger.error({ error, ...input }, "Failed to queue payroll export");

		try {
			await markPayrollExportJobFailed({
				...input,
				errorMessage: "Failed to queue payroll export",
			});
		} catch (statusError) {
			logger.error({ error: statusError, ...input }, "Failed to mark payroll export as failed");
		}

		throw error;
	}
}
