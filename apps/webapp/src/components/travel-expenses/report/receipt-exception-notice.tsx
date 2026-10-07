"use client";

import { IconFileOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { frozenReceiptException } from "@/lib/travel-expenses/receipt-exception";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";

/** The exception a saved expense would be submitted with (#604); null when none applies. */
export function pendingReceiptException(
	item: Pick<ReportItemView, "receipts" | "receiptException">,
): { reason: string } | null {
	return frozenReceiptException(item.receiptException.reason, item.receipts.length);
}

/**
 * A missing receipt stands out wherever the expense is summarized; it is never
 * listed like an attached receipt (#604).
 */
export function ReceiptExceptionNotice({ exception }: { exception: { reason: string } }) {
	const { t } = useTranslate();
	return (
		<div className="mt-2 space-y-1 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm dark:border-amber-800 dark:bg-amber-950/30">
			<Badge
				variant="outline"
				className="gap-1 border-amber-400 text-amber-800 dark:border-amber-700 dark:text-amber-300"
			>
				<IconFileOff aria-hidden="true" className="size-3.5" />
				{t("travelExpenses.report.receiptException.badge", "Receipt missing — exception")}
			</Badge>
			<p className="text-foreground">
				<span className="text-muted-foreground">
					{t("travelExpenses.report.receiptException.reasonLabel", "Why it is missing:")}
				</span>{" "}
				{exception.reason}
			</p>
		</div>
	);
}
