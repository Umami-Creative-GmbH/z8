import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { ReportsContainer } from "@/components/reports/reports-container";
import { auth } from "@/lib/auth";
import { getAccessibleEmployeesAction, getCurrentEmployee } from "./actions";

export default async function ReportsPage() {
	const session = await auth.api.getSession({ headers: await headers() });
	if (!session?.user) {
		redirect("/sign-in");
	}

	const employee = await getCurrentEmployee();

	if (!employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="generate reports" />
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
				<h1 className="text-3xl font-bold tracking-tight">Employee Reports</h1>
				<p className="text-muted-foreground">
					Generate comprehensive work hour and absence reports with tax-relevant home office data
				</p>
			</div>

			{/* Reports Container */}
			<ReportsContainer employees={employees} currentEmployeeId={employee.id} />
		</div>
	);
}
