import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpenseManagement } from "@/components/travel-expenses/travel-expense-management";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function TravelExpensesPage() {
	await connection();

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="manage travel expenses" />
			</div>
		);
	}

	return (
		<TravelExpenseManagement
			organizationId={authContext.employee.organizationId}
			employeeId={authContext.employee.id}
		/>
	);
}
