"use client";

import { useTranslate } from "@tolgee/react";
import { IconCalendar, IconPlus, IconTable } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from "react";
import { getAbsenceCalendarYearData } from "@/app/[locale]/(app)/absences/actions";
import { Button } from "@/components/ui/button";
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
	organizationId: string;
	remainingDays: number;
	currentYear: number;
	currentDate: string;
}

export function AbsencesViewContainer({
	absences,
	holidays,
	categories,
	organizationId,
	remainingDays,
	currentYear,
	currentDate,
}: AbsencesViewContainerProps) {
	const { t } = useTranslate();
	const [activeView, setActiveView] = useState<ViewType>("calendar");
	const [requestDialogOpen, setRequestDialogOpen] = useState(false);
	const [prefilledDate, setPrefilledDate] = useState<string | undefined>(undefined);
	const [calendarAbsences, setCalendarAbsences] = useState(absences);
	const [calendarHolidays, setCalendarHolidays] = useState(holidays);
	const latestRequestedYearRef = useRef(currentYear);

	useEffect(() => {
		setCalendarAbsences(absences);
		setCalendarHolidays(holidays);
	}, [absences, holidays]);

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

	const handleAddAbsence = useCallback(() => {
		setPrefilledDate(undefined);
		setRequestDialogOpen(true);
	}, []);

	const reloadYearData = useCallback(async (year: number) => {
		latestRequestedYearRef.current = year;
		try {
			const data = await getAbsenceCalendarYearData(year);
			if (latestRequestedYearRef.current !== year) {
				return;
			}
			setCalendarAbsences(data.absences);
			setCalendarHolidays(data.holidays);
		} catch (error) {
			console.error("Failed to load absence calendar year data", error);
		}
	}, []);

	const handleYearChange = useCallback((year: number) => {
		void reloadYearData(year);
	}, [reloadYearData]);

	const handleAbsencesUpdated = useCallback(() => {
		void reloadYearData(latestRequestedYearRef.current);
	}, [reloadYearData]);

	return (
		<div className="space-y-4">
			<Tabs value={activeView} onValueChange={(v) => setActiveView(v as ViewType)}>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<TabsList>
						<TabsTrigger value="calendar" className="gap-2">
							<IconCalendar className="size-4" />
							{t("absences.view.calendar", "Calendar")}
						</TabsTrigger>
						<TabsTrigger value="table" className="gap-2">
							<IconTable className="size-4" />
							{t("absences.view.table", "Table")}
						</TabsTrigger>
					</TabsList>
					<Button className="w-full gap-2 sm:w-auto" onClick={handleAddAbsence}>
						<IconPlus className="size-4" />
						{t("absences.addAbsence", "Add absence")}
					</Button>
				</div>

				<TabsContent value="calendar" className="mt-4">
					<AbsenceYearCalendar
						absences={calendarAbsences}
						holidays={calendarHolidays}
						initialYear={currentYear}
						onDayClick={handleDayClick}
						onYearChange={handleYearChange}
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
					<AbsenceEntriesTable
						absences={calendarAbsences}
						currentDate={currentDate}
						onUpdate={handleAbsencesUpdated}
					/>
				</TabsContent>
			</Tabs>

			{/* Request dialog with optional prefilled date */}
			<RequestAbsenceDialog
				open={requestDialogOpen}
				onOpenChange={handleDialogOpenChange}
				categories={categories}
				organizationId={organizationId}
				remainingDays={remainingDays}
				holidays={calendarHolidays}
				initialDate={prefilledDate}
				onSuccess={handleAbsencesUpdated}
			/>
		</div>
	);
}
