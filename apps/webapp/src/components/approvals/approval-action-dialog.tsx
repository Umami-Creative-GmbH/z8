"use client";

import { ClientForm } from "@/components/ui/client-form";
import { IconCheck, IconLoader2, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";

interface ApprovalActionDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	action: "approve" | "reject";
	title: string;
	description: string;
	onConfirm: (reason?: string) => Promise<void>;
}

export function ApprovalActionDialog({
	open,
	onOpenChange,
	action,
	title,
	description,
	onConfirm,
}: ApprovalActionDialogProps) {
	const { t } = useTranslate();
	const [loading, setLoading] = useState(false);
	const pending = useRef(false);
	const reasonInput = useRef<HTMLTextAreaElement>(null);
	const [error, setError] = useState<string | null>(null);
	const formId = useId();
	const form = useForm({
		defaultValues: { reason: "" },
		onSubmitInvalid: () => reasonInput.current?.focus(),
		onSubmit: async ({ value }) => {
			if (pending.current) return;
			pending.current = true;
			setLoading(true);
			setError(null);
			try {
				await onConfirm(action === "reject" ? value.reason : undefined);
				onOpenChange(false);
				form.reset();
			} catch (failure) {
				setError(
					failure instanceof Error
						? failure.message
						: t(
								"approvals:approvals.decisionFailed",
								"The decision could not be saved. Try again.",
							),
				);
			}
			pending.current = false;
			setLoading(false);
		},
	});

	function submitForm() {
		if (!pending.current) void form.handleSubmit();
	}

	return (
		<ActionPanel
			open={open}
			onOpenChange={(nextOpen) => {
				if (!pending.current) onOpenChange(nextOpen);
			}}
		>
			<ActionPanelContent
				showCloseButton={!loading}
				onEscapeKeyDown={(event) => {
					if (pending.current) event.preventDefault();
				}}
				onPointerDownOutside={(event) => {
					if (pending.current) event.preventDefault();
				}}
			>
				<ActionPanelHeader>
					<ActionPanelTitle>{title}</ActionPanelTitle>
					<ActionPanelDescription>{description}</ActionPanelDescription>
				</ActionPanelHeader>

				<ActionPanelBody>
					<ClientForm
						id={formId}
						noValidate
						aria-busy={loading}
						stopPropagation onSubmit={submitForm}
					>
						{action === "reject" && (
							<form.Field
								name="reason"
								validators={{
									onSubmit: ({ value }) =>
										action === "reject" && !value.trim()
											? t(
													"approvals:approvals.rejectionReasonRequired",
													"Please provide a reason for rejection",
												)
											: undefined,
								}}
							>
								{(field) => (
									<TFormItem>
										<TFormLabel hasError={field.state.meta.errors.length > 0}>
											{t(
												"approvals:approvals.rejectionReasonRequiredLabel",
												"Reason for rejection *",
											)}
										</TFormLabel>
										<TFormControl hasError={field.state.meta.errors.length > 0}>
											<Textarea
												ref={reasonInput}
												name={field.name}
												autoComplete="off"
												placeholder={t(
													"approvals:approvals.rejectionReasonClearPlaceholder",
													"Provide a clear reason for rejecting this request...",
												)}
												value={field.state.value}
												onChange={(e) => field.handleChange(e.target.value)}
												onBlur={field.handleBlur}
												disabled={loading}
												rows={4}
												required
											/>
										</TFormControl>
										<TFormMessage field={field} />
									</TFormItem>
								)}
							</form.Field>
						)}
						{error ? (
							<p role="alert" className="mt-4 text-sm text-destructive">
								{error}
							</p>
						) : null}
					</ClientForm>

					{action === "approve" && (
						<p className="text-sm text-muted-foreground">
							{t(
								"approvals:approvals.approveActionNotice",
								"This action will approve the request and notify the employee.",
							)}
						</p>
					)}
				</ActionPanelBody>

				<ActionPanelFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => onOpenChange(false)}
						disabled={loading}
					>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button
						type="submit"
						form={formId}
						variant={action === "approve" ? "default" : "destructive"}
						disabled={loading}
					>
						{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
						{action === "approve" ? (
							<>
								<IconCheck className="mr-2 size-4" />
								{t("approvals:approvals.approve", "Approve")}
							</>
						) : (
							<>
								<IconX className="mr-2 size-4" />
								{t("approvals:approvals.reject", "Reject")}
							</>
						)}
					</Button>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}
