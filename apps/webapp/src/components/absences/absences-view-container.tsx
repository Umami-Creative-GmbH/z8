"use client";

import { useTranslate } from "@tolgee/react";
import { Calendar, Table as TableIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toLocalDateString } from "@/lib/absences/date-utils";
import type { AbsenceWithCategory, Holiday } from "@/lib/absences/types";
import { AbsenceEntriesTable } from "./absence-entries-table";
import { AbsenceYearCalendar } from "./absence-year-calendar";
import { RequestAbsenceDialog } from "./request-absence-dialog";

type ViewType = "calendar" | "table";

interface AbsencesViewContainerProps {
	absences: AbsenceWithCategory[];
	holidays: Holiday[];
	categories: Array<{
		id: string;
		name: string;
		type: string;
		color: string | null;
		requiresApproval: boolean;
		countsAgainstVacation: boolean;
	}>;
	remainingDays: number;
	currentYear: number;
}

export function AbsencesViewContainer({
	absences,
	holidays,
	categories,
	remainingDays,
	currentYear,
}: AbsencesViewContainerProps) {
	const { t } = useTranslate();
	const [activeView, setActiveView] = useState<ViewType>("calendar");
	const [requestDialogOpen, setRequestDialogOpen] = useState(false);
	const [prefilledDate, setPrefilledDate] = useState<string | undefined>(undefined);

	// Handle day click in year calendar - open request dialog with date prefilled
	const handleDayClick = useCallback((date: Date) => {
		// Use local date string to avoid timezone issues with toISOString()
		const dateStr = toLocalDateString(date);
		setPrefilledDate(dateStr);
		setRequestDialogOpen(true);
	}, []);

	// Reset prefilled date when dialog closes
	const handleDialogOpenChange = useCallback((open: boolean) => {
		setRequestDialogOpen(open);
		if (!open) {
			setPrefilledDate(undefined);
		}
	}, []);

	return (
		<div className="space-y-4">
			<Tabs value={activeView} onValueChange={(v) => setActiveView(v as ViewType)}>
				<TabsList>
					<TabsTrigger value="calendar" className="gap-2">
						<Calendar className="h-4 w-4" />
						{t("absences.view.calendar", "Calendar")}
					</TabsTrigger>
					<TabsTrigger value="table" className="gap-2">
						<TableIcon className="h-4 w-4" />
						{t("absences.view.table", "Table")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="calendar" className="mt-4">
					<AbsenceYearCalendar
						absences={absences}
						holidays={holidays}
						initialYear={currentYear}
						onDayClick={handleDayClick}
					/>
				</TabsContent>

				<TabsContent value="table" className="mt-4">
					<div className="mb-4">
						<h2 className="text-lg font-semibold">
							{t("absences.table.title", "Your Absence Requests")}
						</h2>
						<p className="text-sm text-muted-foreground">
							{t("absences.table.subtitle", "Recent and upcoming absence requests")}
						</p>
					</div>
					<AbsenceEntriesTable absences={absences} />
				</TabsContent>
			</Tabs>

			{/* Request dialog with optional prefilled date */}
			<RequestAbsenceDialog
				open={requestDialogOpen}
				onOpenChange={handleDialogOpenChange}
				categories={categories}
				remainingDays={remainingDays}
				holidays={holidays}
				initialDate={prefilledDate}
			/>
		</div>
	);
}
