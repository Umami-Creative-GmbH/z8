"use client";

import { IconCalendarEvent, IconCheck, IconDotsVertical } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { startTransition, useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { approveWorkPeriod } from "@/app/[locale]/(app)/time-tracking/actions/mutations";
import { DataTable } from "@/components/data-table-server";
import {
	getTimeEntriesColumns,
	type WorkPeriodData,
} from "@/components/time-tracking/time-entries-table-columns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { TimeFormat } from "@/lib/user-preferences/time-format";
import { Link, useRouter } from "@/navigation";

const TimeCorrectionDialog = dynamic(
	() => import("./time-correction-dialog").then((mod) => mod.TimeCorrectionDialog),
	{ ssr: false },
);

const ManualTimeEntryDialog = dynamic(
	() => import("./manual-time-entry-dialog").then((mod) => mod.ManualTimeEntryDialog),
	{ ssr: false },
);

interface Props {
	workPeriods: WorkPeriodData[];
	hasManager: boolean;
	canApproveTimeEntries: boolean;
	employeeTimezone: string;
	timeFormat: TimeFormat;
	employeeId: string;
}

export function TimeEntriesTable({
	workPeriods,
	hasManager,
	canApproveTimeEntries,
	employeeTimezone,
	timeFormat,
	employeeId,
}: Props) {
	const { t } = useTranslate();
	const { refresh } = useRouter();
	const [approvingWorkPeriodId, setApprovingWorkPeriodId] = useState<string | null>(null);

	const handleApproveWorkPeriod = useCallback(
		async (period: WorkPeriodData) => {
			setApprovingWorkPeriodId(period.id);
			const result = await approveWorkPeriod(period.id);
			setApprovingWorkPeriodId(null);

			if (!result.success) {
				toast.error(
					result.error || t("timeTracking.table.approveFailed", "Failed to approve entry"),
				);
				return;
			}

			toast.success(t("timeTracking.table.approved", "Time entry approved"));
			startTransition(() => refresh());
		},
		[refresh, t],
	);

	const columns = useMemo(
		() =>
			getTimeEntriesColumns({
				t,
				employeeTimezone,
				timeFormat,
				hasManager,
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
						isSameDay={isSameDay}
						employeeTimezone={employeeTimezone}
					/>
				),
			}),
		[
			t,
			employeeTimezone,
			timeFormat,
			hasManager,
			canApproveTimeEntries,
			approvingWorkPeriodId,
			handleApproveWorkPeriod,
		],
	);

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0 pb-4">
				<CardTitle>{t("timeTracking.table.title", "Time Entries")}</CardTitle>
				<div className="flex items-center gap-2">
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
			<CardContent>
				<DataTable
					columns={columns}
					data={workPeriods}
					emptyMessage={t(
						"timeTracking.table.emptyState",
						"No time entries found for this week. Clock in to start tracking your time.",
					)}
				/>
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

	if (period.approvalStatus !== "pending") {
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
