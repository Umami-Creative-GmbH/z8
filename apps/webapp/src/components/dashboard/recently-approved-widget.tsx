"use client";

import {
	IconBeach,
	IconCheck,
	IconCircleCheck,
	IconClockEdit,
} from "@tabler/icons-react";
import { useTolgee, useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import type {
	DashboardWidgetData,
	DashboardWidgetSnapshot,
} from "./dashboard-types";
import { DashboardWidget } from "./dashboard-widget";
import { formatDashboardDate } from "./format-dashboard-date";
import { useDashboardWidget } from "./use-dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WidgetReadError } from "./widget-read-error";

type RecentlyApproved = DashboardWidgetData["recently-approved"][number];

function ApprovedCard({ request }: { request: RecentlyApproved }) {
	const { t } = useTranslate();
	const tolgee = useTolgee();
	const locale = tolgee.getLanguage() || "en";
	const isAbsence = request.type === "absence";

	return (
		<div className="flex items-center gap-3 py-3">
			{/* Status Icon */}
			<div
				className={cn(
					"flex items-center justify-center rounded-lg p-2",
					"bg-muted",
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
					{request.requestedByEmployee.user.name ||
						t("common.unknown", "Unknown")}
				</div>
				<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
					<IconCircleCheck className="size-3 text-emerald-500" />
					<span className="truncate">
						{t("dashboard.recently-approved.by", "by {name}", {
							name:
								request.approverEmployee?.user.name ||
								t("common.unknown", "Unknown"),
						})}
					</span>
					<span className="text-muted-foreground/50">•</span>
					<span>{formatDashboardDate(request.updatedAt, locale)}</span>
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

export function RecentlyApprovedWidget({
	initialSnapshot,
}: {
	initialSnapshot?: DashboardWidgetSnapshot<
		DashboardWidgetData["recently-approved"]
	>;
} = {}) {
	const { t } = useTranslate();
	const {
		data: requests,
		loading,
		refreshing,
		refetch,
		error,
	} = useDashboardWidget("recently-approved", initialSnapshot);

	const requestLabel = requests
		? requests.length === 1
			? t("dashboard.recently-approved.request", "request")
			: t("dashboard.recently-approved.requests", "requests")
		: t("dashboard.recently-approved.requests", "requests");

	return (
		<DashboardWidget id="recently-approved">
			<WidgetCard
				title={t("dashboard.recently-approved.title", "Recently Approved")}
				description={
					requests
						? t(
								"dashboard.recently-approved.description-count",
								"Last {count} approved {request}",
								{ count: requests.length, request: requestLabel },
							)
						: t(
								"dashboard.recently-approved.description",
								"Latest approved requests",
							)
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
				{error ? (
					<WidgetReadError
						title={t("dashboard.recently-approved.title", "Recently Approved")}
						message={error}
						retry={refetch}
						refreshing={refreshing}
					/>
				) : !requests?.length ? (
					<p role="status">
						{t(
							"dashboard.recently-approved.empty",
							"No recently approved requests",
						)}
					</p>
				) : (
					<div className="space-y-3">
						<div className="divide-y">
							{requests.slice(0, 2).map((request) => (
								<ApprovedCard key={request.id} request={request} />
							))}
						</div>
						{requests.length > 2 ? (
							<details>
								<summary className="cursor-pointer rounded-md py-2 text-sm text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
									{t(
										"dashboard.recently-approved.more-approved",
										"+{count} more approved",
										{ count: requests.length - 2 },
									)}
								</summary>
								<div className="divide-y">
									{requests.slice(2).map((request) => (
										<ApprovedCard key={request.id} request={request} />
									))}
								</div>
							</details>
						) : null}

						<Button className="w-full" variant="outline" asChild>
							<Link href="/approvals/inbox">
								{t(
									"dashboard.recently-approved.view-all",
									"View All Approvals",
								)}
							</Link>
						</Button>
					</div>
				)}
			</WidgetCard>
		</DashboardWidget>
	);
}
