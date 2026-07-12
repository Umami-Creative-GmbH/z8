import { IconChevronLeft, IconChevronRight, IconReload } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ViewMode } from "./schedule-x-calendar";

interface ScheduleXCalendarHeaderProps {
	dateRangeDisplay: string;
	mobileDateRangeDisplay: string;
	viewMode: ViewMode;
	onNavigatePrevious: () => void;
	onNavigateNext: () => void;
	onNavigateToday: () => void;
	onViewModeChange: (mode: ViewMode) => void;
	onRefresh?: () => void;
	t: (key: string, fallback: string) => string;
}

export function ScheduleXCalendarHeader({
	dateRangeDisplay,
	mobileDateRangeDisplay,
	viewMode,
	onNavigatePrevious,
	onNavigateNext,
	onNavigateToday,
	onViewModeChange,
	onRefresh,
	t,
}: ScheduleXCalendarHeaderProps) {
	const controls = (
		<>
			<Button
				variant="outline"
				size="icon"
				onClick={onNavigatePrevious}
				aria-label={t("calendar.view.previous", "Previous")}
			>
				<IconChevronLeft className="size-4" />
			</Button>
			<Button
				variant="outline"
				size="icon"
				onClick={onNavigateNext}
				aria-label={t("calendar.view.next", "Next")}
			>
				<IconChevronRight className="size-4" />
			</Button>
			<Button variant="outline" size="sm" onClick={onNavigateToday}>
				{t("calendar.view.today", "Today")}
			</Button>
			{onRefresh ? (
				<Button
					variant="outline"
					size="icon"
					onClick={onRefresh}
					aria-label={t("calendar.view.refresh", "Refresh")}
					title={t("calendar.view.refresh", "Refresh")}
				>
					<IconReload className="size-4" />
				</Button>
			) : null}
		</>
	);
	const viewTabs = (
		<Tabs value={viewMode} onValueChange={(value) => onViewModeChange(value as ViewMode)}>
			<TabsList>
				<TabsTrigger value="day">{t("calendar.view.day", "Day")}</TabsTrigger>
				<TabsTrigger value="week">{t("calendar.view.week", "Week")}</TabsTrigger>
				<TabsTrigger value="month">{t("calendar.view.month", "Month")}</TabsTrigger>
				<TabsTrigger value="year">{t("calendar.view.year", "Year")}</TabsTrigger>
			</TabsList>
		</Tabs>
	);

	return (
		<>
			<div
				data-testid="calendar-desktop-header"
				className="hidden items-center justify-between gap-4 pb-3 mb-3 lg:flex"
			>
				<div className="flex items-center gap-2">{controls}</div>
				<h2 className="text-lg font-semibold">{dateRangeDisplay}</h2>
				{viewTabs}
			</div>
			<div data-testid="calendar-mobile-header" className="pb-3 mb-3 lg:hidden">
				<h2
					data-testid="calendar-mobile-date-range"
					className="mb-2 truncate whitespace-nowrap text-lg font-semibold"
				>
					{mobileDateRangeDisplay}
				</h2>
				<div
					data-testid="calendar-mobile-header-controls"
					className="overflow-x-auto whitespace-nowrap"
				>
					<div className="flex w-max items-center gap-2">
						{controls}
						{viewTabs}
					</div>
				</div>
			</div>
		</>
	);
}
