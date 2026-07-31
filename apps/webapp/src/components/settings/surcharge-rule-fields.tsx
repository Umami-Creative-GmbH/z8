"use client";

import { useTranslate } from "@tolgee/react";
import { Temporal } from "temporal-polyfill";
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
import { fieldHasError } from "@/components/ui/tanstack-form-utils";
import { TimeInput } from "@/components/ui/time-input";

export type SurchargeRuleFormValues = {
	ruleType: "day_of_week" | "time_window" | "date_based";
	name: string;
	description: string | null;
	percentage: number;
	dayOfWeek?:
		| "monday"
		| "tuesday"
		| "wednesday"
		| "thursday"
		| "friday"
		| "saturday"
		| "sunday";
	windowStartTime?: string;
	windowEndTime?: string;
	specificDate?: Date | null;
	dateRangeStart?: Date | null;
	dateRangeEnd?: Date | null;
	priority: number;
	validFrom: Date | null;
	validUntil: Date | null;
	isActive: boolean;
};

// TanStack's deeply inferred array paths exceed TypeScript's practical limit at this component boundary.
// biome-ignore lint/suspicious/noExplicitAny: preserves the existing generic form boundary.
export type SurchargeFormApi = any;
// biome-ignore lint/suspicious/noExplicitAny: preserves the existing generic field boundary.
type FormField = any;

function dateFieldToString(value: unknown): string {
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) return "";
	return Temporal.Instant.from(value.toISOString())
		.toZonedDateTimeISO("UTC")
		.toPlainDate()
		.toString();
}

function stringToDateField(value: string): Date | null {
	if (!value) return null;
	const instant = Temporal.PlainDate.from(value)
		.toZonedDateTime("UTC")
		.toInstant();
	return new Date(instant.epochMilliseconds);
}

interface RuleFieldsProps {
	form: SurchargeFormApi;
	ruleIndex: number;
}

export function SurchargeRuleBaseFields({ form, ruleIndex }: RuleFieldsProps) {
	const { t } = useTranslate();
	const ruleTypes = [
		{
			value: "day_of_week",
			label: t("settings.surcharges.ruleTypes.dayOfWeek.label", "Day of Week"),
			description: t(
				"settings.surcharges.ruleTypes.dayOfWeek.description",
				"Apply on specific days",
			),
		},
		{
			value: "time_window",
			label: t("settings.surcharges.ruleTypes.timeWindow.label", "Time Window"),
			description: t(
				"settings.surcharges.ruleTypes.timeWindow.description",
				"Apply during time ranges",
			),
		},
		{
			value: "date_based",
			label: t("settings.surcharges.ruleTypes.dateBased.label", "Date-Based"),
			description: t(
				"settings.surcharges.ruleTypes.dateBased.description",
				"Apply on specific dates",
			),
		},
	];

	return (
		<>
			<form.Field name={`rules[${ruleIndex}].name`}>
				{(field: FormField) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.surcharges.ruleName", "Rule Name")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<Input
								value={field.state.value as string}
								onChange={(event) => field.handleChange(event.target.value)}
								onBlur={field.handleBlur}
								placeholder={t(
									"settings.surcharges.ruleNamePlaceholder",
									"e.g., Sunday Premium",
								)}
							/>
						</TFormControl>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name={`rules[${ruleIndex}].ruleType`}>
					{(field: FormField) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.surcharges.ruleType", "Rule Type")}
							</TFormLabel>
							<Select
								value={field.state.value as string}
								onValueChange={(value) =>
									field.handleChange(
										value as SurchargeRuleFormValues["ruleType"],
									)
								}
							>
								<SelectTrigger>
									<SelectValue
										placeholder={t(
											"settings.surcharges.selectRuleType",
											"Select type",
										)}
									/>
								</SelectTrigger>
								<SelectContent>
									{ruleTypes.map((type) => (
										<SelectItem key={type.value} value={type.value}>
											<div>
												<div>{type.label}</div>
												<div className="text-xs text-muted-foreground">
													{type.description}
												</div>
											</div>
										</SelectItem>
									))}
								</SelectContent>
							</Select>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>

				<form.Field name={`rules[${ruleIndex}].percentage`}>
					{(field: FormField) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.surcharges.percentage", "Percentage")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<div className="flex items-center gap-2">
									<span className="text-sm text-muted-foreground">+</span>
									<Input
										type="number"
										min="1"
										max="1000"
										step="1"
										value={Math.round((field.state.value as number) * 100)}
										onChange={(event) => {
											const percent = parseInt(event.target.value, 10);
											field.handleChange(
												Number.isNaN(percent) ? 0 : percent / 100,
											);
										}}
										onBlur={field.handleBlur}
										placeholder="50"
										className="w-24"
									/>
									<span className="text-sm text-muted-foreground">%</span>
								</div>
							</TFormControl>
							<TFormDescription>
								{t(
									"settings.surcharges.percentageDescription",
									"Additional time credit",
								)}
							</TFormDescription>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
			</div>
		</>
	);
}

function DayOfWeekRuleField({ form, ruleIndex }: RuleFieldsProps) {
	const { t } = useTranslate();
	const daysOfWeek = [
		{ value: "monday", label: t("common.days.monday", "Monday") },
		{ value: "tuesday", label: t("common.days.tuesday", "Tuesday") },
		{ value: "wednesday", label: t("common.days.wednesday", "Wednesday") },
		{ value: "thursday", label: t("common.days.thursday", "Thursday") },
		{ value: "friday", label: t("common.days.friday", "Friday") },
		{ value: "saturday", label: t("common.days.saturday", "Saturday") },
		{ value: "sunday", label: t("common.days.sunday", "Sunday") },
	];

	return (
		<form.Field name={`rules[${ruleIndex}].dayOfWeek`}>
			{(field: FormField) => (
				<TFormItem>
					<TFormLabel hasError={fieldHasError(field)}>
						{t("settings.surcharges.dayOfWeek", "Day of Week")}
					</TFormLabel>
					<Select
						value={(field.state.value as string) || "sunday"}
						onValueChange={(value) =>
							field.handleChange(value as SurchargeRuleFormValues["dayOfWeek"])
						}
					>
						<SelectTrigger>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{daysOfWeek.map((day) => (
								<SelectItem key={day.value} value={day.value}>
									{day.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
					<TFormDescription>
						{t(
							"settings.surcharges.dayOfWeekDescription",
							"Surcharge applies on this day",
						)}
					</TFormDescription>
					<TFormMessage field={field} />
				</TFormItem>
			)}
		</form.Field>
	);
}

function TimeWindowRuleFields({ form, ruleIndex }: RuleFieldsProps) {
	const { t } = useTranslate();
	return (
		<div className="grid gap-4 sm:grid-cols-2">
			{(["windowStartTime", "windowEndTime"] as const).map((fieldName) => {
				const isStart = fieldName === "windowStartTime";
				return (
					<form.Field key={fieldName} name={`rules[${ruleIndex}].${fieldName}`}>
						{(field: FormField) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{isStart
										? t("settings.surcharges.startTime", "Start Time")
										: t("settings.surcharges.endTime", "End Time")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<TimeInput
										value={(field.state.value as string) || ""}
										onChange={(event) => field.handleChange(event.target.value)}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormDescription>
									{isStart
										? t(
												"settings.surcharges.startTimeDescription",
												"e.g., 22:00 for night shift",
											)
										: t(
												"settings.surcharges.endTimeDescription",
												"e.g., 06:00 for night shift",
											)}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
				);
			})}
		</div>
	);
}

function DateBasedRuleFields({ form, ruleIndex }: RuleFieldsProps) {
	const { t } = useTranslate();
	return (
		<div className="space-y-4">
			<form.Field name={`rules[${ruleIndex}].specificDate`}>
				{(field: FormField) => (
					<TFormItem>
						<TFormLabel hasError={fieldHasError(field)}>
							{t("settings.surcharges.specificDate", "Specific Date")}
						</TFormLabel>
						<TFormControl hasError={fieldHasError(field)}>
							<DatePicker
								value={dateFieldToString(field.state.value)}
								onChange={(value) =>
									field.handleChange(stringToDateField(value))
								}
								onBlur={field.handleBlur}
							/>
						</TFormControl>
						<TFormDescription>
							{t(
								"settings.surcharges.specificDateDescription",
								"For single-day surcharges (e.g., holidays)",
							)}
						</TFormDescription>
						<TFormMessage field={field} />
					</TFormItem>
				)}
			</form.Field>

			<p className="text-sm text-muted-foreground text-center">
				{t("settings.surcharges.orDateRange", "— or use a date range —")}
			</p>

			<div className="grid gap-4 sm:grid-cols-2">
				{(["dateRangeStart", "dateRangeEnd"] as const).map((fieldName) => (
					<form.Field key={fieldName} name={`rules[${ruleIndex}].${fieldName}`}>
						{(field: FormField) => (
							<TFormItem>
								<TFormLabel hasError={fieldHasError(field)}>
									{fieldName === "dateRangeStart"
										? t("settings.surcharges.rangeStart", "Range Start")
										: t("settings.surcharges.rangeEnd", "Range End")}
								</TFormLabel>
								<TFormControl hasError={fieldHasError(field)}>
									<DatePicker
										value={dateFieldToString(field.state.value)}
										onChange={(value) =>
											field.handleChange(stringToDateField(value))
										}
										onBlur={field.handleBlur}
									/>
								</TFormControl>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
				))}
			</div>
		</div>
	);
}

export function SurchargeRuleConditionalFields({
	form,
	ruleIndex,
}: RuleFieldsProps) {
	return (
		<form.Subscribe
			selector={(state: FormField) => state.values.rules[ruleIndex]?.ruleType}
		>
			{(ruleType: SurchargeRuleFormValues["ruleType"] | undefined) => (
				<>
					{ruleType === "day_of_week" && (
						<DayOfWeekRuleField form={form} ruleIndex={ruleIndex} />
					)}
					{ruleType === "time_window" && (
						<TimeWindowRuleFields form={form} ruleIndex={ruleIndex} />
					)}
					{ruleType === "date_based" && (
						<DateBasedRuleFields form={form} ruleIndex={ruleIndex} />
					)}
				</>
			)}
		</form.Subscribe>
	);
}
