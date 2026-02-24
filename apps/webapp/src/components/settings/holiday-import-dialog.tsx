"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconChevronLeft,
	IconChevronRight,
	IconDownload,
	IconLoader2,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
	bulkAddHolidaysToPreset,
	createHolidayPreset,
	createPresetAssignment,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

interface HolidayImportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	onSuccess: () => void;
}

interface CountryOption {
	code: string;
	name: string;
}

interface StateOption {
	code: string;
	name: string;
}

interface HolidayPreview {
	name: string;
	date: string;
	startDate: string;
	endDate: string;
	type: string;
	isDuplicate: boolean;
}

type HolidayType = "public" | "bank" | "optional" | "school" | "observance";

const HOLIDAY_TYPES: { value: HolidayType; label: string }[] = [
	{ value: "public", label: "Public Holidays" },
	{ value: "bank", label: "Bank Holidays" },
];

export function HolidayImportDialog({
	open,
	onOpenChange,
	organizationId,
	onSuccess,
}: HolidayImportDialogProps) {
	const { t } = useTranslate();

	// Step state
	const [step, setStep] = useState(1);

	// Location selection state
	const [countries, setCountries] = useState<CountryOption[]>([]);
	const [states, setStates] = useState<StateOption[]>([]);
	const [regions, setRegions] = useState<StateOption[]>([]);
	const [selectedCountry, setSelectedCountry] = useState<string>("");
	const [selectedState, setSelectedState] = useState<string>("");
	const [selectedRegion, setSelectedRegion] = useState<string>("");
	const [selectedYear, setSelectedYear] = useState<number>(new Date().getFullYear());
	const [selectedTypes, setSelectedTypes] = useState<HolidayType[]>(["public"]);

	// Preview state
	const [holidays, setHolidays] = useState<HolidayPreview[]>([]);
	const [selectedHolidays, setSelectedHolidays] = useState<Set<string>>(new Set());

	// Preset options
	const [presetName, setPresetName] = useState("");
	const [presetColor, setPresetColor] = useState("#4F46E5");
	const [setAsOrgDefault, setSetAsOrgDefault] = useState(false);

	// Loading states
	const [countriesLoading, setCountriesLoading] = useState(false);
	const [statesLoading, setStatesLoading] = useState(false);
	const [regionsLoading, setRegionsLoading] = useState(false);
	const [previewLoading, setPreviewLoading] = useState(false);
	const [importLoading, setImportLoading] = useState(false);

	// Generate year options (current year +/- 2)
	const currentYear = new Date().getFullYear();
	const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

	const loadCountries = useCallback(async () => {
		setCountriesLoading(true);
		const response = await fetch("/api/location/countries").catch((error) => {
			console.error("Failed to load countries:", error);
			return null;
		});

		if (!response) {
			toast.error("Failed to load countries");
			setCountriesLoading(false);
			return;
		}

		if (response.ok) {
			const data = await response.json().catch(() => null);
			if (data?.countries) {
				setCountries(data.countries);
			}
		}

		setCountriesLoading(false);
	}, []);

	const resetDialogState = useCallback(() => {
		setStep(1);
		setSelectedCountry("");
		setSelectedState("");
		setSelectedRegion("");
		setSelectedYear(new Date().getFullYear());
		setSelectedTypes(["public"]);
		setHolidays([]);
		setSelectedHolidays(new Set());
		setStates([]);
		setRegions([]);
		setPresetName("");
		setPresetColor("#4F46E5");
		setSetAsOrgDefault(false);
	}, []);

	useEffect(() => {
		if (!open) {
			resetDialogState();
			return;
		}

		if (countries.length === 0) {
			void loadCountries();
		}
	}, [open, countries.length, loadCountries, resetDialogState]);

	async function loadStates(country: string) {
		setStatesLoading(true);
		const response = await fetch(`/api/location/states?country=${encodeURIComponent(country)}`).catch(
			(error) => {
				console.error("Failed to load states:", error);
				return null;
			},
		);

		if (!response) {
			setStatesLoading(false);
			return;
		}

		if (response.ok) {
			const data = await response.json().catch(() => null);
			if (data?.states) {
				setStates(data.states);
			}
		}

		setStatesLoading(false);
	}

	async function loadRegions(country: string, state: string) {
		setRegionsLoading(true);
		const response = await fetch(
			`/api/location/regions?country=${encodeURIComponent(country)}&state=${encodeURIComponent(state)}`,
		).catch((error) => {
			console.error("Failed to load regions:", error);
			return null;
		});

		if (!response) {
			setRegionsLoading(false);
			return;
		}

		if (response.ok) {
			const data = await response.json().catch(() => null);
			if (data?.regions) {
				setRegions(data.regions);
			}
		}

		setRegionsLoading(false);
	}

	async function loadPreview() {
		setPreviewLoading(true);
		const params = new URLSearchParams({
			country: selectedCountry,
			year: selectedYear.toString(),
			types: selectedTypes.join(","),
		});
		if (selectedState) params.set("state", selectedState);
		if (selectedRegion) params.set("region", selectedRegion);

		const response = await fetch(`/api/admin/holidays/preview?${params}`).catch((error) => {
			console.error("Failed to load preview:", error);
			return null;
		});

		if (!response) {
			toast.error("Failed to load holidays");
			setPreviewLoading(false);
			return;
		}

		if (!response.ok) {
			const error = await response.json().catch(() => null);
			toast.error(error?.error || "Failed to load holidays");
			setPreviewLoading(false);
			return;
		}

		const data = await response.json().catch(() => null);
		if (!data?.holidays) {
			toast.error("Failed to load holidays");
			setPreviewLoading(false);
			return;
		}

		setHolidays(data.holidays);
		// Pre-select non-duplicate holidays
		const nonDuplicates = data.holidays
			.filter((h: HolidayPreview) => !h.isDuplicate)
			.map((h: HolidayPreview) => h.name);
		setSelectedHolidays(new Set(nonDuplicates));

		// Generate preset name from location
		const countryName = countries.find((c) => c.code === selectedCountry)?.name || selectedCountry;
		const stateName = states.find((s) => s.code === selectedState)?.name;
		const regionName = regions.find((r) => r.code === selectedRegion)?.name;
		const nameParts = [countryName];
		if (stateName) nameParts.push(stateName);
		if (regionName) nameParts.push(regionName);
		setPresetName(nameParts.join(" - "));

		setStep(2);
		setPreviewLoading(false);
	}

	async function handleImport() {
		setImportLoading(true);
		// Step 1: Create the preset
		const presetResult = await createHolidayPreset(organizationId, {
			name: presetName,
			description: "",
			countryCode: selectedCountry,
			stateCode: selectedState || undefined,
			regionCode: selectedRegion || undefined,
			color: presetColor,
			isActive: true,
		}).catch((error) => {
			console.error("Failed to create preset:", error);
			return null;
		});

		if (!presetResult?.success) {
			toast.error(presetResult?.error || "Failed to create preset");
			setImportLoading(false);
			return;
		}

		const presetId = presetResult.data.id;

		// Prepare holidays data for import
		const holidaysToImport = holidays
			.filter((h) => selectedHolidays.has(h.name))
			.map((h) => {
				const startDate = new Date(h.startDate);
				const endDate = new Date(h.endDate);
				const durationMs = endDate.getTime() - startDate.getTime();
				const durationDays = Math.ceil(durationMs / (1000 * 60 * 60 * 24)) + 1;

				return {
					name: h.name,
					description: "",
					month: startDate.getMonth() + 1,
					day: startDate.getDate(),
					durationDays,
					holidayType: h.type as "optional" | "public" | "bank" | "school" | "observance",
					isFloating: false,
					isActive: true,
				};
			});

		// Step 2 & 3: Run in parallel - adding holidays and creating assignment are independent
		const parallelOperations: Promise<{ success: boolean; error?: string }>[] = [];

		// Add holidays to preset (if any selected)
		if (holidaysToImport.length > 0) {
			parallelOperations.push(bulkAddHolidaysToPreset(presetId, holidaysToImport));
		}

		// Create org default assignment (if requested)
		if (setAsOrgDefault) {
			parallelOperations.push(
				createPresetAssignment(organizationId, {
					presetId,
					assignmentType: "organization",
					isActive: true,
				}),
			);
		}

		// Await all parallel operations
		const results = await Promise.all(parallelOperations).catch((error) => {
			console.error("Failed to complete import operations:", error);
			return null;
		});

		if (!results) {
			toast.error("Failed to create preset");
			setImportLoading(false);
			return;
		}

		// Check results
		let bulkAddFailed = false;

		if (holidaysToImport.length > 0) {
			const bulkResult = results[0];
			if (!bulkResult.success) {
				bulkAddFailed = true;
				toast.error(bulkResult.error || "Failed to add holidays to preset");
			}
		}

		if (setAsOrgDefault) {
			const assignResultIndex = holidaysToImport.length > 0 ? 1 : 0;
			const assignResult = results[assignResultIndex];
			if (!assignResult.success) {
				toast.warning(
					t(
						"settings.holidays.import.defaultWarning",
						"Preset created but could not set as organization default",
					),
				);
			}
		}

		// Only fail completely if bulk add failed (assignment failure is non-critical)
		if (bulkAddFailed) {
			setImportLoading(false);
			return;
		}

		toast.success(
			t(
				"settings.holidays.import.presetSuccess",
				`Created preset "{name}" with ${holidaysToImport.length} holidays`,
				{ name: presetName, count: holidaysToImport.length },
			),
		);

		onSuccess();
		handleDialogOpenChange(false);
		setImportLoading(false);
	}

	function handleDialogOpenChange(nextOpen: boolean) {
		onOpenChange(nextOpen);
	}

	function handleCountryChange(countryCode: string) {
		setSelectedCountry(countryCode);
		setSelectedState("");
		setSelectedRegion("");
		setStates([]);
		setRegions([]);

		if (countryCode) {
			loadStates(countryCode);
		}
	}

	function handleStateChange(stateCode: string) {
		setSelectedState(stateCode);
		setSelectedRegion("");
		setRegions([]);

		if (selectedCountry && stateCode) {
			loadRegions(selectedCountry, stateCode);
		}
	}

	function toggleHoliday(name: string) {
		setSelectedHolidays((prev) => {
			const next = new Set(prev);
			if (next.has(name)) {
				next.delete(name);
			} else {
				next.add(name);
			}
			return next;
		});
	}

	function selectAll() {
		setSelectedHolidays(new Set(holidays.map((h) => h.name)));
	}

	function deselectAll() {
		setSelectedHolidays(new Set());
	}

	function toggleType(type: HolidayType) {
		setSelectedTypes((prev) => {
			if (prev.includes(type)) {
				return prev.filter((t) => t !== type);
			}
			return [...prev, type];
		});
	}

	const selectedCountryName = countries.find((c) => c.code === selectedCountry)?.name || "";
	const selectedStateName = states.find((s) => s.code === selectedState)?.name || "";
	const _nonDuplicateCount = holidays.filter((h) => !h.isDuplicate).length;
	const _selectedNonDuplicateCount = holidays.filter(
		(h) => !h.isDuplicate && selectedHolidays.has(h.name),
	).length;

	return (
		<Dialog open={open} onOpenChange={handleDialogOpenChange}>
			<DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
				<DialogHeader>
					<DialogTitle className="flex items-center gap-2">
						<IconDownload className="h-5 w-5" />
						{t("settings.holidays.import.title", "Import Holiday Preset")}
					</DialogTitle>
					<DialogDescription>
						{t(
							"settings.holidays.import.description",
							"Create a reusable holiday preset that can be assigned to teams or employees",
						)}
					</DialogDescription>
				</DialogHeader>

				{/* Step indicator */}
				<div className="flex items-center justify-center gap-2 py-2">
					<div
						className={cn(
							"flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
							step >= 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
						)}
					>
						1
					</div>
					<div className={cn("h-0.5 w-12", step >= 2 ? "bg-primary" : "bg-muted")} />
					<div
						className={cn(
							"flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
							step >= 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
						)}
					>
						2
					</div>
					<div className={cn("h-0.5 w-12", step >= 3 ? "bg-primary" : "bg-muted")} />
					<div
						className={cn(
							"flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium",
							step >= 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
						)}
					>
						3
					</div>
				</div>

				{/* Step content */}
				<div className="flex-1 overflow-y-auto py-4">
					{step === 1 && (
						<div className="space-y-4">
							<h3 className="font-medium">
								{t("settings.holidays.import.step1.title", "Select Location")}
							</h3>

							{/* Country */}
							<div className="space-y-2">
								<Label>{t("settings.holidays.import.country", "Country")}</Label>
								<SearchableSelect
									options={countries}
									value={selectedCountry}
									onValueChange={handleCountryChange}
									placeholder={t("settings.holidays.import.selectCountry", "Select a country")}
									searchPlaceholder={t(
										"settings.holidays.import.searchCountry",
										"Search countries...",
									)}
									emptyText={t("settings.holidays.import.noCountryFound", "No country found")}
									disabled={countriesLoading}
								/>
							</div>

							{/* State - show skeleton when loading, content when loaded */}
							{selectedCountry && (statesLoading || states.length > 0) && (
								<div className="space-y-2">
									<Label>{t("settings.holidays.import.state", "State / Region")}</Label>
									{statesLoading ? (
										<div className="space-y-2">
											<Skeleton className="h-10 w-full" />
											<p className="text-xs text-muted-foreground">
												{t("settings.holidays.import.loadingStates", "Loading states...")}
											</p>
										</div>
									) : (
										<SearchableSelect
											options={states}
											value={selectedState}
											onValueChange={handleStateChange}
											placeholder={t(
												"settings.holidays.import.selectState",
												"Select a state (optional)",
											)}
											searchPlaceholder={t(
												"settings.holidays.import.searchState",
												"Search states...",
											)}
											emptyText={t("settings.holidays.import.noStateFound", "No state found")}
											disabled={statesLoading}
											allowEmpty
											emptyLabel={t(
												"settings.holidays.import.allStates",
												"All (country-wide only)",
											)}
										/>
									)}
								</div>
							)}

							{/* Region - show skeleton when loading, content when loaded */}
							{selectedState && (regionsLoading || regions.length > 0) && (
								<div className="space-y-2">
									<Label>{t("settings.holidays.import.region", "Region")}</Label>
									{regionsLoading ? (
										<div className="space-y-2">
											<Skeleton className="h-10 w-full" />
											<p className="text-xs text-muted-foreground">
												{t("settings.holidays.import.loadingRegions", "Loading regions...")}
											</p>
										</div>
									) : (
										<SearchableSelect
											options={regions}
											value={selectedRegion}
											onValueChange={setSelectedRegion}
											placeholder={t(
												"settings.holidays.import.selectRegion",
												"Select a region (optional)",
											)}
											searchPlaceholder={t(
												"settings.holidays.import.searchRegion",
												"Search regions...",
											)}
											emptyText={t("settings.holidays.import.noRegionFound", "No region found")}
											disabled={regionsLoading}
											allowEmpty
											emptyLabel={t("settings.holidays.import.allRegions", "All (state-wide only)")}
										/>
									)}
								</div>
							)}

							{/* Year */}
							<div className="space-y-2">
								<Label>{t("settings.holidays.import.year", "Year")}</Label>
								<Select
									value={selectedYear.toString()}
									onValueChange={(v) => setSelectedYear(parseInt(v, 10))}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{yearOptions.map((year) => (
											<SelectItem key={year} value={year.toString()}>
												{year}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>

							{/* Holiday Types */}
							<div className="space-y-2">
								<Label>{t("settings.holidays.import.types", "Holiday Types")}</Label>
								<div className="flex flex-wrap gap-2">
									{HOLIDAY_TYPES.map((type) => (
										<label key={type.value} className="flex items-center gap-2 cursor-pointer">
											<Checkbox
												checked={selectedTypes.includes(type.value)}
												onCheckedChange={() => toggleType(type.value)}
											/>
											<span className="text-sm">{type.label}</span>
										</label>
									))}
								</div>
							</div>
						</div>
					)}

					{step === 2 && (
						<div className="space-y-4">
							<div className="flex items-center justify-between">
								<h3 className="font-medium">
									{t("settings.holidays.import.step2.title", "Select Holidays")}
								</h3>
								<div className="flex gap-2">
									<Button variant="outline" size="sm" onClick={selectAll}>
										{t("common.selectAll", "Select All")}
									</Button>
									<Button variant="outline" size="sm" onClick={deselectAll}>
										{t("common.deselectAll", "Deselect All")}
									</Button>
								</div>
							</div>

							<p className="text-sm text-muted-foreground">
								{t(
									"settings.holidays.import.step2.description",
									"Found {count} holidays for {country}{state}. {duplicates} already exist.",
									{
										count: holidays.length,
										country: selectedCountryName,
										state: selectedStateName ? ` / ${selectedStateName}` : "",
										duplicates: holidays.filter((h) => h.isDuplicate).length,
									},
								)}
							</p>

							<div className="border rounded-lg max-h-[300px] overflow-y-auto">
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead className="w-12" />
											<TableHead>{t("settings.holidays.import.name", "Name")}</TableHead>
											<TableHead>{t("settings.holidays.import.date", "Date")}</TableHead>
											<TableHead>{t("settings.holidays.import.type", "Type")}</TableHead>
											<TableHead>{t("settings.holidays.import.status", "Status")}</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{holidays.map((holiday) => (
											<TableRow
												key={holiday.name}
												className={cn(holiday.isDuplicate && "opacity-60")}
											>
												<TableCell>
													<Checkbox
														checked={selectedHolidays.has(holiday.name)}
														onCheckedChange={() => toggleHoliday(holiday.name)}
													/>
												</TableCell>
												<TableCell className="font-medium">{holiday.name}</TableCell>
												<TableCell>{new Date(holiday.startDate).toLocaleDateString()}</TableCell>
												<TableCell>
													<Badge variant="outline" className="capitalize">
														{holiday.type}
													</Badge>
												</TableCell>
												<TableCell>
													{holiday.isDuplicate ? (
														<span className="flex items-center gap-1 text-amber-600">
															<IconAlertTriangle className="h-4 w-4" />
															{t("settings.holidays.import.duplicate", "Exists")}
														</span>
													) : (
														<span className="flex items-center gap-1 text-green-600">
															<IconCheck className="h-4 w-4" />
															{t("settings.holidays.import.new", "New")}
														</span>
													)}
												</TableCell>
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						</div>
					)}

					{step === 3 && (
						<div className="space-y-4">
							<h3 className="font-medium">
								{t("settings.holidays.import.step3.title", "Create Holiday Preset")}
							</h3>

							{/* Preset Name */}
							<div className="space-y-2">
								<Label>{t("settings.holidays.import.presetName", "Preset Name")}</Label>
								<Input
									value={presetName}
									onChange={(e) => setPresetName(e.target.value)}
									placeholder={t(
										"settings.holidays.import.presetNamePlaceholder",
										"e.g., Germany - Bavaria",
									)}
								/>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.holidays.import.presetNameHint",
										"This name will be used to identify the preset when assigning to teams or employees",
									)}
								</p>
							</div>

							{/* Preset Color */}
							<div className="space-y-2">
								<Label>{t("settings.holidays.import.presetColor", "Color")}</Label>
								<div className="flex gap-2">
									<Input
										type="color"
										value={presetColor}
										onChange={(e) => setPresetColor(e.target.value)}
										className="w-12 h-10 p-1 cursor-pointer"
									/>
									<Input
										value={presetColor}
										onChange={(e) => setPresetColor(e.target.value)}
										placeholder="#4F46E5"
										className="flex-1"
									/>
								</div>
							</div>

							{/* Summary */}
							<div className="rounded-lg border p-4 space-y-3 bg-muted/50">
								<div className="flex justify-between">
									<span className="text-muted-foreground">
										{t("settings.holidays.import.location", "Location")}
									</span>
									<span className="font-medium">
										{selectedCountryName}
										{selectedStateName && ` / ${selectedStateName}`}
									</span>
								</div>
								<div className="flex justify-between">
									<span className="text-muted-foreground">
										{t("settings.holidays.import.holidaysSelected", "Holidays to import")}
									</span>
									<span className="font-medium">{selectedHolidays.size}</span>
								</div>
							</div>

							{/* Set as org default option */}
							<div className="flex items-center justify-between rounded-lg border p-3">
								<div className="space-y-0.5">
									<Label>
										{t("settings.holidays.import.setAsDefault", "Set as organization default")}
									</Label>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.holidays.import.setAsDefaultDesc",
											"This preset will be applied to all employees unless overridden",
										)}
									</p>
								</div>
								<Switch checked={setAsOrgDefault} onCheckedChange={setSetAsOrgDefault} />
							</div>
						</div>
					)}
				</div>

				<DialogFooter className="flex-shrink-0">
					{step > 1 && (
						<Button
							variant="outline"
							onClick={() => setStep((prev) => prev - 1)}
							disabled={previewLoading || importLoading}
						>
							<IconChevronLeft className="mr-1 h-4 w-4" />
							{t("common.back", "Back")}
						</Button>
					)}

					<Button
						variant="outline"
						onClick={() => handleDialogOpenChange(false)}
						disabled={previewLoading || importLoading}
					>
						{t("common.cancel", "Cancel")}
					</Button>

					{step === 1 && (
						<Button
							onClick={loadPreview}
							disabled={
								!selectedCountry ||
								selectedTypes.length === 0 ||
								previewLoading ||
								statesLoading ||
								regionsLoading
							}
						>
							{previewLoading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("common.next", "Next")}
							<IconChevronRight className="ml-1 h-4 w-4" />
						</Button>
					)}

					{step === 2 && (
						<Button onClick={() => setStep(3)} disabled={selectedHolidays.size === 0}>
							{t("common.next", "Next")}
							<IconChevronRight className="ml-1 h-4 w-4" />
						</Button>
					)}

					{step === 3 && (
						<Button onClick={handleImport} disabled={importLoading || !presetName.trim()}>
							{importLoading && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
							{t("settings.holidays.import.createPresetButton", "Create Preset")}
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
