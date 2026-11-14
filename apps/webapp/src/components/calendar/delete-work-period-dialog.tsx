"use client";

import {
	IconAlertTriangle,
	IconLoader2,
	IconTrash,
	IconX,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { requestTimeEntryDeletion } from "@/app/[locale]/(app)/time-tracking/actions/corrections";
import {
	AlertDialog,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import type { CalendarEvent } from "@/lib/calendar/types";
import { instantFromDate } from "@/lib/datetime/temporal-core";
import {
	type DisplayContext,
	formatInstant,
} from "@/lib/datetime/temporal-format";
import {
	formatDuration,
	getWorkPeriodDialogMetadata,
} from "./work-period-dialog-utils";

interface DeleteWorkPeriodDialogProps {
	event: CalendarEvent;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onDeleteComplete?: () => void;
	displayContext: DisplayContext;
}

export function DeleteWorkPeriodDialog({
	event,
	open,
	onOpenChange,
	onDeleteComplete,
	displayContext,
}: DeleteWorkPeriodDialogProps) {
	const { t } = useTranslate();
	const reasonRef = useRef<HTMLTextAreaElement>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const submissionIdRef = useRef<string | null>(null);
	const submissionPending = useRef(false);

	useEffect(() => {
		if (!open) submissionIdRef.current = null;
	}, [open]);

	// Get metadata with defaults
	const metadata = getWorkPeriodDialogMetadata(event);

	const handleOpenChange = (nextOpen: boolean) => {
		if (isDeleting) return;
		if (!nextOpen) {
			form.reset();
			setSubmitError(null);
			submissionIdRef.current = null;
		}

		onOpenChange(nextOpen);
	};

	const form = useForm({
		defaultValues: { reason: "" },
		onSubmitInvalid: () => reasonRef.current?.focus(),
		onSubmit: async ({ value }) => {
			if (submissionPending.current) return;
			submissionPending.current = true;
			const trimmedReason = value.reason.trim();
			setIsDeleting(true);
			setSubmitError(null);
			const submissionId =
				submissionIdRef.current ?? globalThis.crypto.randomUUID();
			submissionIdRef.current = submissionId;
			const result = await requestTimeEntryDeletion({
				workPeriodId: event.id,
				submissionId,
				reason: trimmedReason,
			}).catch(() => null);

			if (!result) {
				setSubmitError(
					t("calendar.delete.failed", "Failed to delete work period"),
				);
				toast.error(
					t("calendar.delete.failed", "Failed to delete work period"),
				);
			} else if (result.success) {
				submissionIdRef.current = null;
				toast.success(
					result.data.status === "approved"
						? t("calendar.delete.applied", "Time entry deletion applied")
						: t(
								"calendar.delete.success",
								"Deletion request submitted for manager approval",
							),
				);
				onDeleteComplete?.();
				form.reset();
				onOpenChange(false);
			} else {
				setSubmitError(
					result.error ||
						t("calendar.delete.failed", "Failed to delete work period"),
				);
				toast.error(
					result.error ||
						t("calendar.delete.failed", "Failed to delete work period"),
				);
			}

			setIsDeleting(false);
			submissionPending.current = false;
		},
	});

	return (
		<AlertDialog
			open={open}
			onOpenChange={(nextOpen, details) => {
				if (!nextOpen && isDeleting) {
					details.cancel();
					return;
				}
				handleOpenChange(nextOpen);
			}}
		>
			<AlertDialogContent>
				<form
					noValidate
					aria-busy={isDeleting}
					className="grid gap-4"
					onSubmit={(submitEvent) => {
						submitEvent.preventDefault();
						if (isDeleting) return;
						void form.handleSubmit();
					}}
				>
					<AlertDialogHeader>
						<div className="flex items-center gap-2 text-destructive">
							<IconAlertTriangle className="size-5" aria-hidden="true" />
							<AlertDialogTitle>
								{t("calendar.delete.requestTitle", "Request deletion?")}
							</AlertDialogTitle>
						</div>
						<AlertDialogDescription>
							{t(
								"calendar.delete.requestDescription",
								"This will hide the time entry after manager approval. The audit history and time-entry chain will be preserved.",
							)}
						</AlertDialogDescription>

						<div className="space-y-3 text-sm">
							<div className="rounded-lg bg-muted p-3 space-y-1">
								<div className="font-medium">
									{formatInstant(
										instantFromDate(event.date),
										displayContext,
										"dateMedium",
									)}
								</div>
								<div className="text-sm">
									{formatInstant(
										instantFromDate(event.date),
										displayContext,
										"time",
									)}{" "}
									-{" "}
									{event.endDate
										? formatInstant(
												instantFromDate(event.endDate),
												displayContext,
												"time",
											)
										: "—"}
									<span className="ml-2 text-muted-foreground">
										({formatDuration(metadata.durationMinutes)})
									</span>
								</div>
								{metadata.notes && (
									<div className="text-sm text-muted-foreground mt-2 border-t pt-2">
										{metadata.notes}
									</div>
								)}
							</div>

							<form.Field
								name="reason"
								validators={{
									onChange: ({ value }) =>
										value.trim()
											? undefined
											: t(
													"calendar.delete.reasonRequired",
													"Reason is required",
												),
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel required hasError={fieldHasError(field)}>
											{t("calendar.delete.reasonLabel", "Reason for deletion")}
										</TFormLabel>
										<TFormControl hasError={fieldHasError(field)}>
											<Textarea
												ref={reasonRef}
												name="deletionReason"
												autoComplete="off"
												aria-label={t(
													"calendar.delete.reasonLabel",
													"Reason for deletion",
												)}
												value={field.state.value}
												onChange={(event) =>
													field.handleChange(event.target.value)
												}
												onBlur={field.handleBlur}
												disabled={isDeleting}
												required
												rows={3}
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
							{submitError && (
								<p role="alert" className="text-sm text-destructive">
									{submitError}
								</p>
							)}

							<p className="text-sm text-muted-foreground">
								{t(
									"calendar.delete.auditNote",
									"Time entries will be marked as deleted for audit purposes.",
								)}
							</p>
						</div>
					</AlertDialogHeader>

					<AlertDialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => handleOpenChange(false)}
							disabled={isDeleting}
						>
							<IconX className="size-4 mr-1" aria-hidden="true" />
							{t("common.cancel", "Cancel")}
						</Button>
						<Button type="submit" variant="destructive" disabled={isDeleting}>
							{isDeleting ? (
								<IconLoader2
									className="size-4 animate-spin mr-1"
									aria-hidden="true"
								/>
							) : (
								<IconTrash className="size-4 mr-1" aria-hidden="true" />
							)}
							{t("calendar.delete.requestConfirm", "Delete entry")}
						</Button>
					</AlertDialogFooter>
				</form>
			</AlertDialogContent>
		</AlertDialog>
	);
}
