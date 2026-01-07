"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
	IconCalendar,
	IconGenderBigender,
	IconGenderFemale,
	IconGenderMale,
	IconLoader2,
	IconUser,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { format } from "@/lib/datetime/luxon-utils";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { cn } from "@/lib/utils";
import {
	onboardingProfileSchema,
	type OnboardingProfileFormValues,
} from "@/lib/validations/onboarding";
import { useRouter } from "@/navigation";
import { updateProfileOnboarding, skipProfileSetup } from "./actions";

export default function ProfilePage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);

	const form = useForm<OnboardingProfileFormValues>({
		resolver: zodResolver(onboardingProfileSchema),
		defaultValues: {
			firstName: "",
			lastName: "",
			gender: undefined,
			birthday: undefined,
		},
	});

	async function onSubmit(values: OnboardingProfileFormValues) {
		setLoading(true);

		const result = await updateProfileOnboarding(values);

		setLoading(false);

		if (result.success) {
			toast.success(t("onboarding.profile.success", "Profile updated successfully!"));
			router.push("/onboarding/work-schedule");
		} else {
			toast.error(result.error || t("onboarding.profile.error", "Failed to update profile"));
		}
	}

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
		{ value: "male", label: t("common.gender.male", "Male"), icon: IconGenderMale },
		{ value: "female", label: t("common.gender.female", "Female"), icon: IconGenderFemale },
		{ value: "other", label: t("common.gender.other", "Other"), icon: IconGenderBigender },
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
						<Form {...form}>
							<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
								{/* First Name */}
								<FormField
									control={form.control}
									name="firstName"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("onboarding.profile.firstName", "First Name")}</FormLabel>
											<FormControl>
												<Input
													{...field}
													placeholder={t("onboarding.profile.firstNamePlaceholder", "John")}
													disabled={loading}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Last Name */}
								<FormField
									control={form.control}
									name="lastName"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("onboarding.profile.lastName", "Last Name")}</FormLabel>
											<FormControl>
												<Input
													{...field}
													placeholder={t("onboarding.profile.lastNamePlaceholder", "Doe")}
													disabled={loading}
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Gender (Optional) */}
								<FormField
									control={form.control}
									name="gender"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("onboarding.profile.gender", "Gender")} (Optional)</FormLabel>
											<FormControl>
												<div className="grid grid-cols-3 gap-3">
													{genderOptions.map((option) => {
														const Icon = option.icon;
														return (
															<Button
																key={option.value}
																type="button"
																variant={field.value === option.value ? "default" : "outline"}
																className="h-auto flex-col gap-2 py-4"
																onClick={() => field.onChange(option.value)}
																disabled={loading}
															>
																<Icon className="h-6 w-6" />
																<span className="text-sm">{option.label}</span>
															</Button>
														);
													})}
												</div>
											</FormControl>
											<FormDescription>
												{t("onboarding.profile.genderDesc", "This helps personalize your experience.")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Birthday (Optional) */}
								<FormField
									control={form.control}
									name="birthday"
									render={({ field }) => (
										<FormItem className="flex flex-col">
											<FormLabel>{t("onboarding.profile.birthday", "Birthday")} (Optional)</FormLabel>
											<Popover>
												<PopoverTrigger asChild>
													<FormControl>
														<Button
															variant="outline"
															className={cn(
																"w-full pl-3 text-left font-normal",
																!field.value && "text-muted-foreground"
															)}
															disabled={loading}
														>
															{field.value ? (
																format(field.value, "PPP")
															) : (
																<span>{t("onboarding.profile.pickDate", "Pick a date")}</span>
															)}
															<IconCalendar className="ml-auto h-4 w-4 opacity-50" />
														</Button>
													</FormControl>
												</PopoverTrigger>
												<PopoverContent className="w-auto p-0" align="start">
													<Calendar
														mode="single"
														selected={field.value}
														onSelect={field.onChange}
														disabled={(date) => date > new Date() || date < new Date("1900-01-01")}
														initialFocus
													/>
												</PopoverContent>
											</Popover>
											<FormDescription>
												{t("onboarding.profile.birthdayDesc", "Your team can wish you a happy birthday!")}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Action Buttons */}
								<div className="flex gap-3 pt-4">
									<Button type="button" variant="outline" onClick={handleSkip} disabled={loading} className="flex-1">
										{t("onboarding.profile.skip", "Skip for now")}
									</Button>
									<Button type="submit" disabled={loading} className="flex-1">
										{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
										{t("onboarding.profile.continue", "Continue")}
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
