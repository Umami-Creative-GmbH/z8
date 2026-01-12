"use client";

import { useForm } from "@tanstack/react-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { IconClock, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { useRouter } from "@/navigation";
import { setWorkScheduleOnboarding, skipWorkScheduleSetup } from "./actions";

const defaultValues = {
	hoursPerWeek: 40,
	workClassification: "weekly" as "daily" | "weekly" | "monthly",
	effectiveFrom: new Date(),
};

export default function WorkSchedulePage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues,
		validatorAdapter: zodValidator(),
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await setWorkScheduleOnboarding(value);

			setLoading(false);

			if (result.success && result.data) {
				toast.success(t("onboarding.workSchedule.success", "Work schedule set successfully!"));
				router.push(result.data.nextStep);
			} else {
				toast.error(
					result.error || t("onboarding.workSchedule.error", "Failed to set work schedule"),
				);
			}
		},
	});

	async function handleSkip() {
		setLoading(true);

		const result = await skipWorkScheduleSetup();

		setLoading(false);

		if (result.success && result.data) {
			router.push(result.data.nextStep);
		} else {
			toast.error(result.error || "Failed to skip work schedule setup");
		}
	}

	return (
		<>
			<ProgressIndicator currentStep="work_schedule" />

			<div className="mx-auto max-w-2xl">
				<div className="mb-8 text-center">
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

				<Card>
					<CardHeader>
						<CardTitle>{t("onboarding.workSchedule.scheduleTitle", "Work Schedule")}</CardTitle>
						<CardDescription>
							{t(
								"onboarding.workSchedule.scheduleDesc",
								"Set your default working hours. You can adjust this later in settings.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-6"
						>
							{/* Hours Per Week */}
							<form.Field
								name="hoursPerWeek"
								validators={{
									onChange: z.number().min(0).max(168),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t("onboarding.workSchedule.hoursPerWeek", "Hours per Week")}
										</Label>
										<Input
											type="number"
											min={0}
											max={168}
											placeholder="40"
											disabled={loading}
											value={field.state.value}
											onChange={(e) => field.handleChange(parseFloat(e.target.value) || 0)}
											onBlur={field.handleBlur}
										/>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.workSchedule.hoursPerWeekDesc",
												"Typical full-time is 40 hours per week.",
											)}
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm font-medium text-destructive">
												{field.state.meta.errors[0]}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Work Classification */}
							<form.Field name="workClassification">
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t("onboarding.workSchedule.classification", "Work Classification")}
										</Label>
										<Select
											onValueChange={(value) =>
												field.handleChange(value as "daily" | "weekly" | "monthly")
											}
											value={field.state.value}
											disabled={loading}
										>
											<SelectTrigger>
												<SelectValue placeholder="Select classification" />
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
								)}
							</form.Field>

							{/* Action Buttons */}
							<div className="flex gap-3 pt-4">
								<Button
									type="button"
									variant="outline"
									onClick={handleSkip}
									disabled={loading}
									className="flex-1"
								>
									{t("onboarding.workSchedule.skip", "Skip for now")}
								</Button>
								<Button type="submit" disabled={loading} className="flex-1">
									{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									{t("onboarding.workSchedule.continue", "Continue")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
