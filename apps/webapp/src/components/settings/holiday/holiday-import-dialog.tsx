"use client";

import { IconDownload } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { cn } from "@/lib/utils";
import { useHolidayImportController } from "./holiday-import/holiday-import-controller";
import { HolidayImportFooter } from "./holiday-import/holiday-import-footer";
import { HolidaySelectionStep } from "./holiday-import/holiday-selection-step";
import { LocationStep } from "./holiday-import/location-step";
import { PresetDetailsStep } from "./holiday-import/preset-details-step";

interface HolidayImportDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	onSuccess: () => void;
}

export function HolidayImportDialog(props: HolidayImportDialogProps) {
	const { t } = useTranslate();
	const controller = useHolidayImportController(props);
	const { state } = controller;

	return (
		<ActionPanel open={props.open} onOpenChange={controller.handleOpenChange}>
			<ActionPanelContent size="wide">
				<ActionPanelHeader>
					<ActionPanelTitle className="flex items-center gap-2">
						<IconDownload className="size-5" />
						{t("settings.holidays.import.title", "Import Holiday Preset")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.holidays.import.description",
							"Create a reusable holiday preset that can be assigned to teams or employees",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-4">
					<StepIndicator step={state.step} />
					<div>
						{state.step === 1 && (
							<LocationStep
								state={state}
								onCountryChange={controller.changeCountry}
								onStateChange={controller.changeState}
								onRegionChange={controller.changeRegion}
								onYearChange={controller.changeYear}
								toggleType={controller.toggleType}
							/>
						)}
						{state.step === 2 && (
							<HolidaySelectionStep
								state={state}
								set={controller.set}
								toggleHoliday={controller.toggleHoliday}
							/>
						)}
						{state.step === 3 && <PresetDetailsStep state={state} set={controller.set} />}
					</div>
				</ActionPanelBody>
				<ActionPanelFooter className="flex-shrink-0">
					<HolidayImportFooter
						state={state}
						set={controller.set}
						onClose={controller.close}
						onPreview={controller.loadPreview}
						onImport={controller.importHolidays}
					/>
				</ActionPanelFooter>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function StepIndicator({ step }: { step: number }) {
	return (
		<div className="flex items-center justify-center gap-2">
			{[1, 2, 3].map((number) => (
				<div key={number} className="contents">
					<div
						className={cn(
							"flex size-8 items-center justify-center rounded-full text-sm font-medium",
							step >= number
								? "bg-primary text-primary-foreground"
								: "bg-muted text-muted-foreground",
						)}
					>
						{number}
					</div>
					{number < 3 && (
						<div className={cn("h-0.5 w-12", step > number ? "bg-primary" : "bg-muted")} />
					)}
				</div>
			))}
		</div>
	);
}
