"use client";

import {
	IconCalendarEvent,
	IconCheck,
	IconDotsVertical,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useLocale } from "next-intl";
import { startTransition, useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import { approveWorkPeriod } from "@/app/[locale]/(app)/time-tracking/actions/mutations";
import { DataTable } from "@/components/data-table-server";
import {
	getTimeEntriesColumns,
	type WorkPeriodData,
} from "@/components/time-tracking/time-entries-table-columns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatDuration } from "@/lib/time-tracking/time-utils";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { cn } from "@/lib/utils";
import { Link, useRouter } from "@/navigation";
import { useBillableTimeEnabled } from "@/stores/organization-settings-store";
import { timeEntryDayGroups } from "./time-entry-day-groups";

const TimeCorrectionDialog = dynamic(
	() =>
		import("./time-correction-dialog").then((mod) => mod.TimeCorrectionDialog),
	{ ssr: false },
);

const ManualTimeEntryDialog = dynamic(
	() =>
		import("./manual-time-entry-dialog").then(
			(mod) => mod.ManualTimeEntryDialog,
		),
	{ ssr: false },
);

interface Props {
	workPeriods: WorkPeriodData[];
	/** The listed work periods showing driving details missing (#1127). */
	drivingDetailsMissingIds?: string[];
	hasManager: boolean;
	canApproveTimeEntries: boolean;
	employeeTimezone: string;
	timeFormat: TimeFormat;
	employeeId: string;
}

export function TimeEntriesTable({
	workPeriods,
	drivingDetailsMissingIds = [],
	hasManager,
	canApproveTimeEntries,
	employeeTimezone,
	timeFormat,
	employeeId,
}: Props) {
	const { t } = useTranslate();
	const locale = useLocale();
	const { refresh } = useRouter();
	const billableTimeEnabled = useBillableTimeEnabled();
	const [grouped, setGrouped] = useState(true);
	const groups = timeEntryDayGroups(workPeriods, employeeTimezone);
	const [approvingWorkPeriodId, setApprovingWorkPeriodId] = useState<
		string | null
	>(null);

	const handleApproveWorkPeriod = async (period: WorkPeriodData) => {
		if (!period.approvalRequestId) return;
		setApprovingWorkPeriodId(period.id);
		const result = await approveWorkPeriod({
			workPeriodId: period.id,
			approvalRequestId: period.approvalRequestId,
		});
		setApprovingWorkPeriodId(null);

		if (!result.success) {
			toast.error(
				result.error ||
					t("timeTracking.table.approveFailed", "Failed to approve entry"),
			);
			return;
		}

		toast.success(t("timeTracking.table.approved", "Time entry approved"));
		startTransition(() => refresh());
	};

	const columns = getTimeEntriesColumns({
		t,
		locale,
		employeeTimezone,
		timeFormat,
		hasManager,
		showBillable: billableTimeEnabled,
		isDrivingDetailsMissing: (workPeriodId) =>
			drivingDetailsMissingIds.includes(workPeriodId),
		renderAdminAction: canApproveTimeEntries
			? (period) => (
					<TimeEntryAdminMenu
						period={period}
						isApproving={approvingWorkPeriodId === period.id}
						onApprove={() => handleApproveWorkPeriod(period)}
					/>
				)
			: undefined,
		renderEditAction: (period, isSameDay) => (
			<TimeCorrectionDialog
				workPeriod={period}
				employeeId={employeeId}
				isSameDay={isSameDay}
				employeeTimezone={employeeTimezone}
			/>
		),
	});
	const groupedColumns = columns.filter(
		(column) => !("accessorKey" in column && column.accessorKey === "startTime"),
	);

	return (
		<Card className="gap-0 overflow-hidden rounded-xl py-0 shadow-none">
			<CardHeader className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-4 py-2.5">
				<CardTitle>
					<h2 className="text-base font-semibold">
						{t("timeTracking.table.title", "Time Entries")}
					</h2>
				</CardTitle>
				<div className="flex flex-wrap items-center gap-2">
					{/* Both views named up front: a single toggle labelled with its current state read as an action. */}
					<ToggleGroup
						type="single"
						size="sm"
						variant="outline"
						value={grouped ? "day" : "all"}
						onValueChange={(value) => {
							if (value) setGrouped(value === "day");
						}}
					>
						<ToggleGroupItem value="day">
							{t("timeTracking.table.groupedByDay", "Grouped by day")}
						</ToggleGroupItem>
						<ToggleGroupItem value="all">
							{t("timeTracking.table.allEntries", "All entries")}
						</ToggleGroupItem>
					</ToggleGroup>
					<Button asChild variant="outline" size="sm">
						<Link href="/calendar">
							<IconCalendarEvent className="size-4" aria-hidden="true" />
							{t("timeTracking.table.viewCalendar", "View Calendar")}
						</Link>
					</Button>
					<ManualTimeEntryDialog
						employeeId={employeeId}
						employeeTimezone={employeeTimezone}
						hasManager={hasManager}
						onSuccess={() => refresh()}
					/>
				</div>
			</CardHeader>
			<CardContent className="px-0 sm:[&_th]:align-top sm:[&_th]:py-1 sm:[&_th]:leading-4 sm:[&_th]:whitespace-normal sm:[&_td]:align-top sm:[&_:is(th,td):first-child]:pl-4 sm:[&_:is(th,td):last-child]:pr-4">
				{grouped && groups.length > 0 ? (
					groups.map((group, groupIndex) => (
						<section
							key={group.date}
							aria-label={Temporal.PlainDate.from(group.date).toLocaleString(
								locale,
								{ dateStyle: "full" },
							)}
						>
							<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-y bg-muted/40 px-4 py-2 text-sm">
								<h3 className="font-medium">
									{Temporal.PlainDate.from(group.date).toLocaleString(locale, {
										weekday: "long",
										day: "numeric",
										month: "long",
									})}
								</h3>
								<div className="flex flex-wrap items-center gap-3 text-muted-foreground">
									<span>
										{t(
											"timeTracking.table.entryCount",
											"{count, plural, one {# entry} other {# entries}}",
											{ count: group.periods.length },
										)}
									</span>
									<span className="font-semibold text-foreground tabular-nums">
										{formatDuration(group.durationMinutes)}
									</span>
									{group.incomplete ? (
										<span>
											{t(
												"timeTracking.table.incompleteDay",
												"Includes active or incomplete entries",
											)}
										</span>
									) : null}
								</div>
							</div>
							<DataTable
								mobileLayout="stacked"
								columns={groupedColumns}
								data={group.periods}
								manualPagination
								// One visible column header for the whole list; later days keep theirs for
								// screen readers. Widths sit on every cell so hidden headers keep columns aligned.
								className={cn(
									"rounded-none border-0 sm:[&_table]:min-w-xl sm:[&_table]:table-fixed sm:[&_:is(th,td):nth-child(-n+2)]:w-[22%] sm:[&_:is(th,td):nth-child(3)]:w-28 sm:[&_:is(th,td):last-child]:w-24 sm:[&_[data-slot=badge]]:max-w-full sm:[&_[data-slot=badge]]:whitespace-normal sm:[&_[data-slot=badge]]:wrap-anywhere",
									// A fixed layout reads widths from the (now hidden) first row; auto honours the cells'.
									groupIndex > 0 && "sm:[&_thead]:sr-only sm:[&_table]:table-auto",
								)}
							/>
						</section>
					))
				) : (
					<DataTable
						mobileLayout="stacked"
						columns={columns}
						data={workPeriods}
						manualPagination
						className="rounded-none border-x-0"
						emptyMessage={t(
							"timeTracking.table.emptyState",
							"No time entries found for this week. Clock in to start tracking your time.",
						)}
					/>
				)}
				<p className="px-4 py-3 text-sm text-muted-foreground">
					{t(
						"timeTracking.table.offsetContext",
						"Endpoint times use each entry's captured local UTC offset. Day headings follow your calendar timezone: {timezone}.",
						{ timezone: employeeTimezone },
					)}
				</p>
			</CardContent>
		</Card>
	);
}

function TimeEntryAdminMenu({
	period,
	isApproving,
	onApprove,
}: {
	period: WorkPeriodData;
	isApproving: boolean;
	onApprove: () => void;
}) {
	const { t } = useTranslate();

	if (period.approvalStatus !== "pending" || !period.approvalRequestId) {
		return null;
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="size-8 text-muted-foreground hover:text-foreground"
					aria-label={t("timeTracking.table.rowActions", "Time entry actions")}
				>
					<IconDotsVertical className="size-4" aria-hidden="true" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-44">
				<DropdownMenuItem disabled={isApproving} onClick={onApprove}>
					<IconCheck className="size-4 text-emerald-600" aria-hidden="true" />
					{isApproving
						? t("timeTracking.table.approving", "Approving...")
						: t("timeTracking.table.approveEntry", "Approve entry")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
