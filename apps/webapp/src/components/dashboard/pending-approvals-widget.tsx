"use client";

import { IconAlertCircle, IconCheck, IconClock } from "@tabler/icons-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getPendingApprovals } from "@/app/[locale]/(app)/approvals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "@/lib/datetime/luxon-utils";
import { pluralize } from "@/lib/utils";
import { Link } from "@/navigation";
import { WidgetCard } from "./widget-card";

type AbsenceApproval = {
	id: string;
	startDate: Date;
	endDate: Date;
	type: string;
	employee: {
		user: {
			name: string | null;
		};
	};
};

type TimeCorrectionApproval = {
	id: string;
	date: Date;
	employee: {
		user: {
			name: string | null;
		};
	};
};

export function PendingApprovalsWidget() {
	const [absenceApprovals, setAbsenceApprovals] = useState<AbsenceApproval[]>([]);
	const [timeCorrectionApprovals, setTimeCorrectionApprovals] = useState<TimeCorrectionApproval[]>(
		[],
	);
	const [loading, setLoading] = useState(true);
	const [refreshing, setRefreshing] = useState(false);

	const loadData = useCallback(async (isRefresh = false) => {
		if (isRefresh) {
			setRefreshing(true);
		}
		try {
			const { absenceApprovals: absences, timeCorrectionApprovals: corrections } =
				await getPendingApprovals();
			setAbsenceApprovals(absences);
			setTimeCorrectionApprovals(corrections);
		} catch {
			toast.error("Failed to load pending approvals");
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		loadData(false);
	}, [loadData]);

	const refetch = useCallback(() => {
		loadData(true);
	}, [loadData]);

	const totalPending = absenceApprovals.length + timeCorrectionApprovals.length;

	if (!loading && totalPending === 0) return null;

	return (
		<WidgetCard
			title="Pending Approvals"
			description={`${totalPending} ${pluralize(totalPending, "request")} awaiting your approval`}
			icon={<IconClock className="size-4 text-muted-foreground" />}
			loading={loading}
			refreshing={refreshing}
			onRefresh={refetch}
			action={
				<Badge variant="secondary" className="text-lg">
					{totalPending}
				</Badge>
			}
		>
			<div className="space-y-3">
				{/* Absence Requests */}
				{absenceApprovals.length > 0 && (
					<div className="rounded-lg border p-4">
						<div className="mb-3 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<IconAlertCircle className="size-5 text-orange-500" />
								<span className="font-medium">Absence Requests</span>
							</div>
							<Badge variant="secondary">{absenceApprovals.length}</Badge>
						</div>
						<div className="space-y-2">
							{absenceApprovals.slice(0, 3).map((approval) => (
								<div key={approval.id} className="flex items-center justify-between text-sm">
									<div>
										<div className="font-medium">{approval.employee.user.name}</div>
										<div className="text-xs text-muted-foreground">
											{format(new Date(approval.startDate), "MMM d")} -{" "}
											{format(new Date(approval.endDate), "MMM d, yyyy")}
										</div>
									</div>
									<Badge variant="outline">{approval.type}</Badge>
								</div>
							))}
						</div>
					</div>
				)}

				{/* Time Correction Requests */}
				{timeCorrectionApprovals.length > 0 && (
					<div className="rounded-lg border p-4">
						<div className="mb-3 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<IconCheck className="size-5 text-blue-500" />
								<span className="font-medium">Time Corrections</span>
							</div>
							<Badge variant="secondary">{timeCorrectionApprovals.length}</Badge>
						</div>
						<div className="space-y-2">
							{timeCorrectionApprovals.slice(0, 3).map((approval) => (
								<div key={approval.id} className="flex items-center justify-between text-sm">
									<div>
										<div className="font-medium">{approval.employee.user.name}</div>
										<div className="text-xs text-muted-foreground">
											{format(new Date(approval.date), "MMM d, yyyy")}
										</div>
									</div>
									<Badge variant="outline">Correction</Badge>
								</div>
							))}
						</div>
					</div>
				)}

				<div className="pt-2">
					<Button className="w-full" asChild>
						<Link href="/approvals">Review All Approvals</Link>
					</Button>
				</div>
			</div>
		</WidgetCard>
	);
}
