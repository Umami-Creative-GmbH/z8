"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { Textarea } from "@/components/ui/textarea";
import { useBalanceAdjustmentErrorMessage } from "./use-balance-adjustment-error";
import { useBalanceFormRequest } from "./use-balance-form-request";
import { BalanceAdjustmentActionError } from "./use-employee-work-balance";

export interface CancelBalanceAdjustmentPanelProps {
	/** The adjustment to cancel, described for the panel; null closes it. */
	adjustment: { id: string; summary: string } | null;
	onOpenChange: (open: boolean) => void;
	onCancelAdjustment: (input: { adjustmentId: string; reason: string }) => Promise<unknown>;
}

/**
 * Cancels a balance adjustment with a reason (#993). The adjustment stays in
 * the history, marked as cancelled, and no longer counts.
 */
export function CancelBalanceAdjustmentPanel({
	adjustment,
	onOpenChange,
	onCancelAdjustment,
}: CancelBalanceAdjustmentPanelProps) {
	const { t } = useTranslate();
	const request = useBalanceFormRequest();
	const [failure, setFailure] = useState<string | null>(null);
	const errorMessage = useBalanceAdjustmentErrorMessage();
	const form = useForm({
		onSubmitInvalid: () => {
			document.querySelector<HTMLElement>('[role="dialog"] [aria-invalid="true"]')?.focus();
		},
		defaultValues: { reason: "" },
		onSubmit: async ({ value }) => {
			const token = request.begin();
			if (!token) return;
			setFailure(null);
			if (!adjustment) {
				request.finish(token);
				return;
			}
			try {
				await onCancelAdjustment({ adjustmentId: adjustment.id, reason: value.reason });
			} catch (error) {
				if (!request.current(token)) return;
				request.finish(token);
				setFailure(
					error instanceof BalanceAdjustmentActionError
						? errorMessage(error.code, { closedMonth: error.closedMonth })
						: errorMessage(null),
				);
				return;
			}
			if (!request.current(token)) return;
			request.finish(token);
			toast.success(
				t("settings.employees.workBalance.adjustmentCancelled", "Adjustment cancelled"),
			);
			form.reset({ reason: "" });
			onOpenChange(false);
		},
	});

	function handleOpenChange(nextOpen: boolean) {
		if (request.pending()) return;
		if (!nextOpen) {
			setFailure(null);
			form.reset({ reason: "" });
		}
		onOpenChange(nextOpen);
	}

	return (
		<ActionPanel open={adjustment !== null} onOpenChange={handleOpenChange}>
			<ActionPanelContent
				size="compact"
				onEscapeKeyDown={(event) => {
					if (request.pending()) event.preventDefault();
				}}
				onInteractOutside={(event) => {
					if (request.pending()) event.preventDefault();
				}}
			>
				<form
					className="flex min-h-0 flex-1 flex-col"
					noValidate
					onInvalid={(event) => {
						event.preventDefault();
					}}
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void form.handleSubmit();
					}}
				>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.employees.workBalance.cancelTitle", "Cancel adjustment")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.employees.workBalance.cancelDescription",
								"{summary}. It stays in the history as cancelled and no longer counts toward the work balance.",
								{ summary: adjustment?.summary ?? "" },
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>

					<ActionPanelBody className="space-y-4">
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

						{failure ? (
							<p role="alert" className="text-sm text-destructive">
								{failure}
							</p>
						) : null}
					</ActionPanelBody>

					<ActionPanelFooter>
						<form.Subscribe<boolean> selector={(state) => state.isSubmitting}>
							{(isSubmitting: boolean) => (
								<>
									<Button
										type="button"
										variant="outline"
										disabled={isSubmitting}
										onClick={() => handleOpenChange(false)}
									>
										{t("settings.employees.workBalance.keepAdjustment", "Keep adjustment")}
									</Button>
									<Button type="submit" variant="destructive" disabled={isSubmitting}>
										{isSubmitting ? (
											<IconLoader2
												className="size-4 animate-spin motion-reduce:animate-none"
												aria-hidden="true"
											/>
										) : null}
										{t("settings.employees.workBalance.cancelSubmit", "Cancel adjustment")}
									</Button>
								</>
							)}
						</form.Subscribe>
					</ActionPanelFooter>
				</form>
			</ActionPanelContent>
		</ActionPanel>
	);
}
