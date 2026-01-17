import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ReportsContainer } from "@/components/reports/reports-container";
import { getTranslate } from "@/tolgee/server";
import { getAccessibleEmployeesAction, getCurrentEmployee } from "./actions";

export default async function ReportsPage() {
	await connection(); // Mark as fully dynamic for cacheComponents mode

	// Auth is checked in layout
	const t = await getTranslate();

	const employee = await getCurrentEmployee();

	if (!employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("reports.feature", "generate reports")} />
			</div>
		);
	}

	// Get accessible employees for selector
	const accessibleEmployeesResult = await getAccessibleEmployeesAction();
	const employees = accessibleEmployeesResult.success ? accessibleEmployeesResult.data : [];

	return (
		<div className="@container/main flex flex-1 flex-col gap-6 py-4 md:py-6">
			{/* Page Header */}
			<div className="px-4 lg:px-6">
				<h1 className="text-3xl font-bold tracking-tight">
					{t("reports.title", "Employee Reports")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"reports.description",
						"Generate comprehensive work hour and absence reports with tax-relevant home office data",
					)}
				</p>
			</div>

			{/* Reports Container */}
			<ReportsContainer employees={employees} currentEmployeeId={employee.id} />
		</div>
	);
}
