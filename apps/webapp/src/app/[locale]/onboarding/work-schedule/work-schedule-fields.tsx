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
	return typeof error === "string"
		? error
		: (error as { message?: string } | undefined)?.message;
}

export function WorkScheduleHeading() {
	const { t } = useTranslate();

	return (
		<div className="onboarding-heading-panel mb-8 rounded-xl border border-white/30 bg-white/20 p-6 text-center shadow-xl shadow-black/5 backdrop-blur-[40px] sm:p-8 dark:border-white/10 dark:bg-slate-950/20 dark:shadow-black/30 [&_.text-muted-foreground]:text-foreground/75">
			<div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
				<IconClock className="size-8 text-primary" />
			</div>
			<h1 className="mb-4 text-3xl font-bold tracking-tight">
				{t("onboarding.workSchedule.title", "Set your work schedule")}
			</h1>
			<p className="text-muted-foreground">
				{t(
					"onboarding.workSchedule.subtitle",
					"Define your working hours to help track time and manage absences accurately.",
				)}
			</p>
		</div>
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
				type="number"
				min={0}
				max={168}
				placeholder={t("onboarding.workSchedule.hoursPerWeekPlaceholder", "40")}
				disabled={disabled}
				value={value}
				onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
				onBlur={onBlur}
			/>
			<p className="text-sm text-muted-foreground">
				{t(
					"onboarding.workSchedule.hoursPerWeekDesc",
					"Typical full-time is 40 hours per week.",
				)}
			</p>
			{errors.length > 0 && (
				<p className="text-sm font-medium text-destructive">
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
				onValueChange={(next) => onChange(next as WorkClassification)}
				value={value}
				disabled={disabled}
			>
				<SelectTrigger id="work-schedule-classification" className="w-full">
					<SelectValue
						placeholder={t(
							"onboarding.workSchedule.selectClassification",
							"Select classification",
						)}
					/>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="daily">
						{t("onboarding.workSchedule.daily", "Daily")}
					</SelectItem>
					<SelectItem value="weekly">
						{t("onboarding.workSchedule.weekly", "Weekly")}
					</SelectItem>
					<SelectItem value="monthly">
						{t("onboarding.workSchedule.monthly", "Monthly")}
					</SelectItem>
				</SelectContent>
			</Select>
			<p className="text-sm text-muted-foreground">
				{t(
					"onboarding.workSchedule.classificationDesc",
					"How you want to track your working hours.",
				)}
			</p>
		</div>
	);
}
