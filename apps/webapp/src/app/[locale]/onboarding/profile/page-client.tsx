"use client";

import {
	IconCalendar,
	IconGenderBigender,
	IconGenderFemale,
	IconGenderMale,
	IconLoader2,
	IconUser,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { format } from "@/lib/datetime/luxon-utils";
import { TIME_FORMAT_OPTIONS, type TimeFormat } from "@/lib/user-preferences/time-format";
import { WEEK_START_OPTIONS, type WeekStartDay } from "@/lib/user-preferences/week-start";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";
import { skipProfileSetup, updateProfileOnboarding } from "./actions";

const defaultValues = {
	firstName: "",
	lastName: "",
	gender: undefined as "male" | "female" | "other" | undefined,
	birthday: undefined as Date | undefined,
	weekStartDay: "monday" as WeekStartDay,
	timeFormat: "24h" as TimeFormat,
	helpImproveProduct: true,
};

const BIRTHDAY_START_MONTH = new Date(1900, 0);
const BIRTHDAY_DEFAULT_MONTH = new Date(2000, 0);
const TODAY_SNAPSHOT = new Date();

function subscribeTodaySnapshot() {
	return () => undefined;
}

function getTodaySnapshot() {
	return TODAY_SNAPSHOT;
}

function getServerTodaySnapshot() {
	return null;
}

export default function ProfilePage() {
	const { t } = useTranslate();
	const { push } = useRouter();
	const [loading, setLoading] = useState(false);
	const today = useSyncExternalStore(
		subscribeTodaySnapshot,
		getTodaySnapshot,
		getServerTodaySnapshot,
	);

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await updateProfileOnboarding(value);

			if (result.success) {
				toast.success(t("onboarding.profile.success", "Profile updated successfully!"));
				push(result.data.nextStep);
			} else {
				setLoading(false);
				toast.error(result.error || t("onboarding.profile.error", "Failed to update profile"));
			}
		},
	});

	async function handleSkip() {
		setLoading(true);

		const result = await skipProfileSetup();

		if (result.success) {
			push(result.data.nextStep);
		} else {
			setLoading(false);
			toast.error(
				result.error || t("onboarding.profile.skipError", "Failed to skip profile setup"),
			);
		}
	}

	const genderOptions = [
		{ value: "male" as const, label: t("common.gender.male", "Male"), icon: IconGenderMale },
		{
			value: "female" as const,
			label: t("common.gender.female", "Female"),
			icon: IconGenderFemale,
		},
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
							action={() => {
								void form.handleSubmit();
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
									<div className="gap-y-2">
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
												{typeof field.state.meta.errors[0] === "string"
													? field.state.meta.errors[0]
													: (field.state.meta.errors[0] as any)?.message}
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
									<div className="gap-y-2">
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
												{typeof field.state.meta.errors[0] === "string"
													? field.state.meta.errors[0]
													: (field.state.meta.errors[0] as any)?.message}
											</p>
										)}
									</div>
								)}
							</form.Field>

							{/* Gender (Optional) */}
							<form.Field name="gender">
								{(field) => (
									<div className="gap-y-2">
										<Label>{t("onboarding.profile.genderOptional", "Gender (Optional)")}</Label>
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
														<Icon className="size-6" />
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
									<div className="flex flex-col gap-y-2">
										<Label>{t("onboarding.profile.birthdayOptional", "Birthday (Optional)")}</Label>
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
													<IconCalendar className="ml-auto size-4 opacity-50" />
												</Button>
											</PopoverTrigger>
											<PopoverContent className="w-auto p-0" align="start">
												<Calendar
													mode="single"
													selected={field.state.value}
													onSelect={field.handleChange}
													disabled={(date) =>
														(today ? date > today : false) || date < BIRTHDAY_START_MONTH
													}
													captionLayout="dropdown"
													startMonth={BIRTHDAY_START_MONTH}
													endMonth={today ?? undefined}
													defaultMonth={field.state.value || BIRTHDAY_DEFAULT_MONTH}
													autoFocus
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

							<form.Field name="weekStartDay">
								{(field) => (
									<div className="gap-y-2">
										<Label htmlFor="week-start-day">
											{t("onboarding.profile.weekStartDay", "First day of the week")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as WeekStartDay)}
											disabled={loading}
										>
											<SelectTrigger id="week-start-day" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{WEEK_START_OPTIONS.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.profile.weekStartDayDesc",
												"This controls how calendars and weekly summaries are displayed.",
											)}
										</p>
									</div>
								)}
							</form.Field>

							<form.Field name="timeFormat">
								{(field) => (
									<div className="gap-y-2">
										<Label htmlFor="time-format">
											{t("onboarding.profile.timeFormat", "Time format")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(value) => field.handleChange(value as TimeFormat)}
											disabled={loading}
										>
											<SelectTrigger id="time-format" className="w-full">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												{TIME_FORMAT_OPTIONS.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.value === "24h"
															? t("onboarding.profile.timeFormat24h", "24-hour (08:00)")
															: t("onboarding.profile.timeFormat12h", "12-hour (8:00 AM)")}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.profile.timeFormatDesc",
												"This controls how clock times are displayed.",
											)}
										</p>
									</div>
								)}
							</form.Field>

							<form.Field name="helpImproveProduct">
								{(field) => (
									<div className="rounded-lg border bg-muted/30 p-4">
										<div className="flex items-start justify-between gap-4">
											<div className="space-y-1">
												<Label htmlFor="help-improve-product">
													{t("onboarding.profile.helpImproveProduct", "Help us improve this app")}
												</Label>
												<p className="text-sm text-muted-foreground">
													{t(
														"onboarding.profile.helpImproveProductDesc",
														"Share usage insights so we can make Z8 more reliable and useful. You can change this later in your profile settings.",
													)}
												</p>
											</div>
											<Checkbox
												id="help-improve-product"
												checked={field.state.value}
												onCheckedChange={(checked) => field.handleChange(checked === true)}
												disabled={loading}
												aria-label={t(
													"onboarding.profile.helpImproveProduct",
													"Help us improve this app",
												)}
											/>
										</div>
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
