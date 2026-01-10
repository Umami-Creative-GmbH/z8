"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { IconCalendarEvent, IconCheck, IconLoader2, IconSelector } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Command,
	CommandEmpty,
	CommandGroup,
	CommandInput,
	CommandItem,
	CommandList,
} from "@/components/ui/command";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
	type OnboardingHolidaySetupFormValues,
	onboardingHolidaySetupSchema,
} from "@/lib/validations/onboarding";
import { useRouter } from "@/navigation";
import { checkIsAdmin, createHolidayPresetOnboarding, skipHolidaySetup } from "./actions";

interface CountryOption {
	code: string;
	name: string;
}

export default function HolidaySetupPage() {
	const { t } = useTranslate();
	const router = useRouter();
	const [loading, setLoading] = useState(false);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
	const [countries, setCountries] = useState<CountryOption[]>([]);
	const [countriesLoading, setCountriesLoading] = useState(false);
	const [countryOpen, setCountryOpen] = useState(false);

	const form = useForm<OnboardingHolidaySetupFormValues>({
		resolver: zodResolver(onboardingHolidaySetupSchema),
		defaultValues: {
			countryCode: "",
			stateCode: "",
			presetName: "",
			setAsDefault: true,
		},
	});

	const selectedCountry = form.watch("countryCode");

	// Check if user is admin, redirect if not
	useEffect(() => {
		async function checkAdmin() {
			const result = await checkIsAdmin();
			if (result.success) {
				setIsAdmin(result.data);
				if (!result.data) {
					router.push("/onboarding/notifications");
				}
			} else {
				router.push("/onboarding/notifications");
			}
		}
		checkAdmin();
	}, [router]);

	// Load countries
	useEffect(() => {
		async function loadCountries() {
			setCountriesLoading(true);
			try {
				const response = await fetch("/api/location/countries");
				if (response.ok) {
					const data = await response.json();
					setCountries(data.countries);
				}
			} catch (error) {
				console.error("Failed to load countries:", error);
			} finally {
				setCountriesLoading(false);
			}
		}
		loadCountries();
	}, []);

	// Auto-generate preset name from country
	useEffect(() => {
		if (selectedCountry) {
			const countryName =
				countries.find((c) => c.code === selectedCountry)?.name || selectedCountry;
			form.setValue("presetName", `${countryName} Holidays`);
		}
	}, [selectedCountry, countries, form]);

	async function onSubmit(values: OnboardingHolidaySetupFormValues) {
		setLoading(true);

		const result = await createHolidayPresetOnboarding(values);

		setLoading(false);

		if (result.success) {
			toast.success(t("onboarding.holidaySetup.success", "Holiday preset created!"));
			router.push("/onboarding/work-templates");
		} else {
			toast.error(
				result.error || t("onboarding.holidaySetup.error", "Failed to create holiday preset"),
			);
		}
	}

	async function handleSkip() {
		setLoading(true);

		const result = await skipHolidaySetup();

		setLoading(false);

		if (result.success) {
			router.push("/onboarding/work-templates");
		} else {
			toast.error(result.error || "Failed to skip holiday setup");
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

	const selectedCountryName = countries.find((c) => c.code === selectedCountry)?.name;

	return (
		<>
			<ProgressIndicator currentStep="holiday_setup" />

			<div className="mx-auto max-w-2xl">
				<div className="mb-8 text-center">
					<div className="mb-4 inline-flex size-16 items-center justify-center rounded-full bg-primary/10">
						<IconCalendarEvent className="size-8 text-primary" />
					</div>
					<h1 className="mb-4 text-3xl font-bold tracking-tight">
						{t("onboarding.holidaySetup.title", "Set up holidays")}
					</h1>
					<p className="text-muted-foreground">
						{t(
							"onboarding.holidaySetup.subtitle",
							"Select your country to import public holidays. This helps track time off accurately.",
						)}
					</p>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>{t("onboarding.holidaySetup.cardTitle", "Holiday Preset")}</CardTitle>
						<CardDescription>
							{t(
								"onboarding.holidaySetup.cardDesc",
								"Choose your country to import public holidays. You can customize holidays later in settings.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Form {...form}>
							<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
								{/* Country Selection */}
								<FormField
									control={form.control}
									name="countryCode"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("onboarding.holidaySetup.country", "Country")}</FormLabel>
											<Popover open={countryOpen} onOpenChange={setCountryOpen}>
												<PopoverTrigger asChild>
													<FormControl>
														<Button
															variant="outline"
															role="combobox"
															aria-expanded={countryOpen}
															className="w-full justify-between font-normal"
															disabled={countriesLoading || loading}
														>
															{selectedCountryName ||
																t("onboarding.holidaySetup.selectCountry", "Select a country")}
															<IconSelector className="ml-2 h-4 w-4 shrink-0 opacity-50" />
														</Button>
													</FormControl>
												</PopoverTrigger>
												<PopoverContent
													className="w-[--radix-popover-trigger-width] p-0"
													align="start"
												>
													<Command>
														<CommandInput
															placeholder={t(
																"onboarding.holidaySetup.searchCountry",
																"Search countries...",
															)}
														/>
														<CommandList>
															<CommandEmpty>
																{t("onboarding.holidaySetup.noCountry", "No country found")}
															</CommandEmpty>
															<CommandGroup>
																{countries.map((country) => (
																	<CommandItem
																		key={country.code}
																		value={country.name}
																		onSelect={() => {
																			field.onChange(country.code);
																			setCountryOpen(false);
																		}}
																	>
																		<IconCheck
																			className={cn(
																				"mr-2 h-4 w-4",
																				field.value === country.code ? "opacity-100" : "opacity-0",
																			)}
																		/>
																		{country.name}
																	</CommandItem>
																))}
															</CommandGroup>
														</CommandList>
													</Command>
												</PopoverContent>
											</Popover>
											<FormDescription>
												{t(
													"onboarding.holidaySetup.countryDesc",
													"Public holidays will be imported based on your selection.",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Preset Name */}
								<FormField
									control={form.control}
									name="presetName"
									render={({ field }) => (
										<FormItem>
											<FormLabel>
												{t("onboarding.holidaySetup.presetName", "Preset Name")}
											</FormLabel>
											<FormControl>
												<Input
													{...field}
													placeholder={t(
														"onboarding.holidaySetup.presetNamePlaceholder",
														"e.g., Germany Holidays",
													)}
													disabled={loading}
												/>
											</FormControl>
											<FormDescription>
												{t(
													"onboarding.holidaySetup.presetNameDesc",
													"A name to identify this holiday preset.",
												)}
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								{/* Set as Default */}
								<FormField
									control={form.control}
									name="setAsDefault"
									render={({ field }) => (
										<FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
											<div className="space-y-0.5">
												<FormLabel className="text-base">
													{t("onboarding.holidaySetup.setAsDefault", "Set as organization default")}
												</FormLabel>
												<FormDescription>
													{t(
														"onboarding.holidaySetup.setAsDefaultDesc",
														"Apply this holiday preset to all employees.",
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

								{/* Action Buttons */}
								<div className="flex gap-3 pt-4">
									<Button
										type="button"
										variant="outline"
										onClick={handleSkip}
										disabled={loading}
										className="flex-1"
									>
										{t("onboarding.holidaySetup.skip", "Skip for now")}
									</Button>
									<Button type="submit" disabled={loading || !selectedCountry} className="flex-1">
										{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
										{t("onboarding.holidaySetup.continue", "Continue")}
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
