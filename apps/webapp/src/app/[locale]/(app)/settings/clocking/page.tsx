import { and, eq } from "drizzle-orm";
import { Suspense } from "react";
import { OrganizationAutoClockOutCard } from "@/components/organization/organization-auto-clock-out-card";
import { OrganizationClockingRemindersCard } from "@/components/organization/organization-clocking-reminders-card";
import { OrganizationPeriodSubmissionsCard } from "@/components/organization/organization-period-submissions-card";
import { OrganizationTrackingCard } from "@/components/organization/organization-tracking-card";
import { SettingsPageSkeleton } from "@/components/settings/settings-skeletons";
import { SettingsTabbedPage } from "@/components/settings/settings-tabbed-page";
import { db } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { requireOrgAdminSettingsAccess } from "@/lib/auth-helpers";
import { systemClock } from "@/lib/datetime/temporal-core";
import { redirectWithLocale } from "@/lib/navigation/locale-redirect";
import { loadOrganizationTrackingSettings } from "@/lib/organization/tracking-settings";
import { loadAutoClockOutSettings } from "@/lib/time-tracking/automatic-clock-out/settings";
import { loadClockingReminderSettings } from "@/lib/time-tracking/clocking-reminders/settings";
import { loadPeriodSubmissionSettings } from "@/lib/time-tracking/period-submissions/settings";
import { getTranslate } from "@/tolgee/server";

async function ClockingSettingsContent() {
	const [{ authContext, organizationId }, t] = await Promise.all([
		requireOrgAdminSettingsAccess(),
		getTranslate(),
	]);
	const [
		organizationRecord,
		currentMembers,
		trackingSettings,
		autoClockOutSettings,
		clockingReminderSettings,
		periodSubmissionSettings,
	] = await Promise.all([
		db.query.organization.findFirst({
			where: eq(organization.id, organizationId),
		}),
		db
			.select({ role: member.role })
			.from(member)
			.where(
				and(
					eq(member.userId, authContext.user.id),
					eq(member.organizationId, organizationId),
				),
			)
			.limit(1),
		loadOrganizationTrackingSettings(db, organizationId),
		loadAutoClockOutSettings(db, organizationId),
		loadClockingReminderSettings(db, organizationId),
		loadPeriodSubmissionSettings(db, organizationId, { clock: systemClock }),
	]);
	if (!organizationRecord || !currentMembers[0])
		return redirectWithLocale("/settings");
	const currentMemberRole = currentMembers[0].role as
		| "owner"
		| "admin"
		| "member";
	return (
		<SettingsTabbedPage
			key={organizationId}
			title={t("settings.navigation.clocking.title", "Clocking")}
			defaultTab="tracking"
			tabs={[
				{
					value: "tracking",
					label: t("organization.tracking.title", "Time tracking start"),
					description: t(
						"settings.navigation.clocking.trackingDescription",
						"Set the start date used for your organization’s time tracking",
					),
					panel: (
						<OrganizationTrackingCard
							settings={trackingSettings}
							createdAt={organizationRecord.createdAt.toISOString()}
							timezone={organizationRecord.timezone ?? "UTC"}
						/>
					),
				},
				{
					value: "automatic-clock-out",
					label: t("organization.autoClockOut.title", "Automatic clock-out"),
					description: t(
						"settings.navigation.clocking.automaticDescription",
						"Configure automatic clock-out for uninterrupted work",
					),
					panel: (
						<OrganizationAutoClockOutCard
							organizationId={organizationId}
							settings={autoClockOutSettings}
							currentMemberRole={currentMemberRole}
						/>
					),
				},
				{
					value: "reminders",
					label: t(
						"organization.clockingReminders.title",
						"Clocking reminders",
					),
					description: t(
						"settings.navigation.clocking.remindersDescription",
						"Configure reminders for clock-ins, clock-outs and breaks",
					),
					panel: (
						<OrganizationClockingRemindersCard
							organizationId={organizationId}
							settings={clockingReminderSettings}
							currentMemberRole={currentMemberRole}
						/>
					),
				},
				{
					value: "submissions",
					label: t(
						"organization.periodSubmissions.title",
						"Period submissions",
					),
					description: t(
						"settings.navigation.clocking.submissionsDescription",
						"Configure when employees submit their work periods for review",
					),
					panel: (
						<OrganizationPeriodSubmissionsCard
							organizationId={organizationId}
							settings={periodSubmissionSettings}
							currentMemberRole={currentMemberRole}
						/>
					),
				},
			]}
		/>
	);
}
export default function ClockingSettingsPage() {
	return (
		<Suspense
			fallback={
				<SettingsPageSkeleton
					label={{
						labelKey: "settings.loading",
						labelDefault: "Loading settings",
					}}
				/>
			}
		>
			<ClockingSettingsContent />
		</Suspense>
	);
}
