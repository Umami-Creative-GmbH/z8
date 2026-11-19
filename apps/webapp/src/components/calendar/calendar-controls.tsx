"use client";

import { IconAdjustmentsHorizontal } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
import { BalanceAdjustmentHistoryButton } from "@/components/work-balance/balance-adjustment-history-button";
import { WorkBalanceCard } from "@/components/work-balance/work-balance-card";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import type { EmployeeWorkBalancePayload } from "@/lib/work-balance/types";
import { CalendarFiltersComponent } from "./calendar-filters";

interface CalendarControlsProps {
	currentEmployeeId?: string;
	workBalance: EmployeeWorkBalancePayload | null;
	filters: CalendarFilters;
	onFiltersChange: (filters: CalendarFilters) => void;
}

export function CalendarControls({
	currentEmployeeId,
	workBalance,
	filters,
	onFiltersChange,
}: CalendarControlsProps) {
	const { t } = useTranslate();
	const [mobileControlsOpen, setMobileControlsOpen] = useState(false);
	const mobileControlsTitle = t(
		"calendar.mobileControls.title",
		"Filters & Legend",
	);
	const mobileControlsDescription = t(
		"calendar.mobileControls.description",
		"Choose which calendar entries are visible.",
	);

	return (
		<div className="min-w-0 space-y-4 xl:overflow-y-auto">
			<div data-testid="calendar-work-balance">
				<WorkBalanceCard
					balance={workBalance}
					compact
					action={
						workBalance ? (
							<BalanceAdjustmentHistoryButton
								employeeId={workBalance.employeeId}
							/>
						) : null
					}
				/>
			</div>
			<div
				data-testid="calendar-desktop-controls"
				className="hidden space-y-4 md:block"
			>
				<CalendarFiltersComponent
					filters={filters}
					onFiltersChange={onFiltersChange}
					currentEmployeeId={currentEmployeeId}
					idPrefix="calendar-desktop"
				/>
			</div>
			<div
				data-testid="calendar-mobile-controls"
				className="space-y-2 md:hidden"
			>
				<Sheet open={mobileControlsOpen} onOpenChange={setMobileControlsOpen}>
					<SheetTrigger asChild>
						<Button
							type="button"
							variant="outline"
							size="sm"
							className="h-8 w-full gap-2 px-3"
						>
							<IconAdjustmentsHorizontal
								className="size-4"
								aria-hidden="true"
							/>
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
						</div>
					</SheetContent>
				</Sheet>
			</div>
		</div>
	);
}
