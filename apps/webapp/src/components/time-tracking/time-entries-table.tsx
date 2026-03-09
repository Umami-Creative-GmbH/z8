"use client";

import { useTranslate } from "@tolgee/react";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { DataTable } from "@/components/data-table-server";
import {
	getTimeEntriesColumns,
	type WorkPeriodData,
} from "@/components/time-tracking/time-entries-table-columns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useRouter } from "@/navigation";

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
	employeeTimezone: string;
	employeeId: string;
}

export function TimeEntriesTable({ workPeriods, hasManager, employeeTimezone, employeeId }: Props) {
	const { t } = useTranslate();
	const router = useRouter();

	const columns = useMemo(
		() =>
			getTimeEntriesColumns({
				t,
				employeeTimezone,
				hasManager,
				renderEditAction: (period, isSameDay) => (
					<TimeCorrectionDialog
						workPeriod={period}
						isSameDay={isSameDay}
						employeeTimezone={employeeTimezone}
					/>
				),
			}),
		[t, employeeTimezone, hasManager],
	);

	return (
		<Card>
			<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
				<CardTitle>{t("timeTracking.table.title", "Time Entries")}</CardTitle>
				<div>
					<ManualTimeEntryDialog
						employeeId={employeeId}
						employeeTimezone={employeeTimezone}
						hasManager={hasManager}
						onSuccess={() => router.refresh()}
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
