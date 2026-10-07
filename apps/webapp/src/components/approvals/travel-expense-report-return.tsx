"use client";

import { IconAlertTriangle, IconArrowBackUp, IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { getTravelExpenseReportSubmission } from "@/app/[locale]/(app)/travel-expenses/report-actions";
import { returnTravelExpenseReportAction } from "@/app/[locale]/(app)/travel-expenses/report-review-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { queryKeys } from "@/lib/query/keys";
import type { SubmittedReportView } from "@/lib/travel-expenses/report-read";
import {
	RETURN_ITEM_COMMENT_MAX_LENGTH,
	RETURN_NOTE_MAX_LENGTH,
} from "@/lib/travel-expenses/report-return";

type Translate = ReturnType<typeof useTranslate>["t"];

/**
 * Returns a submitted travel expense report for changes from the Approvals
 * inbox (#603): a required note for the employee and optional comments on the
 * submitted expenses that need correcting. The whole report goes back; there
 * is no partial approval.
 */
export function TravelExpenseReportReturnButton({
	approvalId,
	reportId,
	disabled,
	onReturned,
}: {
	approvalId: string;
	reportId: string;
	disabled: boolean;
	onReturned: () => void;
}) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	return (
		<>
			<Button
				type="button"
				variant="outline"
				className="flex-1"
				onClick={() => setOpen(true)}
				disabled={disabled}
			>
				<IconArrowBackUp className="mr-2 size-4" aria-hidden="true" />
				{t("approvals:approvals.returnReport", "Return")}
			</Button>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>
							{t("approvals:approvals.returnReportTitle", "Return report for changes")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"approvals:approvals.returnReportDescription",
								"The employee can correct the report and submit it again. This submission, your note and comments stay in its history.",
							)}
						</DialogDescription>
					</DialogHeader>
					{open && (
						<ReturnFormLoader
							approvalId={approvalId}
							reportId={reportId}
							onCancel={() => setOpen(false)}
							onReturned={() => {
								setOpen(false);
								onReturned();
							}}
						/>
					)}
				</DialogContent>
			</Dialog>
		</>
	);
}

function ReturnFormLoader({
	approvalId,
	reportId,
	onCancel,
	onReturned,
}: {
	approvalId: string;
	reportId: string;
	onCancel: () => void;
	onReturned: () => void;
}) {
	const { t } = useTranslate();
	const { data, isError, isFetching, refetch } = useQuery({
		queryKey: queryKeys.travelExpenses.reportSubmission(reportId),
		queryFn: async (): Promise<SubmittedReportView> => {
			const result = await getTravelExpenseReportSubmission(reportId);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	if (isError && !data) {
		return (
			<Alert variant="destructive">
				<IconAlertTriangle aria-hidden="true" className="size-4" />
				<AlertDescription className="space-y-2">
					<p>
						{t(
							"approvals:approvals.returnReportLoadFailed",
							"Unable to load the submitted report. Please retry.",
						)}
					</p>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onClick={() => void refetch()}
						disabled={isFetching}
					>
						{t("approvals:approvals.retry", "Retry")}
					</Button>
				</AlertDescription>
			</Alert>
		);
	}
	if (!data) {
		return (
			<div role="status">
				<p className="sr-only">
					{t("approvals:approvals.returnReportLoading", "Loading the submitted report…")}
				</p>
				<Skeleton aria-hidden="true" className="h-40 w-full" />
			</div>
		);
	}
	return (
		<ReturnForm
			approvalId={approvalId}
			items={data.facts.items.map((item, index) => ({
				itemId: item.itemId,
				number: index + 1,
				description: item.description,
			}))}
			onCancel={onCancel}
			onReturned={onReturned}
		/>
	);
}

/** The translated outcome of a refused return; the server's text is a diagnostic only. */
function returnFailureMessage(t: Translate, code: string | undefined): string {
	switch (code) {
		case "conflict":
			return t(
				"approvals:approvals.returnReportConflict",
				"This report was decided, returned or changed meanwhile. Reload it to see its current state.",
			);
		case "invalid":
			return t(
				"approvals:approvals.returnReportInvalid",
				"Check the note and comments: a note is required and each text must fit its limit.",
			);
		case "not_found":
			return t(
				"approvals:approvals.returnReportNotFound",
				"This report is no longer yours to review.",
			);
		default:
			return t(
				"approvals:approvals.returnReportFailed",
				"The report could not be returned. Please retry.",
			);
	}
}

function noteError(t: Translate, value: string): string | undefined {
	if (!value.trim()) {
		return t("approvals:approvals.returnNoteRequired", "Tell the employee what to change.");
	}
	if (value.trim().length > RETURN_NOTE_MAX_LENGTH) {
		return t("approvals:approvals.returnNoteTooLong", "Keep the note under {max} characters.", {
			max: RETURN_NOTE_MAX_LENGTH,
		});
	}
	return undefined;
}

function ReturnForm({
	approvalId,
	items,
	onCancel,
	onReturned,
}: {
	approvalId: string;
	items: Array<{ itemId: string; number: number; description: string }>;
	onCancel: () => void;
	onReturned: () => void;
}) {
	const { t } = useTranslate();
	const [failure, setFailure] = useState<string | null>(null);
	const form = useForm({
		defaultValues: {
			note: "",
			comments: items.map((item) => ({ itemId: item.itemId, body: "" })),
		},
		onSubmit: async ({ value }) => {
			setFailure(null);
			const result = await returnTravelExpenseReportAction({
				approvalId,
				note: value.note,
				itemComments: value.comments,
			});
			if (!result.success) {
				setFailure(returnFailureMessage(t, result.code));
				return;
			}
			toast.success(t("approvals:approvals.reportReturned", "Report returned for changes"));
			onReturned();
		},
	});

	return (
		<form
			className="space-y-4"
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="note"
				validators={{
					onSubmit: ({ value }) => noteError(t, value),
					onChange: ({ value }) =>
						value.trim().length > RETURN_NOTE_MAX_LENGTH ? noteError(t, value) : undefined,
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)} required>
							{t("approvals:approvals.returnNote", "Note to the employee")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Textarea
								value={field.state.value}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								rows={3}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			{items.length > 0 && (
				<fieldset className="space-y-3">
					<legend className="text-sm font-medium">
						{t("approvals:approvals.returnItemComments", "Comments on expenses (optional)")}
					</legend>
					{items.map((item, index) => (
						<form.Field
							key={item.itemId}
							name={`comments[${index}].body`}
							validators={{
								onChange: ({ value }) =>
									value.trim().length > RETURN_ITEM_COMMENT_MAX_LENGTH
										? t(
												"approvals:approvals.returnCommentTooLong",
												"Keep the comment under {max} characters.",
												{ max: RETURN_ITEM_COMMENT_MAX_LENGTH },
											)
										: undefined,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t("approvals:approvals.returnItemLabel", "Expense {number}", {
											number: item.number,
										})}
									</TFormLabel>
									<TFormDescription className="line-clamp-2">{item.description}</TFormDescription>
									<TFormControl hasError={fieldHasError(field)}>
										<Textarea
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											onBlur={field.handleBlur}
											rows={2}
										/>
									</TFormControl>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					))}
				</fieldset>
			)}

			{failure && (
				<Alert variant="destructive">
					<IconAlertTriangle aria-hidden="true" className="size-4" />
					<AlertDescription>{failure}</AlertDescription>
				</Alert>
			)}

			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(isSubmitting) => (
					<DialogFooter>
						<Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" disabled={isSubmitting}>
							{isSubmitting ? (
								<IconLoader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
							) : (
								<IconArrowBackUp className="mr-2 size-4" aria-hidden="true" />
							)}
							{t("approvals:approvals.confirmReturn", "Return for changes")}
						</Button>
					</DialogFooter>
				)}
			</form.Subscribe>
		</form>
	);
}
