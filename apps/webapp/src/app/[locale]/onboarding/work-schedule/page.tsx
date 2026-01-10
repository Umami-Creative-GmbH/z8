"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconClock, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Form,
	FormControl,
	FormDescription,
	FormField,
	FormItem,
	FormLabel,
	FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	type OnboardingWorkScheduleFormValues,
	onboardingWorkScheduleSchema,
} from "@/lib/validations/onboarding";
import { useRouter } from "@/navigation";
import { setWorkScheduleOnboarding, skipWorkScheduleSetup } from "./actions";

export default function WorkSchedulePage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const form = useForm<OnboardingWorkScheduleFormValues>({
		resolver: zodResolver(onboardingWorkScheduleSchema),
		defaultValues: {
			hoursPerWeek: 40,
			workClassification: "weekly",
			effectiveFrom: new Date(),
		},
	});

	async function onSubmit(values: OnboardingWorkScheduleFormValues) {
		setLoading(true);

		const result = await setWorkScheduleOnboarding(values);

		setLoading(false);

		if (result.success && result.data) {
			toast.success(t("onboarding.workSchedule.success", "Work schedule set successfully!"));
			router.push(result.data.nextStep);
		} else {
			toast.error(
				result.error || t("onboarding.workSchedule.error", "Failed to set work schedule"),
			);
		}
	}

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
						<Form {...form}>
							<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
								{/* Hours Per Week */}
								<FormField
									control={form.control}
									name="hoursPerWeek"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("onboarding.workSchedule.hoursPerWeek", "Hours per Week")}
											</FormLabel>
											<FormControl>
												<Input
													{...field}
													type="number"
													min={0}
													max={168}
													placeholder="40"
													disabled={loading}
													onChange={(e) => field.onChange(parseFloat(e.target.value))}
												/>
											</FormControl>
											<FormDescription>
												{t(
													"onboarding.workSchedule.hoursPerWeekDesc",
													"Typical full-time is 40 hours per week.",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Work Classification */}
								<FormField
									control={form.control}
									name="workClassification"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("onboarding.workSchedule.classification", "Work Classification")}
											</FormLabel>
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value}
												disabled={loading}
											>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder="Select classification" />
													</SelectTrigger>
												</FormControl>
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
											<FormDescription>
												{t(
													"onboarding.workSchedule.classificationDesc",
													"How you want to track your working hours.",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

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
						</Form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
