import { IconArrowRight, IconCash } from "@tabler/icons-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/** Entry to the finance queue (#612), shown only to users with finance read access. */
export async function TravelExpenseFinanceEntry() {
	const t = await getTranslate();
	return (
		<Alert>
			<IconCash aria-hidden="true" className="size-4" />
			<AlertTitle>{t("travelExpenses.finance.entry.title", "Expense finance")}</AlertTitle>
			<AlertDescription className="flex flex-wrap items-center justify-between gap-4">
				<span>
					{t(
						"travelExpenses.finance.entry.description",
						"Review approved expenses, outstanding balances and recorded reimbursements.",
					)}
				</span>
				<Button asChild size="sm" variant="outline">
					<Link href="/travel-expenses/finance">
						{t("travelExpenses.finance.entry.open", "Open finance queue")}
						<IconArrowRight aria-hidden="true" className="ml-2 size-4" />
					</Link>
				</Button>
			</AlertDescription>
		</Alert>
	);
}
