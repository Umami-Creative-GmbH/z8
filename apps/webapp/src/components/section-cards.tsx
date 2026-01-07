"use client";

import { ManagedEmployeesWidget } from "@/components/dashboard/managed-employees-widget";
import { PendingApprovalsWidget } from "@/components/dashboard/pending-approvals-widget";
import { TeamOverviewWidget } from "@/components/dashboard/team-overview-widget";
import { UpcomingTimeOffWidget } from "@/components/dashboard/upcoming-time-off-widget";
import { QuickStatsWidget } from "@/components/dashboard/quick-stats-widget";
import { RecentlyApprovedWidget } from "@/components/dashboard/recently-approved-widget";
import { BirthdayRemindersWidget } from "@/components/dashboard/birthday-reminders-widget";
import { TeamCalendarWidget } from "@/components/dashboard/team-calendar-widget";

export function SectionCards() {
	return (
		<div className="grid @5xl/main:grid-cols-3 @xl/main:grid-cols-2 grid-cols-1 gap-4 px-4 lg:px-6">
			{/* Existing widgets from previous work */}
			<ManagedEmployeesWidget />
			<PendingApprovalsWidget />
			<TeamOverviewWidget />

			{/* New widgets - Phase 2 */}
			<QuickStatsWidget />
			<UpcomingTimeOffWidget />
			<TeamCalendarWidget />
			<RecentlyApprovedWidget />
			<BirthdayRemindersWidget />
		</div>
	);
}
