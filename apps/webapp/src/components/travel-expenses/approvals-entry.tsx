import { IconArrowRight, IconInbox } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/** Entry to the approvals inbox filtered to expense reports and claims, for managers and admins. */
export async function TravelExpenseApprovalsEntry() {
	const t = await getTranslate();
	return (
		<Alert>
			<IconInbox aria-hidden="true" className="size-4" />
			<AlertTitle>
				{t("travelExpenses.approvals.entry.title", "Review pending travel expense approvals")}
			</AlertTitle>
			<AlertDescription className="flex flex-wrap items-center justify-between gap-4">
				<span>
					{t(
						"travelExpenses.approvals.description",
						"Open the unified approvals inbox filtered to travel expenses.",
					)}
				</span>
				<Button asChild size="sm" variant="outline">
					<Link href="/approvals/inbox?types=travel_expense_report,travel_expense_claim">
						{t("travelExpenses.approvals.entry.open", "Open inbox")}
						<IconArrowRight aria-hidden="true" className="ml-2 size-4" />
					</Link>
				</Button>
			</AlertDescription>
		</Alert>
	);
}
