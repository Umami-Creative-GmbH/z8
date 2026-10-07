import { frozenReceiptException } from "@/lib/travel-expenses/receipt-exception";
import type { ReportItemView } from "@/lib/travel-expenses/report-store";

/** The exception a saved expense would be submitted with (#604); null when none applies. */
export function pendingReceiptException(
	item: Pick<ReportItemView, "receipts" | "receiptException">,
): { reason: string } | null {
	return frozenReceiptException(item.receiptException.reason, item.receipts.length);
}
