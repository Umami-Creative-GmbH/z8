import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpenseApprovalQueue } from "@/components/travel-expenses/travel-expense-approval-queue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getAuthContext } from "@/lib/auth-helpers";

export default async function TravelExpenseApprovalsPage() {
	await connection();

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="approve travel expenses" />
			</div>
		);
	}

	if (authContext.employee.role !== "manager" && authContext.employee.role !== "admin") {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<Card className="w-full max-w-lg">
					<CardHeader>
						<CardTitle>Access denied</CardTitle>
					</CardHeader>
					<CardContent className="text-sm text-muted-foreground">
						You do not have permission to review travel expense approvals.
					</CardContent>
				</Card>
			</div>
		);
	}

	return (
		<TravelExpenseApprovalQueue
			currentEmployeeId={authContext.employee.id}
			currentRole={authContext.employee.role}
		/>
	);
}
