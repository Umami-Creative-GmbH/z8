"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { IconBeach, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { useRouter } from "@/navigation";
import { checkIsAdmin, createVacationPolicyOnboarding, skipVacationPolicySetup } from "./actions";

export default function VacationPolicyPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

	const form = useForm({
		defaultValues: {
			name: t("onboarding.vacationPolicy.defaultName", "Standard"),
			defaultAnnualDays: 25,
			accrualType: "annual" as "annual" | "monthly" | "biweekly",
			allowCarryover: true,
			maxCarryoverDays: 5,
		},
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await createVacationPolicyOnboarding(value);

			setLoading(false);

			if (result.success) {
				toast.success(t("onboarding.vacationPolicy.success", "Vacation policy created!"));
				router.push("/onboarding/holiday-setup");
			} else {
				toast.error(
					result.error || t("onboarding.vacationPolicy.error", "Failed to create vacation policy"),
				);
			}
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

	const allowCarryover = useStore(form.store, (state) => state.values.allowCarryover);

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
						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-6"
						>
							{/* Policy Name */}
							<form.Field
								name="name"
								validators={{
									onChange: z.string().min(1, "Policy name is required").max(100),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>{t("onboarding.vacationPolicy.name", "Policy Name")}</Label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"onboarding.vacationPolicy.namePlaceholder",
												"e.g., Standard, Senior",
											)}
											disabled={loading}
										/>
										<p className="text-sm text-muted-foreground">
											{t("onboarding.vacationPolicy.nameDesc", "A name to identify this policy.")}
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm font-medium text-destructive">
												{typeof field.state.meta.errors[0] === "string"
												? field.state.meta.errors[0]
												: (field.state.meta.errors[0] as any)?.message}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Annual Days */}
							<form.Field
								name="defaultAnnualDays"
								validators={{
									onChange: z.number().min(0).max(365),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t("onboarding.vacationPolicy.annualDays", "Annual Vacation Days")}
										</Label>
										<Input
											type="number"
											min={0}
											max={365}
											placeholder="25"
											disabled={loading}
											value={field.state.value}
											onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 0)}
											onBlur={field.handleBlur}
										/>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.vacationPolicy.annualDaysDesc",
												"Number of vacation days per year.",
											)}
										</p>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm font-medium text-destructive">
												{typeof field.state.meta.errors[0] === "string"
												? field.state.meta.errors[0]
												: (field.state.meta.errors[0] as any)?.message}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Accrual Type */}
							<form.Field name="accrualType">
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t("onboarding.vacationPolicy.accrualType", "Accrual Type")}
										</Label>
										<Select
											onValueChange={(value) =>
												field.handleChange(value as "annual" | "monthly" | "biweekly")
											}
											value={field.state.value}
											disabled={loading}
										>
											<SelectTrigger>
												<SelectValue placeholder="Select accrual type" />
											</SelectTrigger>
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
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.vacationPolicy.accrualTypeDesc",
												"How vacation days are granted throughout the year.",
											)}
										</p>
									</div>
								)}
							</form.Field>

							{/* Allow Carryover */}
							<form.Field name="allowCarryover">
								{(field) => (
									<div className="flex flex-row items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label className="text-base">
												{t("onboarding.vacationPolicy.allowCarryover", "Allow Carryover")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"onboarding.vacationPolicy.allowCarryoverDesc",
													"Allow unused days to be carried to next year.",
												)}
											</p>
										</div>
										<Switch
											checked={field.state.value}
											onCheckedChange={field.handleChange}
											disabled={loading}
										/>
									</div>
								)}
							</form.Field>

							{/* Max Carryover Days */}
							{allowCarryover && (
								<form.Field
									name="maxCarryoverDays"
									validators={{
										onChange: z.number().min(0).max(365),
									}}
								>
									{(field) => (
										<div className="space-y-2">
											<Label>
												{t("onboarding.vacationPolicy.maxCarryover", "Max Carryover Days")}
											</Label>
											<Input
												type="number"
												min={0}
												max={365}
												placeholder="5"
												disabled={loading}
												value={field.state.value}
												onChange={(e) => field.handleChange(parseInt(e.target.value, 10) || 0)}
												onBlur={field.handleBlur}
											/>
											<p className="text-sm text-muted-foreground">
												{t(
													"onboarding.vacationPolicy.maxCarryoverDesc",
													"Maximum days that can be carried over.",
												)}
											</p>
											{field.state.meta.errors.length > 0 && (
												<p className="text-sm font-medium text-destructive">
													{typeof field.state.meta.errors[0] === "string"
												? field.state.meta.errors[0]
												: (field.state.meta.errors[0] as any)?.message}
												</p>
											)}
										</div>
									)}
								</form.Field>
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
					</CardContent>
				</Card>
			</div>
		</>
	);
}
