"use client";

import { IconBeach, IconCheck, IconCircleCheck, IconClockEdit } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "@/lib/datetime/luxon-utils";
import { cn, pluralize } from "@/lib/utils";
import { Link } from "@/navigation";
import { getRecentlyApprovedRequests } from "./actions";
import { DashboardWidget } from "./dashboard-widget";
import { useWidgetData } from "./use-widget-data";
import { WidgetCard } from "./widget-card";

type RecentlyApproved = {
	id: string;
	type: "absence" | "time_correction";
	updatedAt: Date;
	requestedByEmployee: {
		user: {
			name: string | null;
		};
	};
	approverEmployee: {
		user: {
			name: string | null;
		};
	} | null;
};

function ApprovedCard({ request }: { request: RecentlyApproved }) {
	const { t } = useTranslate();
	const isAbsence = request.type === "absence";

	return (
		<div className="group flex items-center gap-3 rounded-xl border bg-card p-3 transition-all hover:shadow-md hover:border-emerald-200 dark:hover:border-emerald-800">
			{/* Status Icon */}
			<div
				className={cn(
					"flex items-center justify-center rounded-lg p-2",
					isAbsence ? "bg-amber-100 dark:bg-amber-950/50" : "bg-blue-100 dark:bg-blue-950/50",
				)}
			>
				{isAbsence ? (
					<IconBeach className="size-4 text-amber-600 dark:text-amber-400" />
				) : (
					<IconClockEdit className="size-4 text-blue-600 dark:text-blue-400" />
				)}
			</div>

			{/* Info */}
			<div className="flex-1 min-w-0">
				<div className="font-medium text-sm truncate">
					{request.requestedByEmployee.user.name || t("common.unknown", "Unknown")}
				</div>
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<IconCircleCheck className="size-3 text-emerald-500" />
					<span className="truncate">
						{t("dashboard.recently-approved.by", "by {name}", {
							name: request.approverEmployee?.user.name || t("common.unknown", "Unknown"),
						})}
					</span>
					<span className="text-muted-foreground/50">•</span>
					<span>{format(new Date(request.updatedAt), "MMM d")}</span>
				</div>
			</div>

			{/* Badge */}
			<Badge
				variant="secondary"
				className={cn(
					"shrink-0 text-xs font-medium",
					isAbsence
						? "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
						: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
				)}
			>
				{isAbsence
					? t("dashboard.recently-approved.absence", "Absence")
					: t("dashboard.recently-approved.time", "Time")}
			</Badge>
		</div>
	);
}

export function RecentlyApprovedWidget() {
	const { t } = useTranslate();
	const {
		data: requests,
		loading,
		refreshing,
		refetch,
	} = useWidgetData<RecentlyApproved[]>(() => getRecentlyApprovedRequests(10), {
		errorMessage: t(
			"dashboard.recently-approved.error",
			"Failed to load recently approved requests",
		),
	});

	if (!loading && (!requests || requests.length === 0)) return null;

	return (
		<DashboardWidget id="recently-approved">
			<WidgetCard
				title={t("dashboard.recently-approved.title", "Recently Approved")}
				description={
					requests
						? t(
								"dashboard.recently-approved.description-count",
								"Last {count} approved {request}",
								{ count: requests.length, request: pluralize(requests.length, "request") },
							)
						: t("dashboard.recently-approved.description", "Latest approved requests")
				}
				icon={<IconCheck className="size-4 text-emerald-500" />}
				loading={loading}
				refreshing={refreshing}
				onRefresh={refetch}
				action={
					requests && requests.length > 0 ? (
						<div className="flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 dark:bg-emerald-950/50">
							<IconCircleCheck className="size-3.5 text-emerald-600 dark:text-emerald-400" />
							<span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
								{requests.length}
							</span>
						</div>
					) : undefined
				}
			>
				{requests && (
					<div className="space-y-3">
						{/* Success Summary */}
						<div className="flex items-center gap-3 rounded-xl bg-gradient-to-r from-emerald-50 to-green-50 p-3 dark:from-emerald-950/30 dark:to-green-950/30">
							<div className="rounded-full bg-emerald-500 p-1.5">
								<IconCheck className="size-4 text-white" />
							</div>
							<div>
								<p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
									{t("dashboard.recently-approved.all-caught-up", "All caught up!")}
								</p>
								<p className="text-xs text-emerald-600/80 dark:text-emerald-400/80">
									{t(
										"dashboard.recently-approved.approved-recently",
										"{count} {request} approved recently",
										{ count: requests.length, request: pluralize(requests.length, "request") },
									)}
								</p>
							</div>
						</div>

						{/* List */}
						<div className="space-y-2">
							{requests.slice(0, 5).map((request) => (
								<ApprovedCard key={request.id} request={request} />
							))}
						</div>

						{requests.length > 5 && (
							<div className="flex items-center justify-center rounded-lg border border-dashed py-2 text-xs text-muted-foreground">
								{t("dashboard.recently-approved.more-approved", "+{count} more approved", {
									count: requests.length - 5,
								})}
							</div>
						)}

						<Button className="w-full" variant="outline" asChild>
							<Link href="/approvals">
								{t("dashboard.recently-approved.view-all", "View All Approvals")}
							</Link>
						</Button>
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
