"use client";

import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { SelectableEmployee } from "@/components/employee-select/types";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { WorkBalanceCard } from "@/components/work-balance/work-balance-card";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import { CalendarEmployeeSelector } from "./calendar-employee-selector";
import { CalendarFiltersComponent } from "./calendar-filters";
import { CalendarLegend } from "./calendar-legend";

interface CalendarControlsProps {
	currentEmployeeId?: string;
	selectedEmployeeId: string | null;
	onEmployeeChange: (employeeId: string | null, employee?: SelectableEmployee) => void;
	isManagerOrAbove: boolean;
	workBalance: EmployeeWorkBalancePayload | null;
	filters: CalendarFilters;
	onFiltersChange: (filters: CalendarFilters) => void;
}

export function CalendarControls({
	currentEmployeeId,
	selectedEmployeeId,
	onEmployeeChange,
	isManagerOrAbove,
	workBalance,
	filters,
	onFiltersChange,
}: CalendarControlsProps) {
	const { t } = useTranslate();
	const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
	const mobileControlsTitle = t("calendar.mobileControls.title", "Filters & Legend");
	const mobileControlsDescription = t(
		"calendar.mobileControls.description",
		"Choose which calendar entries are visible.",
	);

	return (
		<div className="space-y-2 order-2 md:order-1 md:space-y-4">
			<CalendarEmployeeSelector
				currentEmployeeId={currentEmployeeId}
				selectedEmployeeId={selectedEmployeeId}
				onEmployeeChange={onEmployeeChange}
				isManagerOrAbove={isManagerOrAbove}
			/>
			<div data-testid="calendar-desktop-work-balance" className="hidden md:block">
				<WorkBalanceCard balance={workBalance} compact />
			</div>
			<div data-testid="calendar-mobile-work-balance" className="md:hidden">
				<WorkBalanceCard balance={workBalance} compact mobileCompact />
			</div>
			<div data-testid="calendar-desktop-controls" className="hidden space-y-4 md:block">
				<CalendarFiltersComponent
					filters={filters}
					onFiltersChange={onFiltersChange}
					currentEmployeeId={currentEmployeeId}
					idPrefix="calendar-desktop"
				/>
				<CalendarLegend />
			</div>
			<div data-testid="calendar-mobile-controls" className="space-y-2 md:hidden">
				<Sheet open={mobileControlsOpen} onOpenChange={setMobileControlsOpen}>
					<SheetTrigger asChild>
						<Button type="button" variant="outline" size="sm" className="h-8 w-full gap-2 px-3">
							<IconAdjustmentsHorizontal className="size-4" />
							{mobileControlsTitle}
						</Button>
					</SheetTrigger>
					<SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto">
						<SheetHeader>
							<SheetTitle>{mobileControlsTitle}</SheetTitle>
							<SheetDescription>{mobileControlsDescription}</SheetDescription>
						</SheetHeader>
						<div className="space-y-4 p-4 pt-0">
							<CalendarFiltersComponent
								filters={filters}
								onFiltersChange={onFiltersChange}
								currentEmployeeId={currentEmployeeId}
								idPrefix="calendar-mobile"
							/>
							<CalendarLegend />
						</div>
					</SheetContent>
				</Sheet>
			</div>
		</div>
	);
}
