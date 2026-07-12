import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
	formatHolidayPreviewDate,
	getHolidayCheckboxLabel,
	getHolidayIdentity,
} from "./holiday-import-helpers";
import type { HolidayImportSetState, HolidayImportState } from "./holiday-import-state";

export function HolidaySelectionStep({
	state,
	set,
	toggleHoliday,
}: {
	state: HolidayImportState;
	set: HolidayImportSetState;
	toggleHoliday: (name: string) => void;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const country = state.countries.find((item) => item.code === state.selectedCountry)?.name || "";
	const selectedState = state.states.find((item) => item.code === state.selectedState)?.name || "";
	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<h3 className="font-medium">
					{t("settings.holidays.import.step2.title", "Select Holidays")}
				</h3>
				<div className="flex gap-2">
					<Button
						variant="outline"
						size="sm"
						onClick={() => set("selectedHolidays", new Set(state.holidays.map(getHolidayIdentity)))}
					>
						{t("common.selectAll", "Select All")}
					</Button>
					<Button variant="outline" size="sm" onClick={() => set("selectedHolidays", new Set())}>
						{t("common.deselectAll", "Deselect All")}
					</Button>
				</div>
			</div>
			<p className="text-sm text-muted-foreground">
				{t(
					"settings.holidays.import.step2.description",
					"Found {count} holidays for {country}{state}. {duplicates} already exist.",
					{
						count: state.holidays.length,
						country,
						state: selectedState ? ` / ${selectedState}` : "",
						duplicates: state.holidays.filter((holiday) => holiday.isDuplicate).length,
					},
				)}
			</p>
			<div className="max-h-[300px] overflow-y-auto rounded-lg border">
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
						{state.holidays.map((holiday) => (
							<TableRow
								key={getHolidayIdentity(holiday)}
								className={cn(holiday.isDuplicate && "opacity-60")}
							>
								<TableCell>
									<Checkbox
										aria-label={getHolidayCheckboxLabel(holiday)}
										checked={state.selectedHolidays.has(getHolidayIdentity(holiday))}
										onCheckedChange={() => toggleHoliday(getHolidayIdentity(holiday))}
									/>
								</TableCell>
								<TableCell className="font-medium">{holiday.name}</TableCell>
								<TableCell>{formatHolidayPreviewDate(holiday.date, locale)}</TableCell>
								<TableCell>
									<Badge variant="outline" className="capitalize">
										{holiday.type}
									</Badge>
								</TableCell>
								<TableCell>
									{holiday.isDuplicate ? (
										<span className="flex items-center gap-1 text-amber-600">
											<IconAlertTriangle className="size-4" />
											{t("settings.holidays.import.duplicate", "Exists")}
										</span>
									) : (
										<span className="flex items-center gap-1 text-green-600">
											<IconCheck className="size-4" />
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
	);
}
