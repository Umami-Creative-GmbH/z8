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
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import {
	CLOCKING_REMINDER_ROLES,
	type ClockingReminderRole,
	type ClockingReminderSettings,
	MAX_CLOCKING_REMINDER_MINUTES,
	MIN_BREAK_DUE_LEAD_MINUTES,
} from "@/lib/time-tracking/clocking-reminders/settings-policy";
import { useRouter } from "@/navigation";

interface OrganizationClockingRemindersCardProps {
	organizationId: string;
	settings: ClockingReminderSettings;
	currentMemberRole: "owner" | "admin" | "member";
}

/** Whole minutes from `min` to the maximum, or `null`. */
function minutesFromField(value: string, min = 0): number | null {
	if (!/^\d+$/.test(value.trim())) return null;
	const minutes = Number(value);
	return minutes >= min && minutes <= MAX_CLOCKING_REMINDER_MINUTES ? minutes : null;
}

const leadFromField = (value: string) => minutesFromField(value, MIN_BREAK_DUE_LEAD_MINUTES);

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
	const invalidLead = t(
		"organization.clockingReminders.invalidLeadMinutes",
		"Enter whole minutes from 1 to 1440 before the break is due.",
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
			breakDueEnabled: settings.breakDue.enabled,
			breakDueLead: String(settings.breakDue.leadMinutes),
			roles: [...settings.roles] as ClockingReminderRole[],
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
						graceMinutes: minutesFromField(value.missedClockInGrace) ?? 0,
					},
					forgottenClockOut: {
						enabled: value.forgottenClockOutEnabled,
						graceMinutes: minutesFromField(value.forgottenClockOutGrace) ?? 0,
					},
					breakDue: {
						enabled: value.breakDueEnabled,
						leadMinutes: leadFromField(value.breakDueLead) ?? MIN_BREAK_DUE_LEAD_MINUTES,
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
			minutesField: "missedClockInGrace",
			minMinutes: 0,
			invalidMessage: invalidGrace,
			label: t("organization.clockingReminders.missedClockIn.enabled", "Missed clock-in reminder"),
			minutesLabel: t(
				"organization.clockingReminders.missedClockIn.grace",
				"Minutes after the expected start",
			),
		},
		{
			enabledField: "forgottenClockOutEnabled",
			minutesField: "forgottenClockOutGrace",
			minMinutes: 0,
			invalidMessage: invalidGrace,
			label: t(
				"organization.clockingReminders.forgottenClockOut.enabled",
				"Forgotten clock-out reminder",
			),
			minutesLabel: t(
				"organization.clockingReminders.forgottenClockOut.grace",
				"Minutes after the expected end",
			),
		},
		{
			enabledField: "breakDueEnabled",
			minutesField: "breakDueLead",
			minMinutes: MIN_BREAK_DUE_LEAD_MINUTES,
			invalidMessage: invalidLead,
			label: t("organization.clockingReminders.breakDue.enabled", "Break-due reminder"),
			minutesLabel: t(
				"organization.clockingReminders.breakDue.lead",
				"Minutes before the break is due",
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
						"Remind employees when they have not clocked in by the start of their published shift, are still clocked in after it ends, or are about to work longer than their work policy allows without a break.",
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
					<form.Subscribe selector={(state) => [state.isSubmitting, state.isValid] as const}>
						{([pending, valid]) => (
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
													<TFormMessage id={`${errorId}-${reminder.minutesField}`} field={field} />
												</TFormItem>
											)}
										</form.Field>
										<form.Field
											name={reminder.minutesField}
											validators={{
												onSubmit: ({ value }) =>
													minutesFromField(value, reminder.minMinutes) === null
														? reminder.invalidMessage
														: undefined,
											}}
										>
											{(field) => (
												<TFormItem className="max-w-xs">
													<TFormLabel>{reminder.minutesLabel}</TFormLabel>
													<TFormControl
														hasError={fieldHasError(field)}
														aria-describedby={
															fieldHasError(field)
																? `${helpId} ${errorId}-${reminder.minutesField}`
																: helpId
														}
													>
														<Input
															type="number"
															min={reminder.minMinutes}
															max={MAX_CLOCKING_REMINDER_MINUTES}
															step={1}
															value={field.state.value}
															onChange={(event) => field.handleChange(event.target.value)}
															onBlur={field.handleBlur}
															disabled={!canEdit || pending}
														/>
													</TFormControl>
													<TFormMessage id={`${errorId}-${reminder.minutesField}`} field={field} />
												</TFormItem>
											)}
										</form.Field>
									</div>
								))}
								<form.Field
									name="roles"
									validators={{
										onSubmit: ({ value }) => (value.length === 0 ? noRoles : undefined),
									}}
								>
									{(field) => (
										<fieldset
											className="space-y-2"
											aria-describedby={fieldHasError(field) ? `${errorId}-roles` : undefined}
										>
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
											<TFormMessage id={`${errorId}-roles`} field={field} />
										</fieldset>
									)}
								</form.Field>
								<p id={helpId} className="text-sm text-muted-foreground">
									{t(
										"organization.clockingReminders.help",
										"Checks run every five minutes. Times follow each employee's timezone. Each reminder is sent once per shift, or once per break rule while clocked in, in-app and by push unless the employee changes their notification preferences. No missed clock-in reminder is sent on an approved absence or a public holiday.",
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
								{valid && feedback && (
									<p
										role={feedback.error ? "alert" : "status"}
										className={
											feedback.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
										}
									>
										{feedback.message}
									</p>
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
