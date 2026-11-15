"use client";

import { IconLoader2, IconX } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef } from "react";
import { Button } from "@/components/ui/button";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { Textarea } from "@/components/ui/textarea";

/** The caller keeps the reason's lifetime and the current decision authority. */
export function ApprovalReasonForm({
	reason,
	onReasonChange,
	onCancel,
	onConfirm,
	canReject,
	isPending,
}: {
	reason: string;
	onReasonChange: (reason: string) => void;
	onCancel: () => void;
	onConfirm: () => void | Promise<void>;
	canReject: boolean;
	isPending: boolean;
}) {
	const { t } = useTranslate();
	const submitting = useRef(false);
	const defaults = useRef({ reason });
	const form = useForm({
		defaultValues: defaults.current,
		onSubmit: async () => {
			if (!canReject || isPending || submitting.current) return;
			submitting.current = true;
			try {
				await onConfirm();
			} finally {
				submitting.current = false;
			}
		},
	});
	return (
		<form
			className="w-full space-y-4"
			aria-busy={isPending}
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field
				name="reason"
				validators={{
					onChange: ({ value }) =>
						value.trim()
							? undefined
							: t("approvals:approvals.reasonRequired", "A reason is required"),
				}}
			>
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("approvals:approvals.rejectionReason", "Reason for rejection")}
						</TFormLabel>
						<TFormControl>
							<Textarea
								name="reason"
								autoComplete="off"
								required
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => {
									field.handleChange(event.target.value);
									onReasonChange(event.target.value);
								}}
								disabled={isPending}
								rows={4}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={isPending}
				>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button
					type="submit"
					variant="destructive"
					disabled={!canReject || !reason.trim() || isPending}
				>
					{isPending ? (
						<IconLoader2
							className="mr-2 size-4 animate-spin"
							aria-hidden="true"
						/>
					) : (
						<IconX className="mr-2 size-4" aria-hidden="true" />
					)}
					{t("approvals:approvals.confirmReject", "Confirm Rejection")}
				</Button>
			</div>
		</form>
	);
}
