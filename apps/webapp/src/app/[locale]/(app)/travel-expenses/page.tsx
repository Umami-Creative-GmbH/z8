import { IconArrowRight, IconInbox } from "@tabler/icons-react";
import { connection } from "next/server";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { TravelExpenseManagement } from "@/components/travel-expenses/travel-expense-management";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { getAuthContext } from "@/lib/auth-helpers";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

export default async function TravelExpensesPage() {
	await connection();

	const [t, authContext] = await Promise.all([getTranslate(), getAuthContext()]);

	if (!authContext?.employee) {
		return (
			<div className="@container/main flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature={t("travelExpenses.feature", "manage travel expenses")} />
			</div>
		);
	}

	return (
		<div className="@container/main flex flex-1 flex-col gap-4 py-4 md:py-6">
			{(authContext.employee.role === "manager" || authContext.employee.role === "admin") && (
				<div className="px-4 lg:px-6">
					<Alert>
						<IconInbox aria-hidden="true" className="size-4" />
						<AlertTitle>
							{t("travelExpenses.approvals.title", "Review Pending Travel Expense Approvals")}
						</AlertTitle>
						<AlertDescription className="flex items-center justify-between gap-4">
							<span>
								{t(
									"travelExpenses.approvals.description",
									"Open the unified approvals inbox filtered to travel expenses.",
								)}
							</span>
							<Button asChild size="sm" variant="outline">
								<Link href="/approvals/inbox?types=travel_expense_claim">
									{t("travelExpenses.approvals.openInbox", "Open Inbox")}
									<IconArrowRight aria-hidden="true" className="ml-2 size-4" />
								</Link>
							</Button>
						</AlertDescription>
					</Alert>
				</div>
			)}

			<TravelExpenseManagement
				organizationId={authContext.employee.organizationId}
				employeeId={authContext.employee.id}
			/>
		</div>
	);
}
