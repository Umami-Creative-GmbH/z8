"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useRef, useState, useTransition } from "react";
import { saveApprovalTriageSettingsAction } from "@/app/[locale]/(app)/settings/approval-policies/triage-actions";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import type { ApprovalTriagePolicy } from "@/lib/approvals/triage-policy-config";

export function ApprovalTriageSettingsForm({
	policy,
}: {
	policy: ApprovalTriagePolicy;
}) {
	const { t } = useTranslate();
	const [message, setMessage] = useState<{
		success: boolean;
		text: string;
	} | null>(null);
	const [pending, startTransition] = useTransition();
	const formElement = useRef<HTMLFormElement>(null);
	const form = useForm({
		defaultValues: {
			staleAfterHours: String(policy.staleAfterHours),
			smallCorrectionMinutes: String(policy.smallCorrectionMinutes),
		},
		onSubmitInvalid: ({ formApi }) => {
			const name = (
				["staleAfterHours", "smallCorrectionMinutes"] as const
			).find((field) => formApi.getFieldMeta(field)?.errors.length);
			if (name)
				formElement.current
					?.querySelector<HTMLInputElement>(`input[name="${name}"]`)
					?.focus();
		},
		onSubmit: async ({ value }) => {
			setMessage(null);
			try {
				const result = await saveApprovalTriageSettingsAction({
					staleAfterHours: Number(value.staleAfterHours),
					smallCorrectionMinutes: Number(value.smallCorrectionMinutes),
				});
				if (!result.success) {
					setMessage({ success: false, text: result.error });
					return;
				}
				setMessage({
					success: true,
					text: t("settings.approvalTriage.saved", "Triage settings saved."),
				});
			} catch {
				setMessage({
					success: false,
					text: t(
						"settings.approvalTriage.saveError",
						"Unable to save triage settings. Please try again.",
					),
				});
			}
		},
	});
	const staleError = t(
		"settings.approvalTriage.staleError",
		"Enter a whole number from 1 to 720 hours.",
	);
	const correctionError = t(
		"settings.approvalTriage.correctionError",
		"Enter a whole number from 0 to 60 minutes.",
	);
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.approvalTriage.title", "Approval triage")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.approvalTriage.description",
						"Set when pending requests need attention and which small time corrections may use the fast lane. Risk rules and evidence requirements remain fixed.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					ref={formElement}
					noValidate
					className="space-y-6"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						startTransition(() => form.handleSubmit());
					}}
				>
					<fieldset
						aria-busy={pending}
						className="grid min-w-0 gap-6 sm:grid-cols-2"
					>
						<legend className="sr-only">
							{t("settings.approvalTriage.thresholds", "Triage thresholds")}
						</legend>
						<form.Field
							name="staleAfterHours"
							validators={{
								onChange: ({ value }) =>
									value.trim() !== "" &&
									Number.isInteger(Number(value)) &&
									Number(value) >= 1 &&
									Number(value) <= 720
										? undefined
										: staleError,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t(
											"settings.approvalTriage.staleLabel",
											"Stale after (hours)",
										)}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											type="number"
											autoComplete="off"
											readOnly={pending}
											name={field.name}
											min={1}
											max={720}
											step={1}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.approvalTriage.staleHelp",
											"Pending requests become stale after this many elapsed hours (1–720). Weekends and daylight-saving changes do not pause the clock.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
						<form.Field
							name="smallCorrectionMinutes"
							validators={{
								onChange: ({ value }) =>
									value.trim() !== "" &&
									Number.isInteger(Number(value)) &&
									Number(value) >= 0 &&
									Number(value) <= 60
										? undefined
										: correctionError,
							}}
						>
							{(field) => (
								<TFormItem>
									<TFormLabel hasError={fieldHasError(field)}>
										{t(
											"settings.approvalTriage.correctionLabel",
											"Small correction limit (minutes)",
										)}
									</TFormLabel>
									<TFormControl hasError={fieldHasError(field)}>
										<Input
											type="number"
											autoComplete="off"
											readOnly={pending}
											name={field.name}
											min={0}
											max={60}
											step={1}
											value={field.state.value}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.approvalTriage.correctionHelp",
											"Zero disables the small-correction fast lane, including zero-delta edits. Otherwise use 1–60 minutes; all required evidence must still be verified.",
										)}
									</TFormDescription>
									<TFormMessage field={field} />
								</TFormItem>
							)}
						</form.Field>
					</fieldset>
					{message ? (
						<p
							role={message.success ? "status" : "alert"}
							className={
								message.success
									? "text-sm text-muted-foreground"
									: "text-sm text-destructive"
							}
						>
							{message.text}
						</p>
					) : null}
					<Button type="submit" disabled={pending}>
						{pending ? (
							<IconLoader2
								aria-hidden="true"
								className="size-4 animate-spin motion-reduce:animate-none"
							/>
						) : null}
						{t("settings.approvalTriage.save", "Save triage settings")}
					</Button>
				</form>
			</CardContent>
		</Card>
	);
}
