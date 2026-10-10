"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { useBalanceAdjustmentErrorMessage } from "./use-balance-adjustment-error";
import { BalanceAdjustmentActionError } from "./use-employee-work-balance";

/**
 * Cancels a balance adjustment with a reason (#993). The adjustment stays in
 * the history, marked as cancelled, and no longer counts.
 */
export function CancelBalanceAdjustmentDialog({
	adjustment,
	onOpenChange,
	onCancelAdjustment,
}: {
	/** The adjustment to cancel, described for the dialog; null closes it. */
	adjustment: { id: string; summary: string } | null;
	onOpenChange: (open: boolean) => void;
	onCancelAdjustment: (input: { adjustmentId: string; reason: string }) => Promise<unknown>;
}) {
	const { t } = useTranslate();
	const errorMessage = useBalanceAdjustmentErrorMessage();
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			if (!adjustment) return;
			try {
				await onCancelAdjustment({ adjustmentId: adjustment.id, reason: value.reason });
			} catch (error) {
				toast.error(
					error instanceof BalanceAdjustmentActionError
						? errorMessage(error.code, { closedMonth: error.closedMonth })
						: errorMessage(null),
				);
				return;
			}
			toast.success(
				t("settings.employees.workBalance.adjustmentCancelled", "Adjustment cancelled"),
			);
			form.reset({ reason: "" });
			onOpenChange(false);
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (!nextOpen) form.reset({ reason: "" });
		onOpenChange(nextOpen);
	}

	return (
		<Dialog open={adjustment !== null} onOpenChange={handleOpenChange}>
			<DialogContent>
				<form
					className="grid gap-4"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<DialogHeader>
						<DialogTitle>
							{t("settings.employees.workBalance.cancelTitle", "Cancel adjustment")}
						</DialogTitle>
						<DialogDescription>
							{t(
								"settings.employees.workBalance.cancelDescription",
								"{summary}. It stays in the history as cancelled and no longer counts toward the work balance.",
								{ summary: adjustment?.summary ?? "" },
							)}
						</DialogDescription>
					</DialogHeader>

					<form.Field
						name="reason"
						validators={{
							onChange: ({ value }) =>
								value.trim()
									? undefined
									: t("settings.employees.workBalance.errors.reasonRequired", "Enter a reason."),
						}}
					>
						{(field) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)} required>
									{t("settings.employees.workBalance.cancellationReason", "Why is it cancelled?")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<Textarea
										name="reason"
										autoComplete="off"
										rows={3}
										maxLength={1000}
										value={field.state.value}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>

					<DialogFooter>
						<Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
							{t("settings.employees.workBalance.keepAdjustment", "Keep adjustment")}
						</Button>
						<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
							{(isSubmitting: boolean) => (
								<Button type="submit" variant="destructive" disabled={isSubmitting}>
									{isSubmitting ? (
										<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
									) : null}
									{t("settings.employees.workBalance.cancelSubmit", "Cancel adjustment")}
								</Button>
							)}
						</form.Subscribe>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
