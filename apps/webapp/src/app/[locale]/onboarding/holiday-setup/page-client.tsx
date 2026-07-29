"use client";

import {
	IconCalendarEvent,
	IconCheck,
	IconLoader2,
	IconSelector,
} from "@tabler/icons-react";
import {
	type FormAsyncValidateOrFn,
	type FormValidateOrFn,
	type ReactFormExtendedApi,
	useForm,
	useStore,
} from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { ProgressIndicator } from "@/components/onboarding/progress-indicator";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
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
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useRouter } from "@/navigation";
import { runOnboardingAction } from "../run-onboarding-action";
import {
	checkIsAdmin,
	createHolidayPresetOnboarding,
	skipHolidaySetup,
} from "./actions";

interface CountryOption {
	code: string;
	name: string;
}

const defaultValues = {
	countryCode: "",
	stateCode: "",
	presetName: "",
	setAsDefault: true,
};

type HolidaySetupValues = typeof defaultValues;
type HolidaySetupForm = ReactFormExtendedApi<
	HolidaySetupValues,
	FormValidateOrFn<HolidaySetupValues> | undefined,
	FormValidateOrFn<HolidaySetupValues> | undefined,
	FormAsyncValidateOrFn<HolidaySetupValues> | undefined,
	FormValidateOrFn<HolidaySetupValues> | undefined,
	FormAsyncValidateOrFn<HolidaySetupValues> | undefined,
	FormValidateOrFn<HolidaySetupValues> | undefined,
	FormAsyncValidateOrFn<HolidaySetupValues> | undefined,
	FormValidateOrFn<HolidaySetupValues> | undefined,
	FormAsyncValidateOrFn<HolidaySetupValues> | undefined,
	FormAsyncValidateOrFn<HolidaySetupValues> | undefined,
	unknown
>;
type TranslationFunction = ReturnType<typeof useTranslate>["t"];

function getErrorMessage(error: unknown) {
	if (typeof error === "string") return error;
	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string"
	) {
		return error.message;
	}
	return undefined;
}

function HolidaySetupHeader({
	t,
}: {
	t: (key: string, defaultValue: string) => string;
}) {
	return (
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
	);
}

function HolidaySetupActions({
	loading,
	selectedCountry,
	onSkip,
	t,
}: {
	loading: boolean;
	selectedCountry: string;
	onSkip: () => void;
	t: (key: string, defaultValue: string) => string;
}) {
	return (
		<div className="flex gap-3 pt-4">
			<Button
				type="button"
				variant="outline"
				onClick={onSkip}
				disabled={loading}
				className="flex-1"
			>
				{t("onboarding.holidaySetup.skip", "Skip for now")}
			</Button>
			<Button
				type="submit"
				disabled={loading || !selectedCountry}
				className="flex-1"
			>
				{loading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
				{t("onboarding.holidaySetup.continue", "Continue")}
			</Button>
		</div>
	);
}

function CountryField({
	form,
	countries,
	status,
	t,
}: {
	form: HolidaySetupForm;
	countries: CountryOption[];
	status: { countriesLoading: boolean; loading: boolean };
	t: TranslationFunction;
}) {
	const [countryOpen, setCountryOpen] = useState(false);
	const countryListboxId = useId();
	const selectedCountry = useStore(
		form.store,
		(state) => state.values.countryCode,
	);
	const selectedCountryName = countries.find(
		(country) => country.code === selectedCountry,
	)?.name;

	return (
		<form.Field
			name="countryCode"
			validators={{ onChange: z.string().min(1, "Please select a country") }}
		>
			{(field) => (
				<div className="space-y-2">
					<Label htmlFor="holiday-country">
						{t("onboarding.holidaySetup.country", "Country")}
					</Label>
					<Popover open={countryOpen} onOpenChange={setCountryOpen}>
						<PopoverTrigger asChild>
							<Button
								id="holiday-country"
								variant="outline"
								role="combobox"
								aria-expanded={countryOpen}
								aria-controls={countryListboxId}
								className="w-full justify-between font-normal"
								disabled={status.countriesLoading || status.loading}
							>
								{selectedCountryName ||
									t(
										"onboarding.holidaySetup.selectCountry",
										"Select a country",
									)}
								<IconSelector className="ml-2 size-4 shrink-0 opacity-50" />
							</Button>
						</PopoverTrigger>
						<PopoverContent className="w-(--anchor-width) p-0" align="start">
							<Command>
								<CommandInput
									placeholder={t(
										"onboarding.holidaySetup.searchCountry",
										"Search countries...",
									)}
								/>
								<CommandList id={countryListboxId}>
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
													form.setFieldValue(
														"presetName",
														`${country.name} Holidays`,
													);
													setCountryOpen(false);
												}}
											>
												<IconCheck
													className={cn(
														"mr-2 size-4",
														field.state.value === country.code
															? "opacity-100"
															: "opacity-0",
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
							{getErrorMessage(field.state.meta.errors[0])}
						</p>
					)}
				</div>
			)}
		</form.Field>
	);
}

function HolidaySetupFormFields({
	form,
	countries,
	status,
	onSkip,
	t,
}: {
	form: HolidaySetupForm;
	countries: CountryOption[];
	status: { countriesLoading: boolean; loading: boolean };
	onSkip: () => void;
	t: TranslationFunction;
}) {
	const selectedCountry = useStore(
		form.store,
		(state) => state.values.countryCode,
	);

	return (
		<form
			action={() => {
				void form.handleSubmit();
			}}
			className="space-y-6"
		>
			<CountryField form={form} countries={countries} status={status} t={t} />
			<form.Field
				name="presetName"
				validators={{
					onChange: z.string().min(1, "Preset name is required").max(100),
				}}
			>
				{(field) => (
					<div className="space-y-2">
						<Label htmlFor="holiday-preset-name">
							{t("onboarding.holidaySetup.presetName", "Preset Name")}
						</Label>
						<Input
							id="holiday-preset-name"
							value={field.state.value}
							onChange={(event) => field.handleChange(event.target.value)}
							onBlur={field.handleBlur}
							placeholder={t(
								"onboarding.holidaySetup.presetNamePlaceholder",
								"e.g., Germany Holidays",
							)}
							disabled={status.loading}
						/>
						<p className="text-sm text-muted-foreground">
							{t(
								"onboarding.holidaySetup.presetNameDesc",
								"A name to identify this holiday preset.",
							)}
						</p>
						{field.state.meta.errors.length > 0 && (
							<p className="text-sm font-medium text-destructive">
								{getErrorMessage(field.state.meta.errors[0])}
							</p>
						)}
					</div>
				)}
			</form.Field>
			<form.Field name="setAsDefault">
				{(field) => (
					<div className="flex flex-row items-center justify-between rounded-lg border p-4">
						<div className="space-y-0.5">
							<Label htmlFor="holiday-set-as-default" className="text-base">
								{t(
									"onboarding.holidaySetup.setAsDefault",
									"Set as organization default",
								)}
							</Label>
							<p className="text-sm text-muted-foreground">
								{t(
									"onboarding.holidaySetup.setAsDefaultDesc",
									"Apply this holiday preset to all employees.",
								)}
							</p>
						</div>
						<Switch
							id="holiday-set-as-default"
							checked={field.state.value}
							onCheckedChange={field.handleChange}
							disabled={status.loading}
						/>
					</div>
				)}
			</form.Field>
			<HolidaySetupActions
				loading={status.loading}
				selectedCountry={selectedCountry}
				onSkip={onSkip}
				t={t}
			/>
		</form>
	);
}

export default function HolidaySetupPage() {
	const { t } = useTranslate();
	const { push } = useRouter();
	const [loading, setLoading] = useState(false);
	const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
	const countriesQuery = useQuery({
		queryKey: ["location", "countries"],
		queryFn: async () => {
			const response = await fetch("/api/location/countries");
			if (!response.ok) {
				throw new Error("Failed to load countries");
			}
			const data = await response.json();
			return (data.countries as CountryOption[]) ?? [];
		},
	});
	const countries = countriesQuery.data ?? [];
	const countriesLoading = countriesQuery.isLoading;

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			await runOnboardingAction({
				action: () => createHolidayPresetOnboarding(value),
				onResult: (result) => {
					if (result.success) {
						toast.success(
							t("onboarding.holidaySetup.success", "Holiday preset created!"),
						);
						push("/onboarding/work-templates");
						return true;
					} else {
						toast.error(
							result.error ||
								t(
									"onboarding.holidaySetup.error",
									"Failed to create holiday preset",
								),
						);
					}
				},
				onRejected: () => {
					toast.error(
						t(
							"onboarding.holidaySetup.error",
							"Failed to create holiday preset",
						),
					);
				},
				setLoading,
			});
		},
	});

	// Check if user is admin, redirect if not
	useEffect(() => {
		let cancelled = false;

		async function checkAdmin() {
			try {
				const result = await checkIsAdmin();
				if (cancelled) {
					return;
				}

				if (result.success) {
					setIsAdmin(result.data);
					if (!result.data) {
						push("/onboarding/notifications");
					}
				} else {
					push("/onboarding/notifications");
				}
			} catch {
				if (!cancelled) {
					push("/onboarding/notifications");
				}
			}
		}
		void checkAdmin();

		return () => {
			cancelled = true;
		};
	}, [push]);

	async function handleSkip() {
		await runOnboardingAction({
			action: skipHolidaySetup,
			onResult: (result) => {
				if (result.success) {
					push("/onboarding/work-templates");
					return true;
				} else {
					toast.error(
						result.error ||
							t(
								"onboarding.holidaySetup.skipError",
								"Failed to skip holiday setup",
							),
					);
				}
			},
			onRejected: () => {
				toast.error(
					t(
						"onboarding.holidaySetup.skipError",
						"Failed to skip holiday setup",
					),
				);
			},
			setLoading,
		});
	}

	// Show loading while checking admin status
	if (isAdmin === null) {
		return (
			<div className="flex min-h-[50vh] items-center justify-center">
				<div className="text-center">
					<div className="inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
					<p className="mt-4 text-muted-foreground">
						{t("common.loading", "Loading...")}
					</p>
				</div>
			</div>
		);
	}

	return (
		<>
			<ProgressIndicator currentStep="holiday_setup" />

			<div className="mx-auto max-w-2xl">
				<HolidaySetupHeader t={t} />

				<Card>
					<CardHeader>
						<CardTitle>
							{t("onboarding.holidaySetup.cardTitle", "Holiday Preset")}
						</CardTitle>
						<CardDescription>
							{t(
								"onboarding.holidaySetup.cardDesc",
								"Choose your country to import public holidays. You can customize holidays later in settings.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<HolidaySetupFormFields
							form={form}
							countries={countries}
							status={{ countriesLoading, loading }}
							onSkip={handleSkip}
							t={t}
						/>
					</CardContent>
				</Card>
			</div>
		</>
	);
}
