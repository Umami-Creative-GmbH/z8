import { IconArrowRight, IconCash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/navigation";
import { getTranslate } from "@/tolgee/server";

/** Entry to the finance queue (#612), shown only to users with finance read access. */
export async function TravelExpenseFinanceEntry() {
	const t = await getTranslate();
	return (
		<section className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
			<IconCash aria-hidden="true" className="size-4" />
			<h2 className="font-medium">{t("travelExpenses.finance.entry.title", "Expense finance")}</h2>
			<div className="flex flex-1 flex-wrap items-end justify-between gap-3 text-sm text-muted-foreground">
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
			</div>
		</section>
	);
}
