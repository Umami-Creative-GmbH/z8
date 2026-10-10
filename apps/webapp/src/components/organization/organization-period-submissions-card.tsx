"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useId, useRef, useState } from "react";
import { toast } from "sonner";
import { updatePeriodSubmissionSettings } from "@/app/[locale]/(app)/settings/organizations/period-submission-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { TFormControl, TFormItem, TFormLabel, TFormMessage } from "@/components/ui/tanstack-form";
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { parsePlainDate } from "@/lib/datetime/temporal-core";
import { formatPlainDate } from "@/lib/datetime/temporal-format";
import {
	DEFAULT_SUBMISSION_WEEK_START_DAY,
	SUBMISSION_WEEKDAYS,
	type SubmissionCadence,
	type SubmissionCadenceKind,
	type SubmissionWeekday,
} from "@/lib/time-tracking/period-submissions/cadence";
import {
	MAX_SECOND_REMINDER_DELAY_DAYS,
	MIN_SECOND_REMINDER_DELAY_DAYS,
	type PeriodSubmissionSettings,
} from "@/lib/time-tracking/period-submissions/settings-policy";
import { useRouter } from "@/navigation";

interface OrganizationPeriodSubmissionsCardProps {
	organizationId: string;
	settings: PeriodSubmissionSettings;
	currentMemberRole: "owner" | "admin" | "member";
}

/** Whole days within the allowed delay, or `null`. */
function delayFromField(value: string): number | null {
	if (!/^\d+$/.test(value.trim())) return null;
	const days = Number(value);
	return days >= MIN_SECOND_REMINDER_DELAY_DAYS && days <= MAX_SECOND_REMINDER_DELAY_DAYS
		? days
		: null;
}

function cadenceFromFields(kind: SubmissionCadenceKind, weekStartDay: SubmissionWeekday) {
	if (kind === "weekly") return { kind, weekStartDay } satisfies SubmissionCadence;
	return { kind } satisfies SubmissionCadence;
}

export function OrganizationPeriodSubmissionsCard({
	organizationId,
	settings,
	currentMemberRole,
}: OrganizationPeriodSubmissionsCardProps) {
	const { t } = useTranslate();
	const tolgee = useTolgee(["language"]);
	const locale = tolgee.getLanguage() || "en";
	const router = useRouter();
	const id = useId();
	const helpId = `${id}-help`;
	const delayErrorId = `${id}-delay-error`;
	const submitting = useRef(false);
	const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
	const canEdit = currentMemberRole === "owner" || currentMemberRole === "admin";
	const invalidDelay = t(
		"organization.periodSubmissions.invalidDelay",
		"Enter whole days from 1 to 30.",
	);
	const weekdayLabels: Record<SubmissionWeekday, string> = {
		monday: t("organization.periodSubmissions.weekday.monday", "Monday"),
		tuesday: t("organization.periodSubmissions.weekday.tuesday", "Tuesday"),
		wednesday: t("organization.periodSubmissions.weekday.wednesday", "Wednesday"),
		thursday: t("organization.periodSubmissions.weekday.thursday", "Thursday"),
		friday: t("organization.periodSubmissions.weekday.friday", "Friday"),
		saturday: t("organization.periodSubmissions.weekday.saturday", "Saturday"),
		sunday: t("organization.periodSubmissions.weekday.sunday", "Sunday"),
	};

	const form = useForm({
		defaultValues: {
			cadence: settings.cadence.kind as SubmissionCadenceKind,
			weekStartDay:
				settings.cadence.kind === "weekly"
					? settings.cadence.weekStartDay
					: DEFAULT_SUBMISSION_WEEK_START_DAY,
			secondReminderDelay: String(settings.secondReminderDelayDays),
		},
		onSubmit: async ({ value }) => {
			if (!canEdit || submitting.current) return;
			submitting.current = true;
			setFeedback(null);
			try {
				const result = await updatePeriodSubmissionSettings({
					organizationId,
					cadence: cadenceFromFields(value.cadence, value.weekStartDay),
					secondReminderDelayDays:
						delayFromField(value.secondReminderDelay) ?? MIN_SECOND_REMINDER_DELAY_DAYS,
				});
				if (!result.success) {
					setFeedback({ error: true, message: result.error });
					toast.error(result.error);
				} else {
					const message = t(
						"organization.periodSubmissions.saved",
						"Period submission settings saved",
					);
					setFeedback({ error: false, message });
					toast.success(message);
					router.refresh();
				}
			} catch {
				const message = t(
					"organization.periodSubmissions.saveFailed",
					"Failed to update period submission settings",
				);
				setFeedback({ error: true, message });
				toast.error(message);
			}
			submitting.current = false;
		},
	});

	const upcoming = settings.upcoming;
	const upcomingDate = upcoming
		? formatPlainDate(parsePlainDate(upcoming.fromDate), locale, "dateMedium")
		: null;
	let upcomingMessage: string | null = null;
	if (upcoming && upcomingDate) {
		if (upcoming.cadence.kind === "off") {
			upcomingMessage = t(
				"organization.periodSubmissions.upcoming.off",
				"No periods are expected from {date}. The current period is still expected.",
				{ date: upcomingDate },
			);
		} else {
			const starts =
				upcoming.cadence.kind === "weekly"
					? t("organization.periodSubmissions.upcoming.weekly", "Weekly periods start on {date}.", {
							date: upcomingDate,
						})
					: t(
							"organization.periodSubmissions.upcoming.monthly",
							"Monthly periods start on {date}.",
							{ date: upcomingDate },
						);
			const until =
				settings.inEffect.kind === "weekly"
					? t(
							"organization.periodSubmissions.upcoming.untilWeekly",
							"Until then, weekly periods continue.",
						)
					: settings.inEffect.kind === "monthly"
						? t(
								"organization.periodSubmissions.upcoming.untilMonthly",
								"Until then, monthly periods continue.",
							)
						: null;
			upcomingMessage = until ? `${starts} ${until}` : starts;
		}
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("organization.periodSubmissions.title", "Period submissions")}</CardTitle>
				<CardDescription>
					{t(
						"organization.periodSubmissions.description",
						"Ask employees to submit each week or month for approval, confirming that their work and absences are complete and correct.",
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
								<form.Field name="cadence">
									{(field) => (
										<fieldset className="space-y-2" aria-describedby={helpId}>
											<legend className="text-sm font-medium">
												{t("organization.periodSubmissions.cadence.label", "Submission cadence")}
											</legend>
											<RadioGroup
												value={field.state.value}
												onValueChange={(value) =>
													field.handleChange(value as SubmissionCadenceKind)
												}
												disabled={!canEdit || pending}
												className="flex flex-wrap gap-4"
											>
												<div className="flex items-center gap-2">
													<RadioGroupItem id={`${id}-off`} value="off" />
													<Label htmlFor={`${id}-off`}>
														{t("organization.periodSubmissions.cadence.off", "Off")}
													</Label>
												</div>
												<div className="flex items-center gap-2">
													<RadioGroupItem id={`${id}-weekly`} value="weekly" />
													<Label htmlFor={`${id}-weekly`}>
														{t("organization.periodSubmissions.cadence.weekly", "Weekly")}
													</Label>
												</div>
												<div className="flex items-center gap-2">
													<RadioGroupItem id={`${id}-monthly`} value="monthly" />
													<Label htmlFor={`${id}-monthly`}>
														{t("organization.periodSubmissions.cadence.monthly", "Monthly")}
													</Label>
												</div>
											</RadioGroup>
										</fieldset>
									)}
								</form.Field>
								<form.Subscribe selector={(state) => state.values.cadence}>
									{(cadence) =>
										cadence === "weekly" ? (
											<form.Field name="weekStartDay">
												{(field) => (
													<TFormItem className="max-w-xs">
														<TFormLabel id={`${id}-week-start-label`}>
															{t("organization.periodSubmissions.weekStart", "Weeks start on")}
														</TFormLabel>
														<Select
															value={field.state.value}
															onValueChange={(value) =>
																value && field.handleChange(value as SubmissionWeekday)
															}
															disabled={!canEdit || pending}
														>
															<SelectTrigger aria-labelledby={`${id}-week-start-label`}>
																<SelectValue />
															</SelectTrigger>
															<SelectContent>
																{SUBMISSION_WEEKDAYS.map((day) => (
																	<SelectItem key={day} value={day}>
																		{weekdayLabels[day]}
																	</SelectItem>
																))}
															</SelectContent>
														</Select>
													</TFormItem>
												)}
											</form.Field>
										) : null
									}
								</form.Subscribe>
								<form.Field
									name="secondReminderDelay"
									validators={{
										onSubmit: ({ value }) =>
											delayFromField(value) === null ? invalidDelay : undefined,
									}}
								>
									{(field) => (
										<TFormItem className="max-w-xs">
											<TFormLabel>
												{t(
													"organization.periodSubmissions.secondReminderDelay",
													"Days until the second reminder",
												)}
											</TFormLabel>
											<TFormControl
												hasError={fieldHasError(field)}
												aria-describedby={
													fieldHasError(field) ? `${helpId} ${delayErrorId}` : helpId
												}
											>
												<Input
													type="number"
													min={MIN_SECOND_REMINDER_DELAY_DAYS}
													max={MAX_SECOND_REMINDER_DELAY_DAYS}
													step={1}
													value={field.state.value}
													onChange={(event) => field.handleChange(event.target.value)}
													onBlur={field.handleBlur}
													disabled={!canEdit || pending}
												/>
											</TFormControl>
											<TFormMessage id={delayErrorId} field={field} />
										</TFormItem>
									)}
								</form.Field>
								{upcomingMessage && <p className="text-sm">{upcomingMessage}</p>}
								<p id={helpId} className="text-sm text-muted-foreground">
									{t(
										"organization.periodSubmissions.help",
										"Periods follow each employee's timezone and are clipped to their employment. Switching on starts with the first full period. A change takes effect at the next period boundary the old and new cadence share, so a change between weekly and monthly can take several months. Employees are reminded when a period ends and again after the days set here. Kiosk-only employees do not submit periods.",
									)}
								</p>
								{!canEdit && (
									<p className="text-sm text-muted-foreground">
										{t(
											"organization.periodSubmissions.adminOnly",
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
										? t("organization.periodSubmissions.saving", "Saving…")
										: t("organization.periodSubmissions.save", "Save changes")}
								</Button>
							</div>
						)}
					</form.Subscribe>
				</form>
			</CardContent>
		</Card>
	);
}
