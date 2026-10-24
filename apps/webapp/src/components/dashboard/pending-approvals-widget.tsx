"use client";

import {
	IconAlertCircle,
	IconArrowRight,
	IconBeach,
	IconClock,
	IconClockEdit,
} from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import type { DashboardWidgetData, DashboardWidgetSnapshot } from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { formatDashboardDate, formatDashboardDateWithYear } from "./format-dashboard-date";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

function UrgencyIndicator({ count }: { count: number }) {
	const { t } = useTranslate();
	const isUrgent = count >= 5;
	const isWarning = count >= 3;
	const requestLabel =
		count === 1
			? t("dashboard.pending-approvals.request", "request")
			: t("dashboard.pending-approvals.requests", "requests");

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
					{t("dashboard.pending-approvals.pending-requests", "{count} pending {request}", {
						count,
						request: requestLabel,
					})}
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

export function PendingApprovalsWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<DashboardWidgetData["pending-approvals"]>;
} = {}) {
	const { t } = useTranslate();
	const tolgee = useTolgee();
	const locale = tolgee.getLanguage() || "en";
	const { data, loading, refreshing, refetch, error } = useDashboardWidget(
		"pending-approvals",
		initialSnapshot,
	);
	const absenceApprovals = data?.absenceApprovals ?? [];
	const timeCorrectionApprovals = data?.timeCorrectionApprovals ?? [];
	const totalPending = absenceApprovals.length + timeCorrectionApprovals.length;

	return (
		<DashboardWidget id="pending-approvals">
			<WidgetCard
				title={t("dashboard.pending-approvals.title", "Pending Approvals")}
				description={t(
					"dashboard.pending-approvals.description",
					"Requests awaiting your decision",
				)}
				icon={<IconClock className="size-4 text-amber-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
			>
				<div className="space-y-4">
					{error ? (
						<WidgetReadError
							title={t("dashboard.pending-approvals.title", "Pending Approvals")}
							message={error}
							retry={refetch}
							refreshing={refreshing}
						/>
					) : totalPending === 0 ? (
						<p>{t("dashboard.pending-approvals.empty", "No pending approvals")}</p>
					) : (
						<>
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
											subtitle={`${formatDashboardDate(approval.absence.startDate, locale)} - ${formatDashboardDateWithYear(approval.absence.endDate, locale)}`}
											badge={approval.absence.category.name}
										/>
									))}
									{absenceApprovals.length > 3 && (
										<p className="text-center text-xs text-muted-foreground pt-1">
											{t("dashboard.pending-approvals.more-requests", "+{count} more requests", {
												count: absenceApprovals.length - 3,
											})}
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
											subtitle={formatDashboardDateWithYear(approval.workPeriod.startTime, locale)}
											badge={t("dashboard.pending-approvals.correction", "Correction")}
										/>
									))}
									{timeCorrectionApprovals.length > 3 && (
										<p className="text-center text-xs text-muted-foreground pt-1">
											{t("dashboard.pending-approvals.more-requests", "+{count} more requests", {
												count: timeCorrectionApprovals.length - 3,
											})}
										</p>
									)}
								</ApprovalSection>
							)}

							{/* Action Button */}
							<Button className="w-full group" asChild>
								<Link href="/approvals/inbox">
									{t("dashboard.pending-approvals.review-all", "Review All Approvals")}
									<IconArrowRight
										className="ml-2 size-4 transition-transform group-hover:translate-x-1"
										aria-hidden="true"
									/>
								</Link>
							</Button>
						</>
					)}
				</div>
			</WidgetCard>
		</DashboardWidget>
	);
}
