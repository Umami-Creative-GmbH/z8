"use client";

import { IconFileOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
	return section?.items.every((item) => accepted.includes(item.itemId)) ?? true;
}

/**
 * Expense report missing-receipt exceptions (#604). Approving the report needs
 * an explicit acceptance of each one; rejecting needs none. The server checks
 * the same against the frozen submission.
 */
export function ReceiptExceptionAcceptance({
	section,
	accepted,
	onChange,
	disabled,
}: {
	section: ReceiptExceptionAcceptanceSection;
	accepted: readonly string[];
	onChange: (accepted: string[]) => void;
	/** No decision can be made; the exceptions are listed without checkboxes. */
	disabled: boolean;
}) {
	const { t } = useTranslate();
	const title =
		typeof section.title === "string"
			? section.title
			: t(section.title.key, section.title.fallback);
	return (
		<section
			aria-labelledby="receipt-exception-acceptance-title"
			className="space-y-3 rounded-xl border border-amber-300 bg-amber-50/70 p-4 shadow-sm dark:border-amber-800 dark:bg-amber-950/30"
		>
			<h4
				id="receipt-exception-acceptance-title"
				className="flex items-center gap-2 text-sm font-semibold"
			>
				<IconFileOff aria-hidden="true" className="size-4 text-amber-700 dark:text-amber-400" />
				{title}
			</h4>
			<p className="text-sm text-muted-foreground">
				{disabled
					? t(
							"approvals:approvals.receiptExceptions.readOnly",
							"These expenses were submitted without a receipt, with the employee's explanation.",
						)
					: t(
							"approvals:approvals.receiptExceptions.instructions",
							"These expenses have no receipt. To approve the report, accept each explanation. You can reject the report without accepting them.",
						)}
			</p>
			<ul className="space-y-3">
				{section.items.map((item) => {
					const id = `receipt-exception-${item.itemId}`;
					const reason = (
						<span className="block text-sm text-muted-foreground">
							{t("approvals:approvals.receiptExceptions.reason", "Explanation:")} {item.reason}
						</span>
					);
					return (
						<li key={item.itemId} className="flex items-start gap-2">
							{disabled ? (
								<div>
									<span className="text-sm font-medium">{item.label}</span>
									{reason}
								</div>
							) : (
								<>
									<Checkbox
										id={id}
										checked={accepted.includes(item.itemId)}
										onCheckedChange={(checked) =>
											onChange(
												checked === true
													? [...accepted.filter((other) => other !== item.itemId), item.itemId]
													: accepted.filter((other) => other !== item.itemId),
											)
										}
									/>
									<Label htmlFor={id} className="block font-normal leading-5">
										<span className="font-medium">
											{t(
												"approvals:approvals.receiptExceptions.accept",
												"Accept missing receipt for {label}",
												{ label: item.label },
											)}
										</span>
										{reason}
									</Label>
								</>
							)}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
