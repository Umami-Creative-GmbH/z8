"use client";

import { IconCalendar, IconPlus, IconTable } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { getAbsenceCalendarYearData } from "@/app/[locale]/(app)/absences/actions";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toLocalDateString } from "@/lib/absences/date-utils";
import type { AbsenceWithDays, Holiday } from "@/lib/absences/types";
import { AbsenceEntriesTable } from "./absence-entries-table";
import { AbsenceYearCalendar } from "./absence-year-calendar";
import { RequestAbsenceDialog } from "./request-absence-dialog";

type ViewType = "calendar" | "table";

interface AbsencesViewContainerProps {
	absences: AbsenceWithDays[];
	holidays: Holiday[];
	categories: Array<{
		id: string;
		name: string;
		type: string;
		color: string | null;
		requiresApproval: boolean;
		countsAgainstVacation: boolean;
		deputyRequired?: boolean;
	}>;
	organizationId: string;
	currentYear: number;
	currentDate: string;
}

export function AbsencesViewContainer({
	absences,
	holidays,
	categories,
	organizationId,
	currentYear,
	currentDate,
}: AbsencesViewContainerProps) {
	const { t } = useTranslate();
	const [activeView, setActiveView] = useState<ViewType>("calendar");
	const [requestDialogOpen, setRequestDialogOpen] = useState(false);
	const [prefilledDate, setPrefilledDate] = useState<string | undefined>(
		undefined,
	);
	const [calendarData, setCalendarData] = useState(() => ({
		sourceAbsences: absences,
		sourceHolidays: holidays,
		absences,
		holidays,
	}));
	const latestRequestedYearRef = useRef(currentYear);
	const yearRequestId = useRef(0);
	const [selectedYear, setSelectedYear] = useState(currentYear);
	const [yearLoad, setYearLoad] = useState<{
		year: number;
		status: "pending" | "failed";
	} | null>(null);

	if (
		calendarData.sourceAbsences !== absences ||
		calendarData.sourceHolidays !== holidays
	) {
		setCalendarData({
			sourceAbsences: absences,
			sourceHolidays: holidays,
			absences: selectedYear === currentYear ? absences : calendarData.absences,
			holidays: selectedYear === currentYear ? holidays : calendarData.holidays,
		});
	}

	const calendarAbsences = calendarData.absences;
	const calendarHolidays = calendarData.holidays;

	// Handle day click in year calendar - open request dialog with date prefilled
	const handleDayClick = (date: Date) => {
		// Use local date string to avoid timezone issues with toISOString()
		const dateStr = toLocalDateString(date);
		setPrefilledDate(dateStr);
		setRequestDialogOpen(true);
	};

	// Reset prefilled date when dialog closes
	const handleDialogOpenChange = (open: boolean) => {
		setRequestDialogOpen(open);
		if (!open) {
			setPrefilledDate(undefined);
		}
	};

	const handleAddAbsence = () => {
		setPrefilledDate(undefined);
		setRequestDialogOpen(true);
	};

	const reloadYearData = async (year: number, reportFailure = false) => {
		const sourceAbsences = absences;
		const sourceHolidays = holidays;
		const requestId = ++yearRequestId.current;
		latestRequestedYearRef.current = year;
		setYearLoad({ year, status: "pending" });
		try {
			const data = await getAbsenceCalendarYearData(year);
			const isLatestRequest =
				latestRequestedYearRef.current === year &&
				requestId === yearRequestId.current;
			if (!isLatestRequest) {
				return;
			}
			setCalendarData((current) => {
				// RSC refresh may already have delivered a newer current-year snapshot.
				if (
					year === currentYear &&
					(current.sourceAbsences !== sourceAbsences ||
						current.sourceHolidays !== sourceHolidays)
				)
					return current;
				return { ...current, absences: data.absences, holidays: data.holidays };
			});
			setSelectedYear(year);
			setYearLoad(null);
		} catch (error) {
			if (requestId !== yearRequestId.current) return;
			setYearLoad({ year, status: "failed" });
			if (reportFailure) throw error;
		}
	};

	useViewRefresh(() => reloadYearData(latestRequestedYearRef.current, true));

	const handleYearChange = (year: number) => {
		void reloadYearData(year);
	};

	const handleAbsencesUpdated = () => {
		void reloadYearData(latestRequestedYearRef.current);
	};

	return (
		<div className="min-w-0 space-y-4">
			<Tabs
				value={activeView}
				onValueChange={(v) => setActiveView(v as ViewType)}
			>
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<TabsList>
						<TabsTrigger value="calendar" className="gap-2">
							<IconCalendar className="size-4" aria-hidden="true" />
							{t("absences.view.calendar", "Calendar")}
						</TabsTrigger>
						<TabsTrigger value="table" className="gap-2">
							<IconTable className="size-4" aria-hidden="true" />
							{t("absences.view.table", "Table")}
						</TabsTrigger>
					</TabsList>
					<Button className="w-full gap-2 sm:w-auto" onClick={handleAddAbsence}>
						<IconPlus className="size-4" aria-hidden="true" />
						{t("absences.addAbsence", "Add absence")}
					</Button>
				</div>
				{yearLoad ? (
					<div
						role={yearLoad.status === "failed" ? "alert" : "status"}
						className="flex flex-wrap items-center gap-2 rounded-md border p-3 text-sm"
					>
						{yearLoad.status === "failed"
							? t(
									"absences.year.loadFailed",
									"Could not load {year}. Still showing {loadedYear}.",
									{ year: yearLoad.year, loadedYear: selectedYear },
								)
							: t(
									"absences.year.loading",
									"Loading {year}… Still showing {loadedYear}.",
									{ year: yearLoad.year, loadedYear: selectedYear },
								)}
						{yearLoad.status === "failed" ? (
							<Button
								variant="outline"
								size="sm"
								onClick={() => void reloadYearData(yearLoad.year)}
							>
								{t("common.retry", "Retry")}
							</Button>
						) : null}
					</div>
				) : null}

				<TabsContent value="calendar" className="mt-4">
					<AbsenceYearCalendar
						absences={calendarAbsences}
						holidays={calendarHolidays}
						initialYear={selectedYear}
						year={selectedYear}
						currentDate={currentDate}
						onDayClick={handleDayClick}
						onYearChange={handleYearChange}
					/>
				</TabsContent>

				<TabsContent value="table" className="mt-4">
					<div className="mb-4">
						<h2 className="text-lg font-semibold">
							{t("absences.table.title", "Your Absence Requests")} ·{" "}
							{selectedYear}
						</h2>
						<p className="text-sm text-muted-foreground">
							{t(
								"absences.table.subtitle",
								"Recent and upcoming absence requests",
							)}
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
				initialDate={prefilledDate}
				onSuccess={handleAbsencesUpdated}
			/>
		</div>
	);
}
