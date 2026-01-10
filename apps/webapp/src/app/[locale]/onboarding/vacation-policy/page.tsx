"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconBeach, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
	type OnboardingVacationPolicyFormValues,
	onboardingVacationPolicySchema,
} from "@/lib/validations/onboarding";
import { useRouter } from "@/navigation";
import { checkIsAdmin, createVacationPolicyOnboarding, skipVacationPolicySetup } from "./actions";

export default function VacationPolicyPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

	const form = useForm<OnboardingVacationPolicyFormValues>({
		resolver: zodResolver(onboardingVacationPolicySchema),
		defaultValues: {
			name: t("onboarding.vacationPolicy.defaultName", "Standard"),
			defaultAnnualDays: 25,
			accrualType: "annual",
			allowCarryover: true,
			maxCarryoverDays: 5,
		},
	});

	// Check if user is admin, redirect if not
	useEffect(() => {
		async function checkAdmin() {
			const result = await checkIsAdmin();
			if (result.success) {
				setIsAdmin(result.data);
				if (!result.data) {
					// Not an admin, skip to notifications
					router.push("/onboarding/notifications");
				}
			} else {
				// Error checking admin status, redirect to notifications
				router.push("/onboarding/notifications");
			}
		}
		checkAdmin();
	}, [router]);

	const allowCarryover = form.watch("allowCarryover");

	async function onSubmit(values: OnboardingVacationPolicyFormValues) {
		setLoading(true);

		const result = await createVacationPolicyOnboarding(values);

		setLoading(false);

		if (result.success) {
			toast.success(t("onboarding.vacationPolicy.success", "Vacation policy created!"));
			router.push("/onboarding/holiday-setup");
		} else {
			toast.error(
				result.error || t("onboarding.vacationPolicy.error", "Failed to create vacation policy"),
			);
		}
	}

	async function handleSkip() {
		setLoading(true);

		const result = await skipVacationPolicySetup();

		setLoading(false);

		if (result.success) {
			router.push("/onboarding/holiday-setup");
		} else {
			toast.error(result.error || "Failed to skip vacation policy setup");
		}
	}

	// Show loading while checking admin status
	if (isAdmin === null) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<div className="text-center">
					<div className="inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
					<p className="mt-4 text-muted-foreground">{t("common.loading", "Loading...")}</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<ProgressIndicator currentStep="vacation_policy" />

			<div className="mx-auto max-w-2xl">
				<div className="mb-8 text-center">
					<div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
						<IconBeach className="size-8 text-primary" />
					</div>
					<h1 className="mb-4 text-3xl font-bold tracking-tight">
						{t("onboarding.vacationPolicy.title", "Set up vacation policy")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"onboarding.vacationPolicy.subtitle",
							"Create a vacation policy for your organization. This determines how many days off employees get.",
						)}
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>{t("onboarding.vacationPolicy.cardTitle", "Vacation Policy")}</CardTitle>
						<CardDescription>
							{t(
								"onboarding.vacationPolicy.cardDesc",
								"Configure vacation allowance for your team. You can customize this later in settings.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Form {...form}>
							<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
								{/* Policy Name */}
								<FormField
									control={form.control}
									name="name"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("onboarding.vacationPolicy.name", "Policy Name")}</FormLabel>
											<FormControl>
												<Input
													{...field}
													placeholder={t(
														"onboarding.vacationPolicy.namePlaceholder",
														"e.g., Standard, Senior",
													)}
													disabled={loading}
												/>
											</FormControl>
											<FormDescription>
												{t("onboarding.vacationPolicy.nameDesc", "A name to identify this policy.")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Annual Days */}
								<FormField
									control={form.control}
									name="defaultAnnualDays"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("onboarding.vacationPolicy.annualDays", "Annual Vacation Days")}
											</FormLabel>
											<FormControl>
												<Input
													{...field}
													type="number"
													min={0}
													max={365}
													placeholder="25"
													disabled={loading}
													onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
												/>
											</FormControl>
											<FormDescription>
												{t(
													"onboarding.vacationPolicy.annualDaysDesc",
													"Number of vacation days per year.",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Accrual Type */}
								<FormField
									control={form.control}
									name="accrualType"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("onboarding.vacationPolicy.accrualType", "Accrual Type")}
											</FormLabel>
											<Select
												onValueChange={field.onChange}
												defaultValue={field.value}
												disabled={loading}
											>
												<FormControl>
													<SelectTrigger>
														<SelectValue placeholder="Select accrual type" />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													<SelectItem value="annual">
														{t("onboarding.vacationPolicy.annual", "Annual (all at once)")}
													</SelectItem>
													<SelectItem value="monthly">
														{t("onboarding.vacationPolicy.monthly", "Monthly accrual")}
													</SelectItem>
													<SelectItem value="biweekly">
														{t("onboarding.vacationPolicy.biweekly", "Biweekly accrual")}
													</SelectItem>
												</SelectContent>
											</Select>
											<FormDescription>
												{t(
													"onboarding.vacationPolicy.accrualTypeDesc",
													"How vacation days are granted throughout the year.",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Allow Carryover */}
								<FormField
									control={form.control}
									name="allowCarryover"
									render={({ field }) => (
										<FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
											<div className="space-y-0.5">
												<FormLabel className="text-base">
													{t("onboarding.vacationPolicy.allowCarryover", "Allow Carryover")}
												</FormLabel>
												<FormDescription>
													{t(
														"onboarding.vacationPolicy.allowCarryoverDesc",
														"Allow unused days to be carried to next year.",
													)}
												</FormDescription>
											</div>
											<FormControl>
												<Switch
													checked={field.value}
													onCheckedChange={field.onChange}
													disabled={loading}
												/>
											</FormControl>
										</FormItem>
									)}
								/>

								{/* Max Carryover Days */}
								{allowCarryover && (
									<FormField
										control={form.control}
										name="maxCarryoverDays"
										render={({ field }) => (
											<FormItem>
												<FormLabel>
													{t("onboarding.vacationPolicy.maxCarryover", "Max Carryover Days")}
												</FormLabel>
												<FormControl>
													<Input
														{...field}
														type="number"
														min={0}
														max={365}
														placeholder="5"
														disabled={loading}
														onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
													/>
												</FormControl>
												<FormDescription>
													{t(
														"onboarding.vacationPolicy.maxCarryoverDesc",
														"Maximum days that can be carried over.",
													)}
												</FormDescription>
												<FormMessage />
											</FormItem>
										)}
									/>
								)}

								{/* Action Buttons */}
								<div className="flex gap-3 pt-4">
									<Button
										type="button"
										variant="outline"
										onClick={handleSkip}
										disabled={loading}
										className="flex-1"
									>
										{t("onboarding.vacationPolicy.skip", "Skip for now")}
									</Button>
									<Button type="submit" disabled={loading} className="flex-1">
										{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
										{t("onboarding.vacationPolicy.continue", "Continue")}
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
