"use client";

import {
	IconAlertCircle,
	IconArrowRight,
	IconBeach,
	IconClock,
	IconClockEdit,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { getPendingApprovals } from "@/app/[locale]/(app)/approvals/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, pluralize } from "@/lib/utils";
import type { ApprovalWithAbsence, ApprovalWithTimeCorrection } from "@/lib/validations/approvals";
import { Link } from "@/navigation";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";

const formatDateStr = (dateStr: string): string => {
	return DateTime.fromISO(dateStr).toFormat("MMM d");
};

const formatDateStrFull = (dateStr: string): string => {
	return DateTime.fromISO(dateStr).toFormat("MMM d, yyyy");
};

function UrgencyIndicator({ count }: { count: number }) {
	const { t } = useTranslate();
	const isUrgent = count >= 5;
	const isWarning = count >= 3;

	return (
		<div
			className={cn(
				"flex items-center gap-2 rounded-xl px-4 py-3",
				isUrgent
					? "bg-gradient-to-r from-red-500 to-orange-500 text-white shadow-lg shadow-red-500/25"
					: isWarning
						? "bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-500/25"
						: "bg-gradient-to-r from-blue-500 to-indigo-500 text-white shadow-lg shadow-blue-500/25",
			)}
		>
			<div className="flex items-center justify-center rounded-full bg-white/20 p-2">
				<IconAlertCircle className="size-5" />
			</div>
			<div className="flex-1">
				<p className="font-semibold">
					{t("dashboard.pending-approvals.pending-requests", "{count} pending {request}", { count, request: pluralize(count, "request") })}
				</p>
				<p className="text-xs opacity-90">
					{isUrgent
						? t("dashboard.pending-approvals.requires-attention", "Requires immediate attention")
						: t("dashboard.pending-approvals.awaiting-approval", "Awaiting your approval")}
				</p>
			</div>
		</div>
	);
}

function ApprovalSection({
	title,
	icon: Icon,
	iconColor,
	count,
	children,
}: {
	title: string;
	icon: React.ElementType;
	iconColor: string;
	count: number;
	children: React.ReactNode;
}) {
	return (
		<div className="rounded-xl border bg-card">
			<div className="flex items-center justify-between border-b px-4 py-3">
				<div className="flex items-center gap-2">
					<div className={cn("rounded-lg p-1.5", iconColor)}>
						<Icon className="size-4 text-white" />
					</div>
					<span className="font-medium text-sm">{title}</span>
				</div>
				<Badge variant="secondary" className="font-semibold">
					{count}
				</Badge>
			</div>
			<div className="p-3 space-y-2">{children}</div>
		</div>
	);
}

function ApprovalItem({
	name,
	subtitle,
	badge,
}: {
	name: string;
	subtitle: string;
	badge: string;
}) {
	return (
		<div className="flex items-center justify-between rounded-lg bg-muted/50 p-2.5 transition-colors hover:bg-muted">
			<div className="min-w-0 flex-1">
				<p className="font-medium text-sm truncate">{name}</p>
				<p className="text-xs text-muted-foreground truncate">{subtitle}</p>
			</div>
			<Badge variant="outline" className="shrink-0 ml-2 text-xs">
				{badge}
			</Badge>
		</div>
	);
}

export function PendingApprovalsWidget() {
	const { t } = useTranslate();
	const [absenceApprovals, setAbsenceApprovals] = useState<ApprovalWithAbsence[]>([]);
	const [timeCorrectionApprovals, setTimeCorrectionApprovals] = useState<
		ApprovalWithTimeCorrection[]
	>([]);
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
			toast.error(t("dashboard.pending-approvals.error", "Failed to load pending approvals"));
		} finally {
			setLoading(false);
			setRefreshing(false);
		}
	}, [t]);

	useEffect(() => {
		loadData(false);
	}, [loadData]);

	const refetch = useCallback(() => {
		loadData(true);
	}, [loadData]);

	const totalPending = absenceApprovals.length + timeCorrectionApprovals.length;

	if (!loading && totalPending === 0) return null;

	return (
		<DashboardWidget id="pending-approvals">
			<WidgetCard
				title={t("dashboard.pending-approvals.title", "Pending Approvals")}
				description={t("dashboard.pending-approvals.description", "Requests awaiting your decision")}
				icon={<IconClock className="size-4 text-amber-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				<div className="space-y-4">
					{/* Urgency Banner */}
					<UrgencyIndicator count={totalPending} />

					{/* Absence Requests */}
					{absenceApprovals.length > 0 && (
						<ApprovalSection
							title={t("dashboard.pending-approvals.absence-requests", "Absence Requests")}
							icon={IconBeach}
							iconColor="bg-amber-500"
							count={absenceApprovals.length}
						>
							{absenceApprovals.slice(0, 3).map((approval) => (
								<ApprovalItem
									key={approval.id}
									name={approval.requester.user.name || t("common.unknown", "Unknown")}
									subtitle={`${formatDateStr(approval.absence.startDate)} - ${formatDateStrFull(approval.absence.endDate)}`}
									badge={approval.absence.category.name}
								/>
							))}
							{absenceApprovals.length > 3 && (
								<p className="text-center text-xs text-muted-foreground pt-1">
									{t("dashboard.pending-approvals.more-requests", "+{count} more requests", { count: absenceApprovals.length - 3 })}
								</p>
							)}
						</ApprovalSection>
					)}

					{/* Time Correction Requests */}
					{timeCorrectionApprovals.length > 0 && (
						<ApprovalSection
							title={t("dashboard.pending-approvals.time-corrections", "Time Corrections")}
							icon={IconClockEdit}
							iconColor="bg-blue-500"
							count={timeCorrectionApprovals.length}
						>
							{timeCorrectionApprovals.slice(0, 3).map((approval) => (
								<ApprovalItem
									key={approval.id}
									name={approval.requester.user.name || t("common.unknown", "Unknown")}
									subtitle={DateTime.fromJSDate(approval.workPeriod.startTime).toFormat(
										"MMM d, yyyy",
									)}
									badge={t("dashboard.pending-approvals.correction", "Correction")}
								/>
							))}
							{timeCorrectionApprovals.length > 3 && (
								<p className="text-center text-xs text-muted-foreground pt-1">
									{t("dashboard.pending-approvals.more-requests", "+{count} more requests", { count: timeCorrectionApprovals.length - 3 })}
								</p>
							)}
						</ApprovalSection>
					)}

					{/* Action Button */}
					<Button className="w-full group" asChild>
						<Link href="/approvals">
							{t("dashboard.pending-approvals.review-all", "Review All Approvals")}
							<IconArrowRight className="ml-2 size-4 transition-transform group-hover:translate-x-1" />
						</Link>
					</Button>
				</div>
			</WidgetCard>
		</DashboardWidget>
	);
}
