import { IconArrowRight, IconInbox } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/** Entry to the approvals inbox filtered to expense reports and claims, for managers and admins. */
export async function TravelExpenseApprovalsEntry() {
	const t = await getTranslate();
	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
			<IconInbox aria-hidden="true" className="size-4" />
			<h2 className="font-medium">
				{t("travelExpenses.approvals.entry.title", "Review pending travel expense approvals")}
			</h2>
			<div className="flex flex-1 flex-wrap items-end justify-between gap-3 text-sm text-muted-foreground">
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
			</div>
		</section>
	);
}
