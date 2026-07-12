import { useTranslate } from "@tolgee/react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { HolidayImportSetState, HolidayImportState } from "./holiday-import-state";

export function PresetDetailsStep({
	state,
	set,
}: {
	state: HolidayImportState;
	set: HolidayImportSetState;
}) {
	const { t } = useTranslate();
	const country = state.countries.find((item) => item.code === state.selectedCountry)?.name || "";
	const selectedState = state.states.find((item) => item.code === state.selectedState)?.name || "";
	return (
		<div className="space-y-4">
			<h3 className="font-medium">
				{t("settings.holidays.import.step3.title", "Create Holiday Preset")}
			</h3>
			<div className="space-y-2">
				<Label htmlFor="holiday-import-preset-name">
					{t("settings.holidays.import.presetName", "Preset Name")}
				</Label>
				<Input
					id="holiday-import-preset-name"
					value={state.presetName}
					onChange={(event) => set("presetName", event.target.value)}
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
			<div className="space-y-2">
				<Label htmlFor="holiday-import-preset-color">
					{t("settings.holidays.import.presetColor", "Color")}
				</Label>
				<div className="flex gap-2">
					<Input
						id="holiday-import-preset-color"
						type="color"
						value={state.presetColor}
						onChange={(event) => set("presetColor", event.target.value)}
						className="h-10 w-12 cursor-pointer p-1"
					/>
					<Input
						aria-label={t("settings.holidays.import.presetColor", "Color")}
						value={state.presetColor}
						onChange={(event) => set("presetColor", event.target.value)}
						placeholder="#4F46E5"
						className="flex-1"
					/>
				</div>
			</div>
			<div className="space-y-3 rounded-lg border bg-muted/50 p-4">
				<div className="flex justify-between">
					<span className="text-muted-foreground">
						{t("settings.holidays.import.location", "Location")}
					</span>
					<span className="font-medium">
						{country}
						{selectedState && ` / ${selectedState}`}
					</span>
				</div>
				<div className="flex justify-between">
					<span className="text-muted-foreground">
						{t("settings.holidays.import.holidaysSelected", "Holidays to import")}
					</span>
					<span className="font-medium">{state.selectedHolidays.size}</span>
				</div>
			</div>
			<div className="flex items-center justify-between rounded-lg border p-3">
				<div className="space-y-0.5">
					<Label htmlFor="holiday-import-org-default">
						{t("settings.holidays.import.setAsDefault", "Set as organization default")}
					</Label>
					<p className="text-sm text-muted-foreground">
						{t(
							"settings.holidays.import.setAsDefaultDesc",
							"This preset will be applied to all employees unless overridden",
						)}
					</p>
				</div>
				<Switch
					id="holiday-import-org-default"
					checked={state.setAsOrgDefault}
					onCheckedChange={(value) => set("setAsOrgDefault", value)}
				/>
			</div>
		</div>
	);
}
