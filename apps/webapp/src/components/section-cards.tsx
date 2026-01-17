"use client";

import { BirthdayRemindersWidget } from "@/components/dashboard/birthday-reminders-widget";
import { ManagedEmployeesWidget } from "@/components/dashboard/managed-employees-widget";
import { PendingApprovalsWidget } from "@/components/dashboard/pending-approvals-widget";
import { QuickStatsWidget } from "@/components/dashboard/quick-stats-widget";
import { RecentlyApprovedWidget } from "@/components/dashboard/recently-approved-widget";
import { TeamOverviewWidget } from "@/components/dashboard/team-overview-widget";
import { UpcomingTimeOffWidget } from "@/components/dashboard/upcoming-time-off-widget";
import { WhosOutTodayWidget } from "@/components/dashboard/whos-out-today-widget";
import { Skeleton } from "@/components/ui/skeleton";

function WidgetSkeleton() {
	return (
		<div className="rounded-xl border bg-card p-6">
			<div className="flex items-center justify-between mb-4">
				<Skeleton className="h-5 w-32" />
				<Skeleton className="h-4 w-4 rounded-full" />
			</div>
			<div className="space-y-3">
				<Skeleton className="h-4 w-full" />
				<Skeleton className="h-4 w-3/4" />
				<Skeleton className="h-4 w-1/2" />
			</div>
		</div>
	);
}

export function SectionCardsSkeleton() {
	return (
		<div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 lg:px-6">
			{Array.from({ length: 8 }).map((_, i) => (
				<WidgetSkeleton key={i} />
			))}
		</div>
	);
}

export function SectionCards() {
	return (
		<div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 lg:px-6">
			{/* Existing widgets from previous work */}
			<ManagedEmployeesWidget />
			<PendingApprovalsWidget />
			<TeamOverviewWidget />

			{/* New widgets - Phase 2 */}
			<QuickStatsWidget />
			<WhosOutTodayWidget />
			<UpcomingTimeOffWidget />
			<RecentlyApprovedWidget />
			<BirthdayRemindersWidget />
		</div>
	);
}
