"use client";

import { IconAlertTriangle } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { saveReceiptExceptionAction } from "@/app/[locale]/(app)/travel-expenses/receipt-exception-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";
import type { DraftSaveOutcome } from "@/lib/travel-expenses/draft-saver";
import {
	MAX_RECEIPT_EXCEPTION_REASON_LENGTH,
	parseReceiptExceptionDraft,
	type ReceiptExceptionContext,
} from "@/lib/travel-expenses/receipt-exception";
import type { ReceiptExceptionView } from "@/lib/travel-expenses/receipt-exception-read";
import { DraftSaveStatus } from "./draft-save-status";
import { useDraftSaver } from "./use-draft-saver";

type Values = { requested: boolean; reason: string };

function toValues(exception: ReceiptExceptionView): Values {
	return { requested: exception.reason !== null, reason: exception.reason ?? "" };
}

/** The requirement context of the values on screen. */
function contextOf(values: Values, allowed: boolean): ReceiptExceptionContext {
	return {
		allowed,
		requested: values.requested,
		reason: values.reason.trim() ? values.reason : null,
	};
}

/**
 * Missing-receipt exception of one receipt expense (#604). Only an expense
 * without receipts can request one, only while the organization allows
 * exceptions, and only with an explanation. It autosaves on its own version,
 * separately from the expense's other fields, and is never shown as a receipt.
 */
export function ReceiptExceptionField({
	reportId,
	itemId,
	exception,
	receiptCount,
	allowed,
	onContextChange,
	onSaved,
}: {
	reportId: string;
	itemId: string;
	/** The exception as last loaded; later loads never reset what is being typed. */
	exception: ReceiptExceptionView;
	receiptCount: number;
	/** Whether the organization allows missing-receipt exceptions. */
	allowed: boolean;
	onContextChange: (context: ReceiptExceptionContext) => void;
	onSaved: () => unknown;
}) {
	const { t } = useTranslate();
	const lastSavedReason = useRef<string | null>(exception.reason);
	const [reasonLeft, setReasonLeft] = useState(false);
	const { saver, state } = useDraftSaver<Values, ReceiptExceptionView>({
		version: exception.version,
		onUnsavedAfterClose: () =>
			toast.error(
				t(
					"travelExpenses.report.receiptException.unsavedAfterClose",
					"Your missing-receipt explanation could not be saved. Open the expense again to check it.",
				),
			),
		save: async (values, expectedVersion): Promise<DraftSaveOutcome<ReceiptExceptionView>> => {
			const parsed = parseReceiptExceptionDraft(values);
			if (!parsed.ok) return { status: "invalid", errors: { reason: parsed.error } };
			// Nothing changed since the last save, e.g. requested and withdrawn again.
			if (parsed.reason === lastSavedReason.current) {
				return { status: "saved", version: expectedVersion };
			}
			const result = await saveReceiptExceptionAction({
				reportId,
				itemId,
				expectedVersion,
				requested: values.requested,
				reason: values.reason,
			});
			if (!result.success) return { status: "failed", error: result.error };
			switch (result.data.status) {
				case "saved":
					lastSavedReason.current = result.data.receiptException.reason;
					void onSaved();
					return { status: "saved", version: result.data.receiptException.version };
				case "conflict":
					return {
						status: "conflict",
						version: result.data.receiptException.version,
						item: result.data.receiptException,
					};
				case "invalid":
					return { status: "invalid", errors: { reason: result.data.error } };
				case "not_allowed":
					return {
						status: "failed",
						error: t(
							"travelExpenses.report.receiptException.notAllowed",
							"Your organization does not allow missing-receipt exceptions.",
						),
					};
			}
		},
	});

	const form = useForm({
		defaultValues: toValues(exception),
		listeners: {
			onChange: ({ formApi }) => {
				saver.change(formApi.state.values);
				onContextChange(contextOf(formApi.state.values, allowed));
			},
		},
	});

	// With a receipt attached, an exception is neither needed nor submitted.
	if (receiptCount > 0) {
		return exception.reason ? (
			<p className="text-sm text-muted-foreground">
				{t(
					"travelExpenses.report.receiptException.receiptAttached",
					"A receipt is attached, so your missing-receipt explanation is not submitted.",
				)}
			</p>
		) : null;
	}

	const reasonProblem = state.status === "invalid" ? state.fieldErrors?.reason : undefined;
	// Ticking the box saves at once; a still empty explanation is not an error until it was left.
	const awaitingReason = reasonProblem !== undefined && reasonProblem !== "too_long" && !reasonLeft;
	const reasonError =
		reasonProblem && !awaitingReason
			? reasonProblem === "too_long"
				? t("travelExpenses.report.errors.tooLong", "This text is too long.")
				: t(
						"travelExpenses.report.receiptException.reasonRequired",
						"Explain why the receipt is missing.",
					)
			: undefined;
	const shownState = awaitingReason ? { ...state, status: "pending" as const } : state;
	const checkboxId = `${itemId}-receipt-exception`;

	return (
		<form.Subscribe selector={(formState) => formState.values.requested}>
			{(requested) =>
				!allowed && !requested ? null : (
					<section
						aria-labelledby={`${checkboxId}-title`}
						className="space-y-3 rounded-lg border border-amber-300 bg-amber-50/60 p-4 dark:border-amber-800 dark:bg-amber-950/20"
					>
						<h3 id={`${checkboxId}-title`} className="text-base font-semibold">
							{t("travelExpenses.report.receiptException.title", "No receipt?")}
						</h3>
						{!allowed && (
							<Alert variant="destructive">
								<IconAlertTriangle aria-hidden="true" className="size-4" />
								<AlertDescription className="space-y-2">
									<p>
										{t(
											"travelExpenses.report.receiptException.disabled",
											"Your organization no longer allows missing-receipt exceptions. Attach the receipt, or remove your explanation.",
										)}
									</p>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={() => {
											form.setFieldValue("requested", false);
											saver.change(form.state.values);
											onContextChange(contextOf(form.state.values, allowed));
										}}
									>
										{t("travelExpenses.report.receiptException.withdraw", "Remove explanation")}
									</Button>
								</AlertDescription>
							</Alert>
						)}
						{allowed && (
							<form.Field name="requested">
								{(field) => (
									<div className="flex items-start gap-2">
										<Checkbox
											id={checkboxId}
											checked={field.state.value}
											onCheckedChange={(checked) => field.handleChange(checked === true)}
										/>
										<Label htmlFor={checkboxId} className="font-normal leading-5">
											{t(
												"travelExpenses.report.receiptException.request",
												"I cannot provide the receipt and request an exception",
											)}
										</Label>
									</div>
								)}
							</form.Field>
						)}
						{allowed && requested && (
							<form.Field name="reason">
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={!!reasonError}>
											{t(
												"travelExpenses.report.receiptException.reason",
												"Why is the receipt missing?",
											)}
										</TFormLabel>
										<TFormControl hasError={!!reasonError}>
											<Textarea
												name="receiptExceptionReason"
												rows={3}
												maxLength={MAX_RECEIPT_EXCEPTION_REASON_LENGTH}
												value={field.state.value}
												onChange={(event) => field.handleChange(event.target.value)}
												onBlur={() => {
													field.handleBlur();
													setReasonLeft(true);
												}}
											/>
										</TFormControl>
										<TFormDescription>
											{t(
												"travelExpenses.report.receiptException.reasonDescription",
												"Your reviewer sees this explanation and must accept it to approve the report.",
											)}
										</TFormDescription>
										<TFormMessage>{reasonError}</TFormMessage>
									</TFormItem>
								)}
							</form.Field>
						)}
						<DraftSaveStatus
							state={shownState}
							onRetry={() => saver.retry()}
							onKeepMine={() => saver.resolveConflict("keep_mine")}
							onUseTheirs={() => {
								const theirs = state.conflict?.item;
								saver.resolveConflict("use_theirs");
								if (theirs) {
									lastSavedReason.current = theirs.reason;
									form.reset(toValues(theirs), { keepDefaultValues: true });
									onContextChange(contextOf(toValues(theirs), allowed));
								}
								void onSaved();
							}}
						/>
					</section>
				)
			}
		</form.Subscribe>
	);
}
