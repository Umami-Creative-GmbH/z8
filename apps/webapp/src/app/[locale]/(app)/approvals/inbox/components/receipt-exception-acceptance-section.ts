import type { ApprovalInboxDetailSection } from "@/lib/approvals/inbox/types";

export type ReceiptExceptionAcceptanceSection = Extract<
	ApprovalInboxDetailSection,
	{ type: "receipt_exception_acceptance" }
>;

export function findReceiptExceptionAcceptance(
	sections: readonly ApprovalInboxDetailSection[],
): ReceiptExceptionAcceptanceSection | null {
	return (
		sections.find(
			(section): section is ReceiptExceptionAcceptanceSection =>
				section.type === "receipt_exception_acceptance",
		) ?? null
	);
}

/** Whether every exception of the section is accepted; true when there is none. */
export function allReceiptExceptionsAccepted(
	section: ReceiptExceptionAcceptanceSection | null,
	accepted: readonly string[],
): boolean {
	const acceptedIds = new Set(accepted);
	return section?.items.every((item) => acceptedIds.has(item.itemId)) ?? true;
}
