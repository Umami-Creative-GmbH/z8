"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { updateAutoClockOutSettings } from "@/app/[locale]/(app)/settings/organizations/auto-clock-out-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import { parseAutoClockOutDuration } from "@/lib/time-tracking/automatic-clock-out/policy";
import type { AutoClockOutSettings } from "@/lib/time-tracking/automatic-clock-out/types";
import { useRouter } from "@/navigation";

interface OrganizationAutoClockOutCardProps {
	organizationId: string;
	settings: AutoClockOutSettings;
	currentMemberRole: "owner" | "admin" | "member";
}

function durationFromFields(hours: string, minutes: string) {
	if (!hours.trim() || !minutes.trim()) throw new RangeError("Missing duration");
	return parseAutoClockOutDuration(Number(hours), Number(minutes));
}

export function OrganizationAutoClockOutCard({
	organizationId,
	settings,
	currentMemberRole,
}: OrganizationAutoClockOutCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const helpId = useId();
	const errorId = useId();
	const submitting = useRef(false);
	const [feedback, setFeedback] = useState<{
		error: boolean;
		message: string;
	} | null>(null);
	const canEdit = currentMemberRole === "owner" || currentMemberRole === "admin";
	const invalidDuration = t(
		"organization.autoClockOut.invalidDuration",
		"Enter a valid duration: whole hours and 0–59 minutes, totaling at least one minute.",
	);
	const form = useForm({
		defaultValues: {
			autoClockOutEnabled: settings.autoClockOutEnabled,
			hours: String(Math.floor(settings.maxUninterruptedMinutes / 60)),
			minutes: String(settings.maxUninterruptedMinutes % 60),
		},
		validators: {
			onSubmit: ({ value }) => {
				try {
					durationFromFields(value.hours, value.minutes);
				} catch {
					return invalidDuration;
				}
			},
		},
		onSubmit: async ({ value }) => {
			if (!canEdit || submitting.current) return;
			submitting.current = true;
			setFeedback(null);
			try {
				const result = await updateAutoClockOutSettings({
					organizationId,
					autoClockOutEnabled: value.autoClockOutEnabled,
					maxUninterruptedMinutes: durationFromFields(value.hours, value.minutes),
				});
				if (!result.success) {
					setFeedback({ error: true, message: result.error });
					toast.error(result.error);
				} else {
					const message = t(
						"organization.autoClockOut.saved",
						"Automatic clock-out settings saved",
					);
					setFeedback({ error: false, message });
					toast.success(message);
					router.refresh();
				}
			} catch {
				const message = t(
					"organization.autoClockOut.saveFailed",
					"Failed to update automatic clock-out settings",
				);
				setFeedback({ error: true, message });
				toast.error(message);
			}
			submitting.current = false;
		},
	});

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.autoClockOut.title", "Automatic clock-out")}</CardTitle>
				<CardDescription>
					{t(
						"organization.autoClockOut.description",
						"Set the maximum duration of uninterrupted live work. Employees are automatically clocked out at this limit.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					noValidate
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<form.Subscribe
						selector={(state) =>
							[state.values.autoClockOutEnabled, state.isSubmitting, state.errors] as const
						}
					>
						{([enabled, pending, errors]) => (
							<div className="space-y-4">
								<form.Field name="autoClockOutEnabled">
									{(field) => (
										<TFormItem className="flex items-center justify-between gap-4">
											<TFormLabel>
												{t("organization.autoClockOut.enabled", "Automatic clock-out")}
											</TFormLabel>
											<TFormControl aria-describedby={helpId}>
												<Switch
													checked={field.state.value}
													onCheckedChange={field.handleChange}
													disabled={!canEdit || pending}
												/>
											</TFormControl>
										</TFormItem>
									)}
								</form.Field>
								<div className="grid max-w-sm grid-cols-2 gap-4">
									<form.Field name="hours">
										{(field) => (
											<TFormItem>
												<TFormLabel>{t("organization.autoClockOut.hours", "Hours")}</TFormLabel>
												<TFormControl
													hasError={errors.length > 0}
													aria-describedby={errors.length > 0 ? `${helpId} ${errorId}` : helpId}
												>
													<Input
														type="number"
														min={0}
														step={1}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														disabled={!canEdit || !enabled || pending}
													/>
												</TFormControl>
											</TFormItem>
										)}
									</form.Field>
									<form.Field name="minutes">
										{(field) => (
											<TFormItem>
												<TFormLabel>{t("organization.autoClockOut.minutes", "Minutes")}</TFormLabel>
												<TFormControl
													hasError={errors.length > 0}
													aria-describedby={errors.length > 0 ? `${helpId} ${errorId}` : helpId}
												>
													<Input
														type="number"
														min={0}
														max={59}
														step={1}
														value={field.state.value}
														onChange={(event) => field.handleChange(event.target.value)}
														onBlur={field.handleBlur}
														disabled={!canEdit || !enabled || pending}
													/>
												</TFormControl>
											</TFormItem>
										)}
									</form.Field>
								</div>
								<p id={helpId} className="text-sm text-muted-foreground">
									{t(
										"organization.autoClockOut.help",
										"A recorded break or new clock-in resets the allowance. Changes apply to work already in progress. Checks run every five minutes; clock-out is recorded at the limit, even if the check runs later. Employees always receive an inbox notification.",
									)}
								</p>
								{!canEdit && (
									<p className="text-sm text-muted-foreground">
										{t(
											"organization.autoClockOut.adminOnly",
											"Only organization admins and owners can change these settings.",
										)}
									</p>
								)}
								{errors.length > 0 ? (
									<p id={errorId} role="alert" className="text-sm text-destructive">
										{String(errors[0])}
									</p>
								) : (
									feedback && (
										<p
											role={feedback.error ? "alert" : "status"}
											className={
												feedback.error
													? "text-sm text-destructive"
													: "text-sm text-muted-foreground"
											}
										>
											{feedback.message}
										</p>
									)
								)}
								<Button type="submit" disabled={!canEdit || pending}>
									{pending && (
										<IconLoader2 aria-hidden="true" className="mr-2 size-4 animate-spin" />
									)}
									{pending
										? t("organization.autoClockOut.saving", "Saving…")
										: t("organization.autoClockOut.save", "Save changes")}
								</Button>
							</div>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}
