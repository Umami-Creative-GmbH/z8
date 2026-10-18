"use client";

import { createFormHook, createFormHookContexts } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { type AbsenceDurationIssueCode, findAbsenceDurationIssue } from "@/lib/absences/duration";
import type { AbsenceDurationKind } from "@/lib/absences/types";

type TranslateFn = ReturnType<typeof useTranslate>["t"];

const { fieldContext, formContext } = createFormHookContexts();

/**
 * The form hook of absence forms that share the duration fields: the request form and each
 * compared alternative (#1342). A form made with it can render `AbsenceDurationFields`.
 */
export const { useAppForm: useAbsenceForm, withFieldGroup } = createFormHook({
	fieldComponents: {},
	formComponents: {},
	fieldContext,
	formContext,
});

/** The duration fields keep these names in every form that renders them. */
export const ABSENCE_DURATION_FIELDS = {
	startDate: "startDate",
	endDate: "endDate",
	durationKind: "durationKind",
	startTime: "startTime",
	endTime: "endTime",
} as const;

export interface AbsenceDurationFieldLabels {
	startDate: string;
	endDate: string;
	duration: string;
	startTime: string;
	endTime: string;
}

interface DurationValues {
	startDate: string;
	endDate: string;
	durationKind: AbsenceDurationKind;
	startTime: string;
	endTime: string;
}

type DurationField = keyof DurationValues;

/**
 * The field an issue belongs to, so its message is tied to that input. A missing start date is
 * left to the caller: an empty form or a new alternative prompts for it rather than erroring.
 */
function issueField(code: AbsenceDurationIssueCode, values: DurationValues): DurationField | null {
	switch (code) {
		case "start_date_required":
			return null;
		case "invalid_date":
			return "startDate";
		case "end_before_start":
		case "afternoon_start_morning_end":
		case "partial_day_span":
			return "endDate";
		case "times_required":
			return values.startTime.trim() ? "endTime" : "startTime";
		case "invalid_time":
			return /^([01]\d|2[0-3]):[0-5]\d$/.test(values.startTime.trim()) ? "endTime" : "startTime";
		case "end_time_before_start":
			return "endTime";
	}
}

/** Why an absence's dates or times are invalid, in the viewer's language. */
export function durationIssueMessage(code: AbsenceDurationIssueCode, t: TranslateFn): string {
	switch (code) {
		case "start_date_required":
			return t("absences.form.durationIssue.startDateRequired", "Choose a start date.");
		case "invalid_date":
			return t("absences.form.durationIssue.invalidDate", "Enter valid dates.");
		case "end_before_start":
			return t(
				"absences.form.durationIssue.endBeforeStart",
				"The end date can't be before the start date.",
			);
		case "afternoon_start_morning_end":
			return t(
				"absences.form.durationIssue.afternoonStartMorningEnd",
				"An absence that starts in the afternoon can't end that same morning.",
			);
		case "times_required":
			return t(
				"absences.form.durationIssue.timesRequired",
				"Enter a start time and end time for a partial day.",
			);
		case "invalid_time":
			return t("absences.form.durationIssue.invalidTime", "Enter times as hours and minutes.");
		case "partial_day_span":
			return t(
				"absences.form.durationIssue.partialDaySpan",
				"A partial day can only be same-day or overnight.",
			);
		case "end_time_before_start":
			return t(
				"absences.form.durationIssue.endTimeBeforeStart",
				"End after the start time, or end on the next day for an overnight absence.",
			);
	}
}

/**
 * Start and end date, duration and, for a partial day, the times of one absence, checked by the
 * ordinary request rules. An issue is shown at the field it concerns and wired to that input.
 */
export const AbsenceDurationFields = withFieldGroup({
	defaultValues: {
		startDate: "",
		endDate: "",
		durationKind: "full_day",
		startTime: "",
		endTime: "",
	} as DurationValues,
	props: {} as { labels: AbsenceDurationFieldLabels },
	render: function AbsenceDurationFieldsRender({ group, labels }) {
		const { t } = useTranslate();
		return (
			<group.Subscribe selector={(state) => state.values}>
				{(values) => {
					const issue = findAbsenceDurationIssue(values);
					const field = issue ? issueField(issue.code, values) : null;
					const issueAt = (name: DurationField) =>
						issue && field === name ? durationIssueMessage(issue.code, t) : null;
					return (
						<div className="grid gap-4 sm:grid-cols-2">
							<group.Field name="startDate">
								{(startDate) => {
									const message = issueAt("startDate");
									const hasError = Boolean(message) || startDate.state.meta.errors.length > 0;
									return (
										<TFormItem>
											<TFormLabel hasError={hasError}>{labels.startDate}</TFormLabel>
											<TFormControl hasError={hasError}>
												<DatePicker
													aria-label={labels.startDate}
													value={startDate.state.value}
													onChange={startDate.handleChange}
													onBlur={startDate.handleBlur}
													required
												/>
											</TFormControl>
											<TFormMessage field={startDate}>{message}</TFormMessage>
										</TFormItem>
									);
								}}
							</group.Field>
							<group.Field name="endDate">
								{(endDate) => {
									const message = issueAt("endDate");
									const hasError = Boolean(message) || endDate.state.meta.errors.length > 0;
									return (
										<TFormItem>
											<TFormLabel hasError={hasError}>{labels.endDate}</TFormLabel>
											<TFormControl hasError={hasError}>
												<DatePicker
													aria-label={labels.endDate}
													value={endDate.state.value}
													min={values.startDate || undefined}
													onChange={endDate.handleChange}
													onBlur={endDate.handleBlur}
												/>
											</TFormControl>
											<TFormDescription className="text-xs">
												{t("absences.form.endDateHelper", "Leave empty for a same-day absence.")}
											</TFormDescription>
											<TFormMessage field={endDate}>{message}</TFormMessage>
										</TFormItem>
									);
								}}
							</group.Field>
							<group.Field name="durationKind">
								{(durationKind) => (
									<TFormItem className="sm:col-span-2">
										<TFormLabel>{labels.duration}</TFormLabel>
										<Select
											value={durationKind.state.value}
											onValueChange={(value) =>
												durationKind.handleChange(value as AbsenceDurationKind)
											}
										>
											<TFormControl>
												<SelectTrigger aria-label={labels.duration} className="w-full sm:w-60">
													<SelectValue />
												</SelectTrigger>
											</TFormControl>
											<SelectContent>
												<SelectItem value="full_day">
													{t("absences.form.duration.fullDay", "Full day")}
												</SelectItem>
												<SelectItem value="partial_day">
													{t("absences.form.duration.partialDay", "Partial day")}
												</SelectItem>
											</SelectContent>
										</Select>
										<TFormMessage field={durationKind} />
									</TFormItem>
								)}
							</group.Field>
							{values.durationKind === "partial_day" &&
								(["startTime", "endTime"] as const).map((name) => (
									<group.Field key={name} name={name}>
										{(time) => {
											const label = name === "startTime" ? labels.startTime : labels.endTime;
											const message = issueAt(name);
											const hasError = Boolean(message) || time.state.meta.errors.length > 0;
											return (
												<TFormItem>
													<TFormLabel hasError={hasError}>{label}</TFormLabel>
													<TFormControl hasError={hasError}>
														<Input
															aria-label={label}
															type="time"
															value={time.state.value}
															onChange={(event) => time.handleChange(event.target.value)}
															onBlur={time.handleBlur}
															required
														/>
													</TFormControl>
													<TFormMessage field={time}>{message}</TFormMessage>
												</TFormItem>
											);
										}}
									</group.Field>
								))}
						</div>
					);
				}}
			</group.Subscribe>
		);
	},
});
