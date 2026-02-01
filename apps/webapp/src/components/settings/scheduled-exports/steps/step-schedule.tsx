/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useTranslate } from "@tolgee/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CronPreview } from "../cron-preview";
import type { ScheduledExportForm } from "../scheduled-export-dialog";
import type { ScheduleType } from "@/lib/scheduled-exports/domain/types";

interface StepScheduleProps {
	form: ScheduledExportForm;
}

const COMMON_TIMEZONES = [
	"UTC",
	"Europe/Berlin",
	"Europe/London",
	"Europe/Paris",
	"Europe/Zurich",
	"Europe/Vienna",
	"America/New_York",
	"America/Chicago",
	"America/Los_Angeles",
	"Asia/Tokyo",
	"Asia/Shanghai",
	"Australia/Sydney",
];

export function StepSchedule({ form }: StepScheduleProps) {
	const { t } = useTranslate();

	const SCHEDULE_TYPES: { value: ScheduleType; label: string; description: string }[] = [
		{
			value: "daily",
			label: t("settings.scheduledExports.scheduleType.daily", "Daily"),
			description: t("settings.scheduledExports.scheduleType.dailyDesc", "Every day at midnight"),
		},
		{
			value: "weekly",
			label: t("settings.scheduledExports.scheduleType.weekly", "Weekly"),
			description: t("settings.scheduledExports.scheduleType.weeklyDesc", "Every Monday at midnight"),
		},
		{
			value: "monthly",
			label: t("settings.scheduledExports.scheduleType.monthly", "Monthly"),
			description: t("settings.scheduledExports.scheduleType.monthlyDesc", "1st of every month at midnight"),
		},
		{
			value: "quarterly",
			label: t("settings.scheduledExports.scheduleType.quarterly", "Quarterly"),
			description: t("settings.scheduledExports.scheduleType.quarterlyDesc", "1st of Jan, Apr, Jul, Oct"),
		},
		{
			value: "cron",
			label: t("settings.scheduledExports.scheduleType.cron", "Custom (Cron)"),
			description: t("settings.scheduledExports.scheduleType.cronDesc", "Custom cron expression"),
		},
	];

	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<form.Field name="name">
					{(field: any) => (
						<div className="space-y-2">
							<Label htmlFor="name">
								{t("settings.scheduledExports.schedule.name", "Schedule Name")} *
							</Label>
							<Input
								id="name"
								placeholder={t("settings.scheduledExports.schedule.namePlaceholder", "e.g., Monthly Payroll Export")}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								aria-describedby={field.state.meta.errors.length > 0 ? "name-error" : undefined}
								aria-invalid={field.state.meta.errors.length > 0}
							/>
							{field.state.meta.errors.length > 0 && (
								<p id="name-error" className="text-sm text-destructive" role="alert">
									{field.state.meta.errors[0]}
								</p>
							)}
						</div>
					)}
				</form.Field>

				<form.Field name="description">
					{(field: any) => (
						<div className="space-y-2">
							<Label htmlFor="description">
								{t("settings.scheduledExports.schedule.description", "Description")}
							</Label>
							<Textarea
								id="description"
								placeholder={t("settings.scheduledExports.schedule.descriptionPlaceholder", "Optional description for this schedule")}
								value={field.state.value || ""}
								onChange={(e) => field.handleChange(e.target.value)}
								onBlur={field.handleBlur}
								rows={2}
							/>
						</div>
					)}
				</form.Field>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<form.Field name="scheduleType">
					{(field: any) => (
						<div className="space-y-2">
							<Label id="schedule-type-label">
								{t("settings.scheduledExports.schedule.scheduleType", "Schedule Type")} *
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as ScheduleType)}
								aria-labelledby="schedule-type-label"
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{SCHEDULE_TYPES.map((type) => (
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
						</div>
					)}
				</form.Field>

				<form.Field name="timezone">
					{(field: any) => (
						<div className="space-y-2">
							<Label id="timezone-label">
								{t("settings.scheduledExports.schedule.timezone", "Timezone")} *
							</Label>
							<Select
								value={field.state.value}
								onValueChange={field.handleChange}
								aria-labelledby="timezone-label"
							>
								<SelectTrigger>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{COMMON_TIMEZONES.map((tz) => (
										<SelectItem key={tz} value={tz}>
											{tz}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>
			</div>

			<form.Subscribe
				selector={(state: any) => ({
					scheduleType: state.values.scheduleType,
					cronExpression: state.values.cronExpression,
					timezone: state.values.timezone,
				})}
			>
				{({ scheduleType, cronExpression, timezone }: any) => (
					<>
						{scheduleType === "cron" && (
							<form.Field name="cronExpression">
								{(field: any) => (
									<div className="space-y-2">
										<Label htmlFor="cronExpression">
											{t("settings.scheduledExports.schedule.cronExpression", "Cron Expression")} *
										</Label>
										<Input
											id="cronExpression"
											placeholder="0 0 1 * *"
											value={field.state.value || ""}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											className="font-mono"
											aria-describedby="cron-hint"
											aria-invalid={field.state.meta.errors.length > 0}
										/>
										<p id="cron-hint" className="text-xs text-muted-foreground">
											{t("settings.scheduledExports.schedule.cronHint", "Format: minute hour day month weekday (e.g., \"0 0 1 * *\" for 1st of month at midnight)")}
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm text-destructive" role="alert">
												{field.state.meta.errors[0]}
											</p>
										)}
									</div>
								)}
							</form.Field>
						)}

						<CronPreview
							scheduleType={scheduleType}
							cronExpression={cronExpression}
							timezone={timezone}
						/>
					</>
				)}
			</form.Subscribe>
		</div>
	);
}
