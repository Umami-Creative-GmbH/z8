"use client";

import { IconClock } from "@tabler/icons-react";
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

export type WorkClassification = "daily" | "weekly" | "monthly";

function firstErrorMessage(errors: readonly unknown[]) {
	const [error] = errors;
	return typeof error === "string" ? error : (error as { message?: string } | undefined)?.message;
}

export function WorkScheduleHeading() {
	const { t } = useTranslate();

	return (
		<header className="mb-6 flex items-start gap-4 text-start">
			<div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
				<IconClock aria-hidden="true" className="size-6 text-primary" />
			</div>
			<div className="min-w-0 space-y-2">
				<h1 className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
					{t("onboarding.workSchedule.title", "Set your work schedule")}
				</h1>
				<p className="text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
					{t(
						"onboarding.workSchedule.subtitle",
						"Define your working hours to help track time and manage absences accurately.",
					)}
				</p>
			</div>
		</header>
	);
}

interface HoursPerWeekFieldProps {
	value: number;
	errors: readonly unknown[];
	disabled: boolean;
	onChange: (value: number) => void;
	onBlur: () => void;
}

export function HoursPerWeekField({
	value,
	errors,
	disabled,
	onChange,
	onBlur,
}: HoursPerWeekFieldProps) {
	const { t } = useTranslate();

	return (
		<div className="space-y-2">
			<Label htmlFor="work-schedule-hours-per-week">
				{t("onboarding.workSchedule.hoursPerWeek", "Hours per Week")}
			</Label>
			<Input
				id="work-schedule-hours-per-week"
				name="hoursPerWeek"
				type="number"
				step="any"
				inputMode="decimal"
				autoComplete="off"
				aria-invalid={errors.length > 0}
				aria-describedby={`work-schedule-hours-help${errors.length ? " work-schedule-hours-error" : ""}`}
				min={0}
				max={168}
				placeholder={t("onboarding.workSchedule.hoursPerWeekPlaceholder", "40")}
				disabled={disabled}
				value={value}
				onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
				onBlur={onBlur}
			/>
			<p id="work-schedule-hours-help" className="text-sm text-muted-foreground">
				{t("onboarding.workSchedule.hoursPerWeekDesc", "Typical full-time is 40 hours per week.")}
			</p>
			{errors.length > 0 && (
				<p
					id="work-schedule-hours-error"
					role="alert"
					className="text-sm font-medium text-destructive"
				>
					{firstErrorMessage(errors)}
				</p>
			)}
		</div>
	);
}

interface WorkClassificationFieldProps {
	value: WorkClassification;
	disabled: boolean;
	onChange: (value: WorkClassification) => void;
}

export function WorkClassificationField({
	value,
	disabled,
	onChange,
}: WorkClassificationFieldProps) {
	const { t } = useTranslate();

	return (
		<div className="space-y-2">
			<Label htmlFor="work-schedule-classification">
				{t("onboarding.workSchedule.classification", "Work Classification")}
			</Label>
			<Select
				name="workClassification"
				onValueChange={(next) => onChange(next as WorkClassification)}
				value={value}
				disabled={disabled}
			>
				<SelectTrigger
					id="work-schedule-classification"
					aria-describedby="work-schedule-classification-help"
					className="w-full"
				>
					<SelectValue
						placeholder={t("onboarding.workSchedule.selectClassification", "Select classification")}
					/>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="daily">{t("onboarding.workSchedule.daily", "Daily")}</SelectItem>
					<SelectItem value="weekly">{t("onboarding.workSchedule.weekly", "Weekly")}</SelectItem>
					<SelectItem value="monthly">{t("onboarding.workSchedule.monthly", "Monthly")}</SelectItem>
				</SelectContent>
			</Select>
			<p id="work-schedule-classification-help" className="text-sm text-muted-foreground">
				{t(
					"onboarding.workSchedule.classificationDesc",
					"How you want to track your working hours.",
				)}
			</p>
		</div>
	);
}
