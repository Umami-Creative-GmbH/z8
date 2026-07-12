import { IconChevronLeft, IconChevronRight, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Button } from "@/components/ui/button";
import type { HolidayImportSetState, HolidayImportState } from "./holiday-import-state";

export function HolidayImportFooter({
	state,
	set,
	onClose,
	onPreview,
	onImport,
}: {
	state: HolidayImportState;
	set: HolidayImportSetState;
	onClose: () => void;
	onPreview: () => void;
	onImport: () => void;
}) {
	const { t } = useTranslate();
	const busy = state.previewLoading || state.importLoading;
	return (
		<>
			{state.step > 1 && (
				<Button variant="outline" onClick={() => set("step", state.step - 1)} disabled={busy}>
					<IconChevronLeft className="mr-1 size-4" />
					{t("common.back", "Back")}
				</Button>
			)}
			<Button variant="outline" onClick={onClose} disabled={busy}>
				{t("common.cancel", "Cancel")}
			</Button>
			{state.step === 1 && (
				<Button
					onClick={onPreview}
					disabled={
						!state.selectedCountry ||
						state.selectedTypes.length === 0 ||
						busy ||
						state.statesLoading ||
						state.regionsLoading
					}
				>
					{state.previewLoading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
					{t("common.next", "Next")}
					<IconChevronRight className="ml-1 size-4" />
				</Button>
			)}
			{state.step === 2 && (
				<Button onClick={() => set("step", 3)} disabled={state.selectedHolidays.size === 0}>
					{t("common.next", "Next")}
					<IconChevronRight className="ml-1 size-4" />
				</Button>
			)}
			{state.step === 3 && (
				<Button onClick={onImport} disabled={state.importLoading || !state.presetName.trim()}>
					{state.importLoading && <IconLoader2 className="mr-2 size-4 animate-spin" />}
					{t("settings.holidays.import.createPresetButton", "Create Preset")}
				</Button>
			)}
		</>
	);
}
