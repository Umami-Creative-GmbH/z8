import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { payrollExportBaselineWindowInput } from "@/db/schema";
import { employeePayrollWindow } from "@/lib/payroll-allocation/protected-minutes";
import { payrollBaselineDigest } from "./baseline-evidence";
import type { PayrollBaselineEvidence } from "./baseline-types";

type WindowDatabase = Pick<typeof db, "insert" | "query">;
export function payrollWindowsFromCollection(input: {
	employeeIds: string[];
	startDate: string;
	endDate: string;
	employeeTimezones: Record<string, string>;
}): PayrollBaselineEvidence["employeeWindows"] {
	return input.employeeIds
		.map((employeeId) => {
			const timezone = input.employeeTimezones[employeeId];
			if (!timezone)
				throw new Error("Payroll collection timezone is unavailable");
			const range = employeePayrollWindow(
				input.startDate,
				input.endDate,
				timezone,
			);
			return {
				employeeId,
				timezone,
				startUtc: range.start.toString(),
				endExclusiveUtc: range.endExclusive.toString(),
			};
		})
		.sort((a, b) => a.employeeId.localeCompare(b.employeeId));
}
export async function insertPayrollBaselineWindowInput(
	database: WindowDatabase,
	input: {
		organizationId: string;
		jobId: string;
		windows: PayrollBaselineEvidence["employeeWindows"];
	},
) {
	await database
		.insert(payrollExportBaselineWindowInput)
		.values({ ...input, digest: payrollBaselineDigest(input.windows) });
}
export async function readPayrollBaselineWindowInput(input: {
	organizationId: string;
	jobId: string;
}): Promise<PayrollBaselineEvidence["employeeWindows"] | null> {
	const row = await db.query.payrollExportBaselineWindowInput.findFirst({
		where: and(
			eq(payrollExportBaselineWindowInput.organizationId, input.organizationId),
			eq(payrollExportBaselineWindowInput.jobId, input.jobId),
		),
	});
	if (!row) return null;
	if (payrollBaselineDigest(row.windows) !== row.digest)
		throw new Error("Payroll collection windows failed integrity validation");
	return row.windows;
}
