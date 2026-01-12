"use client";

import { useForm } from "@tanstack/react-form";
import { zodValidator } from "@tanstack/zod-form-adapter";
import {
	IconCalendar,
	IconGenderBigender,
	IconGenderFemale,
	IconGenderMale,
	IconLoader2,
	IconUser,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "@/lib/datetime/luxon-utils";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";
import { skipProfileSetup, updateProfileOnboarding } from "./actions";

const defaultValues = {
	firstName: "",
	lastName: "",
	gender: undefined as "male" | "female" | "other" | undefined,
	birthday: undefined as Date | undefined,
};

export default function ProfilePage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const form = useForm({
		defaultValues,
		validatorAdapter: zodValidator(),
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await updateProfileOnboarding(value);

			setLoading(false);

			if (result.success) {
				toast.success(t("onboarding.profile.success", "Profile updated successfully!"));
				router.push("/onboarding/work-schedule");
			} else {
				toast.error(result.error || t("onboarding.profile.error", "Failed to update profile"));
			}
		},
	});

	async function handleSkip() {
		setLoading(true);

		const result = await skipProfileSetup();

		setLoading(false);

		if (result.success) {
			router.push("/onboarding/work-schedule");
		} else {
			toast.error(result.error || "Failed to skip profile setup");
		}
	}

	const genderOptions = [
		{ value: "male" as const, label: t("common.gender.male", "Male"), icon: IconGenderMale },
		{ value: "female" as const, label: t("common.gender.female", "Female"), icon: IconGenderFemale },
		{ value: "other" as const, label: t("common.gender.other", "Other"), icon: IconGenderBigender },
	];

	return (
		<>
			<ProgressIndicator currentStep="profile" />

			<div className="mx-auto max-w-2xl">
				<div className="mb-8 text-center">
					<div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
						<IconUser className="size-8 text-primary" />
					</div>
					<h1 className="mb-4 text-3xl font-bold tracking-tight">
						{t("onboarding.profile.title", "Complete your profile")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"onboarding.profile.subtitle",
							"Help your team recognize you by adding some personal information.",
						)}
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>{t("onboarding.profile.personalInfo", "Personal Information")}</CardTitle>
						<CardDescription>
							{t(
								"onboarding.profile.personalInfoDesc",
								"This information will be visible to your team members.",
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
							{/* First Name */}
							<form.Field
								name="firstName"
								validators={{
									onChange: z.string().min(1, "First name is required").max(50),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>{t("onboarding.profile.firstName", "First Name")}</Label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t("onboarding.profile.firstNamePlaceholder", "John")}
											disabled={loading}
										/>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm font-medium text-destructive">
												{field.state.meta.errors[0]}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Last Name */}
							<form.Field
								name="lastName"
								validators={{
									onChange: z.string().min(1, "Last name is required").max(50),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>{t("onboarding.profile.lastName", "Last Name")}</Label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t("onboarding.profile.lastNamePlaceholder", "Doe")}
											disabled={loading}
										/>
										{field.state.meta.errors.length > 0 && (
											<p className="text-sm font-medium text-destructive">
												{field.state.meta.errors[0]}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Gender (Optional) */}
							<form.Field name="gender">
								{(field) => (
									<div className="space-y-2">
										<Label>{t("onboarding.profile.gender", "Gender")} (Optional)</Label>
										<div className="grid grid-cols-3 gap-3">
											{genderOptions.map((option) => {
												const Icon = option.icon;
												return (
													<Button
														key={option.value}
														type="button"
														variant={field.state.value === option.value ? "default" : "outline"}
														className="h-auto flex-col gap-2 py-4"
														onClick={() => field.handleChange(option.value)}
														disabled={loading}
													>
														<Icon className="h-6 w-6" />
														<span className="text-sm">{option.label}</span>
													</Button>
												);
											})}
										</div>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.profile.genderDesc",
												"This helps personalize your experience.",
											)}
										</p>
									</div>
								)}
							</form.Field>

							{/* Birthday (Optional) */}
							<form.Field name="birthday">
								{(field) => (
									<div className="flex flex-col space-y-2">
										<Label>
											{t("onboarding.profile.birthday", "Birthday")} (Optional)
										</Label>
										<Popover>
											<PopoverTrigger asChild>
												<Button
													variant="outline"
													className={cn(
														"w-full pl-3 text-left font-normal",
														!field.state.value && "text-muted-foreground",
													)}
													disabled={loading}
												>
													{field.state.value ? (
														format(field.state.value, "PPP")
													) : (
														<span>{t("onboarding.profile.pickDate", "Pick a date")}</span>
													)}
													<IconCalendar className="ml-auto h-4 w-4 opacity-50" />
												</Button>
											</PopoverTrigger>
											<PopoverContent className="w-auto p-0" align="start">
												<Calendar
													mode="single"
													selected={field.state.value}
													onSelect={field.handleChange}
													disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
													captionLayout="dropdown"
													startMonth={new Date(1900, 0)}
													endMonth={new Date()}
													defaultMonth={field.state.value || new Date(2000, 0)}
													initialFocus
												/>
											</PopoverContent>
										</Popover>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.profile.birthdayDesc",
												"Your team can wish you a happy birthday!",
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
									{t("onboarding.profile.skip", "Skip for now")}
								</Button>
								<Button type="submit" disabled={loading} className="flex-1">
									{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
									{t("onboarding.profile.continue", "Continue")}
								</Button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
