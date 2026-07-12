import { useTranslate } from "@tolgee/react";
import { Checkbox } from "@/components/ui/checkbox";
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
import { type HolidayImportState, type HolidayType, holidayTypes } from "./holiday-import-state";

export function LocationStep({
	state,
	onCountryChange,
	onStateChange,
	onRegionChange,
	onYearChange,
	toggleType,
}: {
	state: HolidayImportState;
	onCountryChange: (value: string) => void;
	onStateChange: (value: string) => void;
	onRegionChange: (value: string) => void;
	onYearChange: (year: number) => void;
	toggleType: (type: HolidayType) => void;
}) {
	const { t } = useTranslate();
	const yearOptions = Array.from({ length: 5 }, (_, index) => state.selectedYear - 2 + index);

	return (
		<div className="space-y-4">
			<h3 className="font-medium">
				{t("settings.holidays.import.step1.title", "Select Location")}
			</h3>
			<div className="space-y-2">
				<Label htmlFor="holiday-import-country">
					{t("settings.holidays.import.country", "Country")}
				</Label>
				<SearchableSelect
					id="holiday-import-country"
					options={state.countries}
					value={state.selectedCountry}
					onValueChange={onCountryChange}
					placeholder={t("settings.holidays.import.selectCountry", "Select a country")}
					searchPlaceholder={t("settings.holidays.import.searchCountry", "Search countries...")}
					emptyText={t("settings.holidays.import.noCountryFound", "No country found")}
					disabled={state.countriesLoading}
				/>
			</div>
			{state.selectedCountry && (state.statesLoading || state.states.length > 0) && (
				<LocationSelect
					id="holiday-import-state"
					label={t("settings.holidays.import.state", "State / Region")}
					loading={state.statesLoading}
					loadingText={t("settings.holidays.import.loadingStates", "Loading states...")}
					options={state.states}
					value={state.selectedState}
					onChange={onStateChange}
					placeholder={t("settings.holidays.import.selectState", "Select a state (optional)")}
					searchPlaceholder={t("settings.holidays.import.searchState", "Search states...")}
					emptyText={t("settings.holidays.import.noStateFound", "No state found")}
					emptyLabel={t("settings.holidays.import.allStates", "All (country-wide only)")}
				/>
			)}
			{state.selectedState && (state.regionsLoading || state.regions.length > 0) && (
				<LocationSelect
					id="holiday-import-region"
					label={t("settings.holidays.import.region", "Region")}
					loading={state.regionsLoading}
					loadingText={t("settings.holidays.import.loadingRegions", "Loading regions...")}
					options={state.regions}
					value={state.selectedRegion}
					onChange={onRegionChange}
					placeholder={t("settings.holidays.import.selectRegion", "Select a region (optional)")}
					searchPlaceholder={t("settings.holidays.import.searchRegion", "Search regions...")}
					emptyText={t("settings.holidays.import.noRegionFound", "No region found")}
					emptyLabel={t("settings.holidays.import.allRegions", "All (state-wide only)")}
				/>
			)}
			<div className="space-y-2">
				<Label htmlFor="holiday-import-year">{t("settings.holidays.import.year", "Year")}</Label>
				<Select
					value={state.selectedYear.toString()}
					onValueChange={(value) => onYearChange(Number.parseInt(value, 10))}
				>
					<SelectTrigger id="holiday-import-year">
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
			<fieldset className="space-y-2">
				<legend className="text-sm font-medium">
					{t("settings.holidays.import.types", "Holiday Types")}
				</legend>
				<div className="flex flex-wrap gap-2">
					{holidayTypes.map((type) => {
						const id = `holiday-import-type-${type.value}`;
						return (
							<div key={type.value} className="flex items-center gap-2">
								<Checkbox
									id={id}
									checked={state.selectedTypes.includes(type.value)}
									onCheckedChange={() => toggleType(type.value)}
								/>
								<Label htmlFor={id} className="cursor-pointer text-sm font-normal">
									{type.label}
								</Label>
							</div>
						);
					})}
				</div>
			</fieldset>
		</div>
	);
}

function LocationSelect({
	id,
	label,
	loading,
	loadingText,
	options,
	value,
	onChange,
	placeholder,
	searchPlaceholder,
	emptyText,
	emptyLabel,
}: {
	id: string;
	label: string;
	loading: boolean;
	loadingText: string;
	options: { code: string; name: string }[];
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	searchPlaceholder: string;
	emptyText: string;
	emptyLabel: string;
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			{loading ? (
				<div className="space-y-2">
					<Skeleton className="h-10 w-full" />
					<p className="text-xs text-muted-foreground">{loadingText}</p>
				</div>
			) : (
				<SearchableSelect
					id={id}
					options={options}
					value={value}
					onValueChange={onChange}
					placeholder={placeholder}
					searchPlaceholder={searchPlaceholder}
					emptyText={emptyText}
					allowEmpty
					emptyLabel={emptyLabel}
				/>
			)}
		</div>
	);
}
