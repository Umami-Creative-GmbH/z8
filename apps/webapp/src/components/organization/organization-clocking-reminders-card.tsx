"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { updateClockingReminderSettings } from "@/app/[locale]/(app)/settings/organizations/clocking-reminder-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import {
	CLOCKING_REMINDER_ROLES,
	type ClockingReminderRole,
	type ClockingReminderSettings,
	MAX_CLOCKING_REMINDER_MINUTES,
} from "@/lib/time-tracking/clocking-reminders/settings-policy";
import { useRouter } from "@/navigation";

interface OrganizationClockingRemindersCardProps {
	organizationId: string;
	settings: ClockingReminderSettings;
	currentMemberRole: "owner" | "admin" | "member";
}

/** Whole minutes from 0 to the maximum, or `null`. */
function graceFromField(value: string): number | null {
	if (!/^\d+$/.test(value.trim())) return null;
	const minutes = Number(value);
	return minutes <= MAX_CLOCKING_REMINDER_MINUTES ? minutes : null;
}

export function OrganizationClockingRemindersCard({
	organizationId,
	settings,
	currentMemberRole,
}: OrganizationClockingRemindersCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const helpId = useId();
	const errorId = useId();
	const submitting = useRef(false);
	const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
	const canEdit = currentMemberRole === "owner" || currentMemberRole === "admin";
	const invalidGrace = t(
		"organization.clockingReminders.invalidMinutes",
		"Enter whole minutes from 0 to 1440.",
	);
	const noRoles = t(
		"organization.clockingReminders.noRoles",
		"Choose at least one role that receives reminders.",
	);
	const roleLabels: Record<ClockingReminderRole, string> = {
		admin: t("organization.clockingReminders.roles.admin", "Admins"),
		manager: t("organization.clockingReminders.roles.manager", "Managers"),
		employee: t("organization.clockingReminders.roles.employee", "Employees"),
	};

	const form = useForm({
		defaultValues: {
			missedClockInEnabled: settings.missedClockIn.enabled,
			missedClockInGrace: String(settings.missedClockIn.graceMinutes),
			forgottenClockOutEnabled: settings.forgottenClockOut.enabled,
			forgottenClockOutGrace: String(settings.forgottenClockOut.graceMinutes),
			roles: [...settings.roles] as ClockingReminderRole[],
		},
		validators: {
			onSubmit: ({ value }) => {
				if (
					graceFromField(value.missedClockInGrace) === null ||
					graceFromField(value.forgottenClockOutGrace) === null
				)
					return invalidGrace;
				if (value.roles.length === 0) return noRoles;
			},
		},
		onSubmit: async ({ value }) => {
			if (!canEdit || submitting.current) return;
			submitting.current = true;
			setFeedback(null);
			try {
				const result = await updateClockingReminderSettings({
					organizationId,
					missedClockIn: {
						enabled: value.missedClockInEnabled,
						graceMinutes: graceFromField(value.missedClockInGrace) ?? 0,
					},
					forgottenClockOut: {
						enabled: value.forgottenClockOutEnabled,
						graceMinutes: graceFromField(value.forgottenClockOutGrace) ?? 0,
					},
					roles: CLOCKING_REMINDER_ROLES.filter((role) => value.roles.includes(role)),
				});
				if (!result.success) {
					setFeedback({ error: true, message: result.error });
					toast.error(result.error);
				} else {
					const message = t(
						"organization.clockingReminders.saved",
						"Clocking reminder settings saved",
					);
					setFeedback({ error: false, message });
					toast.success(message);
					router.refresh();
				}
			} catch {
				const message = t(
					"organization.clockingReminders.saveFailed",
					"Failed to update clocking reminder settings",
				);
				setFeedback({ error: true, message });
				toast.error(message);
			}
			submitting.current = false;
		},
	});

	const reminders = [
		{
			enabledField: "missedClockInEnabled",
			graceField: "missedClockInGrace",
			label: t("organization.clockingReminders.missedClockIn.enabled", "Missed clock-in reminder"),
			graceLabel: t(
				"organization.clockingReminders.missedClockIn.grace",
				"Minutes after the expected start",
			),
		},
		{
			enabledField: "forgottenClockOutEnabled",
			graceField: "forgottenClockOutGrace",
			label: t(
				"organization.clockingReminders.forgottenClockOut.enabled",
				"Forgotten clock-out reminder",
			),
			graceLabel: t(
				"organization.clockingReminders.forgottenClockOut.grace",
				"Minutes after the expected end",
			),
		},
	] as const;

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.clockingReminders.title", "Clocking reminders")}</CardTitle>
				<CardDescription>
					{t(
						"organization.clockingReminders.description",
						"Remind employees when they have not clocked in by the start of their published shift, or are still clocked in after it ends.",
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
					<form.Subscribe selector={(state) => [state.isSubmitting, state.errors] as const}>
						{([pending, errors]) => (
							<div className="space-y-6">
								{reminders.map((reminder) => (
									<div key={reminder.enabledField} className="space-y-3">
										<form.Field name={reminder.enabledField}>
											{(field) => (
												<TFormItem className="flex items-center justify-between gap-4">
													<TFormLabel>{reminder.label}</TFormLabel>
													<TFormControl aria-describedby={helpId}>
														<Switch
															checked={field.state.value}
															onCheckedChange={(enabled) => field.handleChange(enabled)}
															disabled={!canEdit || pending}
														/>
													</TFormControl>
												</TFormItem>
											)}
										</form.Field>
										<form.Field name={reminder.graceField}>
											{(field) => (
												<TFormItem className="max-w-xs">
													<TFormLabel>{reminder.graceLabel}</TFormLabel>
													<TFormControl
														hasError={errors.length > 0}
														aria-describedby={errors.length > 0 ? `${helpId} ${errorId}` : helpId}
													>
														<Input
															type="number"
															min={0}
															max={MAX_CLOCKING_REMINDER_MINUTES}
															step={1}
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															disabled={!canEdit || pending}
														/>
													</TFormControl>
												</TFormItem>
											)}
										</form.Field>
									</div>
								))}
								<form.Field name="roles">
									{(field) => (
										<fieldset className="space-y-2">
											<legend className="text-sm font-medium">
												{t("organization.clockingReminders.roles.label", "Remind these roles")}
											</legend>
											<div className="flex flex-wrap gap-4">
												{CLOCKING_REMINDER_ROLES.map((role) => (
													// biome-ignore lint/a11y/noLabelWithoutControl: the checkbox inside is the control
													<label key={role} className="flex items-center gap-2 text-sm">
														<Checkbox
															checked={field.state.value.includes(role)}
															onCheckedChange={(checked) =>
																field.handleChange(
																	checked
																		? [...field.state.value, role]
																		: field.state.value.filter((value) => value !== role),
																)
															}
															disabled={!canEdit || pending}
														/>
														{roleLabels[role]}
													</label>
												))}
											</div>
										</fieldset>
									)}
								</form.Field>
								<p id={helpId} className="text-sm text-muted-foreground">
									{t(
										"organization.clockingReminders.help",
										"Checks run every five minutes. Times follow each employee's timezone. Each reminder is sent once per shift, in-app and by push unless the employee changes their notification preferences. No missed clock-in reminder is sent on an approved absence or a public holiday.",
									)}
								</p>
								{!canEdit && (
									<p className="text-sm text-muted-foreground">
										{t(
											"organization.clockingReminders.adminOnly",
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
										? t("organization.clockingReminders.saving", "Saving…")
										: t("organization.clockingReminders.save", "Save changes")}
								</Button>
							</div>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}
