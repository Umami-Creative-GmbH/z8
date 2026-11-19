"use client";

import {
	IconCalendar,
	IconChevronLeft,
	IconChevronRight,
	IconPlus,
	IconTable,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { Temporal } from "temporal-polyfill";
import { getAbsenceCalendarYearData } from "@/app/[locale]/(app)/absences/actions";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
	ABSENCES_MAX_YEAR,
	ABSENCES_MIN_YEAR,
	type AbsencesUrlState,
	type AbsencesView,
	absencesSearch,
	parseAbsencesUrlState,
	parseAbsencesView,
} from "@/lib/absences/absences-url";
import type { AbsenceWithDays, Holiday } from "@/lib/absences/types";
import { AbsenceEntriesTable } from "./absence-entries-table";
import { AbsenceYearCalendar } from "./absence-year-calendar";
import { OwnAbsenceActionsProvider } from "./own-absence-actions";
import { OwnAbsenceChangeRequests } from "./own-absence-change-requests";
import { RequestAbsenceDialog } from "./request-absence-dialog";

// Restore the URL once per mount. Later view and year changes belong to the controls or route props.
const subscribeToInitialSearch = () => () => {};
const clientSearch = () => window.location.search;
const serverSearch = () => null;

function parseAbsencesSearch(search: string, todayYear: number): AbsencesUrlState {
	const params = new URLSearchParams(search);
	return parseAbsencesUrlState({ view: params.get("view"), year: params.get("year") }, todayYear);
}

/**
 * Replaces the view or year in the URL without a navigation or a history entry, so a reload or
 * a shared link returns to them. Next keeps its router state in step with `replaceState`.
 */
function replaceAbsencesUrl(change: Partial<AbsencesUrlState>, todayYear: number) {
	const url = new URL(window.location.href);
	const current = parseAbsencesSearch(url.search, todayYear);
	const search = absencesSearch({ ...current, ...change }, todayYear, url.searchParams);
	if (search === url.search) return;
	window.history.replaceState(null, "", url.pathname + search + url.hash);
}

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
	/** The calendar year `absences` and `holidays` cover; the year the URL asked for. */
	year: number;
	initialView?: AbsencesView;
	/** Today in the organization's timezone (YYYY-MM-DD). */
	currentDate: string;
}

function useCalendarData(
	absences: AbsenceWithDays[],
	holidays: Holiday[],
	year: number,
	selectedYear: number,
	navigatedToYear: boolean,
) {
	const [calendarData, setCalendarData] = useState(() => ({
		sourceYear: year,
		sourceAbsences: absences,
		sourceHolidays: holidays,
		absences,
		holidays,
	}));
	if (
		navigatedToYear ||
		calendarData.sourceAbsences !== absences ||
		calendarData.sourceHolidays !== holidays
	) {
		const showsPropsYear = navigatedToYear || selectedYear === year;
		setCalendarData({
			sourceYear: year,
			sourceAbsences: absences,
			sourceHolidays: holidays,
			absences: showsPropsYear ? absences : calendarData.absences,
			holidays: showsPropsYear ? holidays : calendarData.holidays,
		});
	}

	return [calendarData, setCalendarData] as const;
}

function useAbsenceCalendar({
	absences,
	holidays,
	initialView = "calendar",
	year,
	currentDate,
}: Pick<
	AbsencesViewContainerProps,
	"absences" | "holidays" | "initialView" | "year" | "currentDate"
>) {
	const todayYear = Temporal.PlainDate.from(currentDate).year;
	const search = useSyncExternalStore<string | null>(
		subscribeToInitialSearch,
		clientSearch,
		serverSearch,
	);
	const [activeView, setActiveView] = useState<AbsencesView>(initialView);
	const latestRequestedYearRef = useRef(year);
	const yearRequestId = useRef(0);
	const [selectedYear, setSelectedYear] = useState(year);
	const [yearLoad, setYearLoad] = useState<{
		year: number;
		status: "pending" | "failed";
	} | null>(null);
	const [restoredUrl, setRestoredUrl] = useState(false);
	if (search !== null && !restoredUrl) {
		const initialUrl = parseAbsencesSearch(search, todayYear);
		setRestoredUrl(true);
		setActiveView(initialUrl.view);
		if (initialUrl.year !== year) setYearLoad({ year: initialUrl.year, status: "pending" });
	}
	// The URL props last seen; `navigations` counts the ones that moved to another year.
	const [urlProps, setUrlProps] = useState({ year, initialView, navigations: 0 });

	// A refresh renders the URL the client already wrote, so its year is the one on screen. Another
	// year means a navigation (e.g. the plain route from the sidebar): show it and drop pending loads.
	const urlPropsChanged = urlProps.year !== year || urlProps.initialView !== initialView;
	const navigatedToYear = urlPropsChanged && year !== selectedYear;
	if (urlPropsChanged) {
		setUrlProps({
			year,
			initialView,
			navigations: urlProps.navigations + (navigatedToYear ? 1 : 0),
		});
		if (initialView !== urlProps.initialView) setActiveView(initialView);
		if (navigatedToYear) {
			setSelectedYear(year);
			setYearLoad(null);
		}
	}

	const [calendarData, setCalendarData] = useCalendarData(
		absences,
		holidays,
		year,
		selectedYear,
		navigatedToYear,
	);

	useEffect(() => {
		if (urlProps.navigations === 0) return;
		// Loads started before the navigation must not replace the year it brought.
		yearRequestId.current += 1;
		latestRequestedYearRef.current = urlProps.year;
	}, [urlProps.navigations, urlProps.year]);

	const calendarAbsences = calendarData.absences;
	const calendarHolidays = calendarData.holidays;

	/** Reads a year whose load is already shown as pending. */
	const loadYearData = async (requestedYear: number, reportFailure: boolean) => {
		const sourceAbsences = absences;
		const sourceHolidays = holidays;
		const requestId = ++yearRequestId.current;
		latestRequestedYearRef.current = requestedYear;
		try {
			const data = await getAbsenceCalendarYearData(requestedYear);
			const isLatestRequest =
				latestRequestedYearRef.current === requestedYear && requestId === yearRequestId.current;
			if (!isLatestRequest) {
				return;
			}
			setCalendarData((current) => {
				// RSC refresh may already have delivered a newer snapshot of this year.
				if (
					requestedYear === current.sourceYear &&
					(current.sourceAbsences !== sourceAbsences || current.sourceHolidays !== sourceHolidays)
				)
					return current;
				return { ...current, absences: data.absences, holidays: data.holidays };
			});
			setSelectedYear(requestedYear);
			setYearLoad(null);
			// The URL names the year on screen, so a failed load leaves it unchanged.
			replaceAbsencesUrl({ year: requestedYear }, todayYear);
		} catch (error) {
			if (requestId !== yearRequestId.current) return;
			setYearLoad({ year: requestedYear, status: "failed" });
			if (reportFailure) throw error;
		}
	};

	const reloadYearData = (requestedYear: number, reportFailure = false) => {
		setYearLoad({ year: requestedYear, status: "pending" });
		return loadYearData(requestedYear, reportFailure);
	};

	useViewRefresh(() => reloadYearData(latestRequestedYearRef.current, true));

	// Starts the read for a URL year that arrived as initial pending state, unless a year
	// change already started another read.
	const resumeYearLoad = useEffectEvent(() => {
		if (yearLoad?.status === "pending" && yearRequestId.current === 0)
			void loadYearData(yearLoad.year, false);
	});
	useEffect(() => {
		if (!restoredUrl) return;
		const timeout = setTimeout(resumeYearLoad, 0);
		return () => clearTimeout(timeout);
	}, [restoredUrl]);

	const handleYearChange = (nextYear: number) => {
		void reloadYearData(nextYear);
	};

	const handleViewChange = (value: unknown) => {
		const nextView = parseAbsencesView(value);
		setActiveView(nextView);
		replaceAbsencesUrl({ view: nextView }, todayYear);
	};

	const handleAbsencesUpdated = () => {
		void reloadYearData(latestRequestedYearRef.current);
	};

	// Year navigation steps from the year being loaded, so repeated clicks are not lost.
	const navigationYear = yearLoad?.status === "pending" ? yearLoad.year : selectedYear;

	return {
		activeView,
		selectedYear,
		yearLoad,
		navigationYear,
		handleViewChange,
		handleYearChange,
		handleAbsencesUpdated,
		calendarAbsences,
		calendarHolidays,
		reloadYearData,
	};
}

export function AbsencesViewContainer({
	absences,
	holidays,
	categories,
	organizationId,
	year,
	initialView = "calendar",
	currentDate,
}: AbsencesViewContainerProps) {
	const { t } = useTranslate();
	// The day a request starts from (YYYY-MM-DD), when one was chosen in the calendar.
	const [absenceRequest, setAbsenceRequest] = useState<{
		open: boolean;
		initialDate?: string;
	}>({ open: false });
	const todayYear = Temporal.PlainDate.from(currentDate).year;
	const {
		activeView,
		selectedYear,
		yearLoad,
		navigationYear,
		handleViewChange,
		handleYearChange,
		handleAbsencesUpdated,
		calendarAbsences,
		calendarHolidays,
		reloadYearData,
	} = useAbsenceCalendar({ absences, holidays, initialView, year, currentDate });
	const view = (
		<div className="min-w-0 space-y-4">
			{/* Attention section: outside the tab panels, so both views show it. */}
			<OwnAbsenceChangeRequests />
			<Tabs value={activeView} onValueChange={handleViewChange}>
				{/* One toolbar for both views: the year applies to the calendar and the table. */}
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex items-center gap-1">
						<Button
							variant="ghost"
							size="icon"
							onClick={() => handleYearChange(navigationYear - 1)}
							disabled={navigationYear <= ABSENCES_MIN_YEAR}
							aria-label={t("absences.calendar.previousYear", "Previous year")}
						>
							<IconChevronLeft className="size-4" aria-hidden="true" />
						</Button>
						<h2
							className="min-w-[4ch] text-center font-semibold text-lg tabular-nums"
							aria-live="polite"
						>
							{selectedYear}
						</h2>
						<Button
							variant="ghost"
							size="icon"
							onClick={() => handleYearChange(navigationYear + 1)}
							disabled={navigationYear >= ABSENCES_MAX_YEAR}
							aria-label={t("absences.calendar.nextYear", "Next year")}
						>
							<IconChevronRight className="size-4" aria-hidden="true" />
						</Button>
						{selectedYear !== todayYear ? (
							<Button
								variant="outline"
								size="sm"
								className="ml-1"
								onClick={() => handleYearChange(todayYear)}
							>
								{t("absences.calendar.currentYear", "This year")}
							</Button>
						) : null}
					</div>
					{/* R002: the request action sits beside the view controls. */}
					<div className="flex flex-wrap items-center gap-2">
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
						<Button className="gap-2" onClick={() => setAbsenceRequest({ open: true })}>
							<IconPlus className="size-4" aria-hidden="true" />
							{t("absences.requestAbsence", "Request absence")}
						</Button>
					</div>
				</div>
				{yearLoad ? (
					<div
						role={yearLoad.status === "failed" ? "alert" : "status"}
						className="mt-3 flex flex-wrap items-center gap-2 text-muted-foreground text-sm"
					>
						{yearLoad.status === "failed"
							? t(
									"absences.year.loadFailed",
									"Could not load {year}. Still showing {loadedYear}.",
									{ year: yearLoad.year, loadedYear: selectedYear },
								)
							: t("absences.year.loading", "Loading {year}… Still showing {loadedYear}.", {
									year: yearLoad.year,
									loadedYear: selectedYear,
								})}
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
						year={selectedYear}
						currentDate={currentDate}
						onRequestDay={(date) => setAbsenceRequest({ open: true, initialDate: date })}
					/>
				</TabsContent>

				<TabsContent value="table" className="mt-4">
					<AbsenceEntriesTable absences={calendarAbsences} currentDate={currentDate} />
				</TabsContent>
			</Tabs>

			<RequestAbsenceDialog
				open={absenceRequest.open}
				// Closing forgets the chosen day; the next request starts fresh.
				onOpenChange={(open) =>
					setAbsenceRequest((current) => (open ? { ...current, open } : { open: false }))
				}
				categories={categories}
				organizationId={organizationId}
				initialDate={absenceRequest.initialDate}
				onSuccess={handleAbsencesUpdated}
			/>
		</div>
	);

	// Both views act on an absence through one controller, so their actions and dialogs match (#1863).
	return (
		<OwnAbsenceActionsProvider absences={calendarAbsences} onUpdate={handleAbsencesUpdated}>
			{view}
		</OwnAbsenceActionsProvider>
	);
}
