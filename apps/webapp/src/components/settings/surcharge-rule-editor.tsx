"use client";

import { IconTrash } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	fieldHasError,
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";

export type SurchargeRuleFormValues = {
	ruleType: "day_of_week" | "time_window" | "date_based";
	name: string;
	description: string | null;
	percentage: number;
	// day_of_week
	dayOfWeek?: "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
	// time_window
	windowStartTime?: string;
	windowEndTime?: string;
	// date_based
	specificDate?: Date | null;
	dateRangeStart?: Date | null;
	dateRangeEnd?: Date | null;
	// common
	priority: number;
	validFrom: Date | null;
	validUntil: Date | null;
	isActive: boolean;
};

// Use simplified types to avoid complex TanStack Form generic requirements
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SurchargeFormApi = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FormField = any;

interface SurchargeRuleEditorProps {
	ruleIndex: number;
	form: SurchargeFormApi;
	onRemove: () => void;
}

export function SurchargeRuleEditor({ ruleIndex, form, onRemove }: SurchargeRuleEditorProps) {
	const { t } = useTranslate();

	// Translated day of week options
	const daysOfWeek = [
		{ value: "monday", label: t("common.days.monday", "Monday") },
		{ value: "tuesday", label: t("common.days.tuesday", "Tuesday") },
		{ value: "wednesday", label: t("common.days.wednesday", "Wednesday") },
		{ value: "thursday", label: t("common.days.thursday", "Thursday") },
		{ value: "friday", label: t("common.days.friday", "Friday") },
		{ value: "saturday", label: t("common.days.saturday", "Saturday") },
		{ value: "sunday", label: t("common.days.sunday", "Sunday") },
	];

	// Translated rule type options
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
		<Card>
			<CardHeader className="pb-3">
				<div className="flex items-center justify-between">
					<span className="text-sm font-medium">
						{t("settings.surcharges.rule", "Rule")} {ruleIndex + 1}
					</span>
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onRemove}
						className="text-destructive hover:text-destructive"
					>
						<IconTrash className="h-4 w-4" />
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4">
				{/* Rule Name */}
				<form.Field name={`rules[${ruleIndex}].name`}>
					{(field: FormField) => (
						<TFormItem>
							<TFormLabel hasError={fieldHasError(field)}>
								{t("settings.surcharges.ruleName", "Rule Name")}
							</TFormLabel>
							<TFormControl hasError={fieldHasError(field)}>
								<Input
									value={field.state.value as string}
									onChange={(e) => field.handleChange(e.target.value)}
									onBlur={field.handleBlur}
									placeholder={t("settings.surcharges.ruleNamePlaceholder", "e.g., Sunday Premium")}
								/>
							</TFormControl>
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>

				{/* Rule Type and Percentage Row */}
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
										field.handleChange(value as SurchargeRuleFormValues["ruleType"])
									}
								>
									<SelectTrigger>
										<SelectValue
											placeholder={t("settings.surcharges.selectRuleType", "Select type")}
										/>
									</SelectTrigger>
									<SelectContent>
										{ruleTypes.map((type) => (
											<SelectItem key={type.value} value={type.value}>
												<div>
													<div>{type.label}</div>
													<div className="text-xs text-muted-foreground">{type.description}</div>
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
											onChange={(e) => {
												const percent = parseInt(e.target.value, 10);
												field.handleChange(Number.isNaN(percent) ? 0 : percent / 100);
											}}
											onBlur={field.handleBlur}
											placeholder="50"
											className="w-24"
										/>
										<span className="text-sm text-muted-foreground">%</span>
									</div>
								</TFormControl>
								<TFormDescription>
									{t("settings.surcharges.percentageDescription", "Additional time credit")}
								</TFormDescription>
								<TFormMessage field={field} />
							</TFormItem>
						)}
					</form.Field>
				</div>

				{/* Type-specific fields */}
				<form.Subscribe selector={(state: FormField) => state.values.rules[ruleIndex]?.ruleType}>
					{(ruleType: SurchargeRuleFormValues["ruleType"] | undefined) => (
						<>
							{/* Day of Week fields */}
							{ruleType === "day_of_week" && (
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
							)}

							{/* Time Window fields */}
							{ruleType === "time_window" && (
								<div className="grid gap-4 sm:grid-cols-2">
									<form.Field name={`rules[${ruleIndex}].windowStartTime`}>
										{(field: FormField) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.surcharges.startTime", "Start Time")}
												</TFormLabel>
												<TFormControl hasError={fieldHasError(field)}>
													<Input
														type="time"
														value={(field.state.value as string) || ""}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
													/>
												</TFormControl>
												<TFormDescription>
													{t(
														"settings.surcharges.startTimeDescription",
														"e.g., 22:00 for night shift",
													)}
												</TFormDescription>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>

									<form.Field name={`rules[${ruleIndex}].windowEndTime`}>
										{(field: FormField) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.surcharges.endTime", "End Time")}
												</TFormLabel>
												<TFormControl hasError={fieldHasError(field)}>
													<Input
														type="time"
														value={(field.state.value as string) || ""}
														onChange={(e) => field.handleChange(e.target.value)}
														onBlur={field.handleBlur}
													/>
												</TFormControl>
												<TFormDescription>
													{t(
														"settings.surcharges.endTimeDescription",
														"e.g., 06:00 for night shift",
													)}
												</TFormDescription>
												<TFormMessage field={field} />
											</TFormItem>
										)}
									</form.Field>
								</div>
							)}

							{/* Date-based fields */}
							{ruleType === "date_based" && (
								<div className="space-y-4">
									<form.Field name={`rules[${ruleIndex}].specificDate`}>
										{(field: FormField) => (
											<TFormItem>
												<TFormLabel hasError={fieldHasError(field)}>
													{t("settings.surcharges.specificDate", "Specific Date")}
												</TFormLabel>
												<TFormControl hasError={fieldHasError(field)}>
													<Input
														type="date"
														value={
															field.state.value
																? new Date(field.state.value as Date).toISOString().split("T")[0]
																: ""
														}
														onChange={(e) => {
															const date = e.target.value ? new Date(e.target.value) : null;
															field.handleChange(date);
														}}
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
										<form.Field name={`rules[${ruleIndex}].dateRangeStart`}>
											{(field: FormField) => (
												<TFormItem>
													<TFormLabel hasError={fieldHasError(field)}>
														{t("settings.surcharges.rangeStart", "Range Start")}
													</TFormLabel>
													<TFormControl hasError={fieldHasError(field)}>
														<Input
															type="date"
															value={
																field.state.value
																	? new Date(field.state.value as Date).toISOString().split("T")[0]
																	: ""
															}
															onChange={(e) => {
																const date = e.target.value ? new Date(e.target.value) : null;
																field.handleChange(date);
															}}
															onBlur={field.handleBlur}
														/>
													</TFormControl>
													<TFormMessage field={field} />
												</TFormItem>
											)}
										</form.Field>

										<form.Field name={`rules[${ruleIndex}].dateRangeEnd`}>
											{(field: FormField) => (
												<TFormItem>
													<TFormLabel hasError={fieldHasError(field)}>
														{t("settings.surcharges.rangeEnd", "Range End")}
													</TFormLabel>
													<TFormControl hasError={fieldHasError(field)}>
														<Input
															type="date"
															value={
																field.state.value
																	? new Date(field.state.value as Date).toISOString().split("T")[0]
																	: ""
															}
															onChange={(e) => {
																const date = e.target.value ? new Date(e.target.value) : null;
																field.handleChange(date);
															}}
															onBlur={field.handleBlur}
														/>
													</TFormControl>
													<TFormMessage field={field} />
												</TFormItem>
											)}
										</form.Field>
									</div>
								</div>
							)}
						</>
					)}
				</form.Subscribe>
			</CardContent>
		</Card>
	);
}
