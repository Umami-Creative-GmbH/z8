"use client";

import { useForm } from "@tanstack/react-form";
import { useStore } from "@tanstack/react-store";
import { zodValidator } from "@tanstack/zod-form-adapter";
import { IconCalendarEvent, IconCheck, IconLoader2, IconSelector } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
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

	const form = useForm({
		defaultValues: {
			countryCode: "",
			stateCode: "",
			presetName: "",
			setAsDefault: true,
		},
		validatorAdapter: zodValidator(),
		onSubmit: async ({ value }) => {
			setLoading(true);

			const result = await createHolidayPresetOnboarding(value);

			setLoading(false);

			if (result.success) {
				toast.success(t("onboarding.holidaySetup.success", "Holiday preset created!"));
				router.push("/onboarding/work-templates");
			} else {
				toast.error(
					result.error || t("onboarding.holidaySetup.error", "Failed to create holiday preset"),
				);
			}
		},
	});

	const selectedCountry = useStore(form.store, (state) => state.values.countryCode);

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
			form.setFieldValue("presetName", `${countryName} Holidays`);
		}
	}, [selectedCountry, countries, form]);

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
						<form
							onSubmit={(e) => {
								e.preventDefault();
								form.handleSubmit();
							}}
							className="space-y-6"
						>
							{/* Country Selection */}
							<form.Field
								name="countryCode"
								validators={{
									onChange: z.string().min(1, "Please select a country"),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>{t("onboarding.holidaySetup.country", "Country")}</Label>
										<Popover open={countryOpen} onOpenChange={setCountryOpen}>
											<PopoverTrigger asChild>
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
																		field.handleChange(country.code);
																		setCountryOpen(false);
																	}}
																>
																	<IconCheck
																		className={cn(
																			"mr-2 h-4 w-4",
																			field.state.value === country.code ? "opacity-100" : "opacity-0",
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
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.holidaySetup.countryDesc",
												"Public holidays will be imported based on your selection.",
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

							{/* Preset Name */}
							<form.Field
								name="presetName"
								validators={{
									onChange: z.string().min(1, "Preset name is required").max(100),
								}}
							>
								{(field) => (
									<div className="space-y-2">
										<Label>
											{t("onboarding.holidaySetup.presetName", "Preset Name")}
										</Label>
										<Input
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											onBlur={field.handleBlur}
											placeholder={t(
												"onboarding.holidaySetup.presetNamePlaceholder",
												"e.g., Germany Holidays",
											)}
											disabled={loading}
										/>
										<p className="text-sm text-muted-foreground">
											{t(
												"onboarding.holidaySetup.presetNameDesc",
												"A name to identify this holiday preset.",
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

							{/* Set as Default */}
							<form.Field name="setAsDefault">
								{(field) => (
									<div className="flex flex-row items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<Label className="text-base">
												{t("onboarding.holidaySetup.setAsDefault", "Set as organization default")}
											</Label>
											<p className="text-sm text-muted-foreground">
												{t(
													"onboarding.holidaySetup.setAsDefaultDesc",
													"Apply this holiday preset to all employees.",
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
					</CardContent>
				</Card>
			</div>
		</>
	);
}
