"use client";

import { IconClock, IconHome } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/user-avatar";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { normalizePronouns } from "@/lib/employee-identity";
import { useEmployeeClockStatuses } from "@/lib/query";
import type { EmployeeDetail } from "@/lib/query/use-employee";
import { Link } from "@/navigation";
import { defaultTranslate, type Translate } from "./employee-section-shared";
import { scheduleDayKeys } from "./page-utils";

type EmployeeManagerRelation = {
	id: string;
	isPrimary: boolean;
	manager: { user: { firstName?: string | null; lastName?: string | null; name: string } };
};

export function EmployeeOverviewCard({
	employee,
	schedule,
	t = defaultTranslate,
}: {
	employee: EmployeeDetail;
	schedule: unknown;
	t?: Translate;
}) {
	const effectiveSchedule = schedule as {
		policyName: string;
		hoursPerCycle?: number | null;
		scheduleCycle?: string | null;
		homeOfficeDaysPerCycle?: number | null;
		assignedVia: string;
		scheduleType?: string | null;
		days?: Array<{ dayOfWeek: string; isWorkDay: boolean }>;
	} | null;

	const scheduleCycleLabels: Record<string, string> = {
		weekly: t("settings.employees.detailView.scheduleCycleWeekly", "weekly"),
		week: t("settings.employees.detailView.scheduleCycleWeekly", "weekly"),
	};
	const assignedViaLabels: Record<string, string> = {
		Individual: t("settings.employees.detailView.assignedViaIndividual", "Individual"),
		"Organization Default": t(
			"settings.employees.detailView.assignedViaOrganizationDefault",
			"Organization Default",
		),
		Team: t("settings.employees.detailView.assignedViaTeam", "Team"),
	};
	const scheduleDayLabels = [
		t("settings.employees.detailView.dayMonday", "Mon"),
		t("settings.employees.detailView.dayTuesday", "Tue"),
		t("settings.employees.detailView.dayWednesday", "Wed"),
		t("settings.employees.detailView.dayThursday", "Thu"),
		t("settings.employees.detailView.dayFriday", "Fri"),
		t("settings.employees.detailView.daySaturday", "Sat"),
		t("settings.employees.detailView.daySunday", "Sun"),
	];
	const managers = employee.managers as EmployeeManagerRelation[] | undefined;
	const displayName = buildAuthUserDisplayName(employee.user);
	const employeePronouns = normalizePronouns(employee.pronouns);
	const employeeDisplayName = employeePronouns
		? `${displayName} (${employeePronouns})`
		: displayName;
	const isDraft = employee.kind === "invitationDraft";
	const presence = useEmployeeClockStatuses(isDraft ? [] : [employee.id], { polling: false });

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.employees.detailView.employeeInformation", "Employee Information")}
				</CardTitle>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-3">
					<UserAvatar
						image={employee.user.image}
						seed={employee.user.id}
						name={employeeDisplayName}
						size="lg"
						clockStatus={isDraft ? undefined : presence.getStatus(employee.id)}
					/>
					<div className="min-w-0">
						<div className="truncate font-medium">{employeeDisplayName}</div>
						<div className="truncate text-sm text-muted-foreground">{employee.user.email}</div>
					</div>
				</div>

				<Separator />

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.employees.detailView.team", "Team")}
					</div>
					<div>{employee.team?.name || "-"}</div>
				</div>

				<div className="space-y-2">
					<div className="text-sm text-muted-foreground">
						{t("settings.employees.detailView.status", "Status")}
					</div>
					{isDraft ? (
						<div className="flex flex-wrap gap-1">
							<Badge variant="secondary">
								{t("settings.employees.detailView.statusDraft", "Draft")}
							</Badge>
							<Badge variant="outline">{employee.invitationStatus}</Badge>
						</div>
					) : (
						<Badge variant={employee.isActive ? "default" : "secondary"}>
							{employee.isActive
								? t("settings.employees.detailView.statusActive", "Active")
								: t("settings.employees.detailView.statusInactive", "Inactive")}
						</Badge>
					)}
				</div>

				{isDraft && employee.realEmployeeId && (
					<Button asChild variant="outline" size="sm">
						<Link href={`/settings/employees/${employee.realEmployeeId}`}>
							{t("settings.employees.detailView.editRealEmployee", "Edit active employee")}
						</Link>
					</Button>
				)}

				{employee.employeeNumber && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">
							{t("settings.employees.detailView.employeeNumber", "Employee Number")}
						</div>
						<div className="font-mono text-sm">{employee.employeeNumber}</div>
					</div>
				)}

				{managers && managers.length > 0 && (
					<div className="space-y-2">
						<div className="text-sm text-muted-foreground">
							{t("settings.employees.detailView.managers", "Managers")}
						</div>
						<div className="space-y-1">
							{managers.map((manager) => {
								const managerName = buildAuthUserDisplayName(manager.manager.user);

								return (
									<div key={manager.id} className="flex items-center gap-2">
										<span>{managerName}</span>
										{manager.isPrimary && (
											<Badge variant="secondary" className="text-xs">
												{t("settings.employees.detailView.primaryManager", "Primary")}
											</Badge>
										)}
									</div>
								);
							})}
						</div>
					</div>
				)}

				<Separator />

				<div className="space-y-3">
					<div className="flex items-center gap-2 text-sm text-muted-foreground">
						<IconClock className="size-4" aria-hidden="true" />
						<span>{t("settings.employees.detailView.workSchedule", "Work Schedule")}</span>
					</div>
					{effectiveSchedule ? (
						<div className="space-y-2">
							<div className="font-medium">{effectiveSchedule.policyName}</div>
							<div className="flex flex-wrap gap-2">
								{effectiveSchedule.hoursPerCycle && (
									<Badge variant="outline">
										{effectiveSchedule.hoursPerCycle}h /{" "}
										{scheduleCycleLabels[effectiveSchedule.scheduleCycle ?? ""] ??
											effectiveSchedule.scheduleCycle ??
											t("settings.employees.detailView.scheduleCycleWeekly", "weekly")}
									</Badge>
								)}
								{effectiveSchedule.homeOfficeDaysPerCycle != null &&
									effectiveSchedule.homeOfficeDaysPerCycle > 0 && (
										<Badge variant="outline" className="flex items-center gap-1">
											<IconHome className="size-3" aria-hidden="true" />
											{t(
												"settings.employees.detailView.homeOfficeDays",
												"{count} home office day(s)",
												{
													count: effectiveSchedule.homeOfficeDaysPerCycle,
												},
											)}
										</Badge>
									)}
							</div>
							<div className="text-xs text-muted-foreground">
								{t("settings.employees.detailView.assignedVia", "Assigned via: {source}", {
									source:
										assignedViaLabels[effectiveSchedule.assignedVia] ??
										effectiveSchedule.assignedVia,
								})}
							</div>
							{effectiveSchedule.scheduleType === "detailed" && effectiveSchedule.days && (
								<div className="mt-2 flex flex-wrap gap-1">
									{scheduleDayLabels.map((label, index) => {
										const scheduleDay = effectiveSchedule.days?.find(
											(day) => day.dayOfWeek === scheduleDayKeys[index],
										);
										const isWorkDay = scheduleDay?.isWorkDay ?? false;
										return (
											<div
												key={label}
												className={`rounded px-2 py-1 text-xs ${
													isWorkDay
														? "bg-primary/10 text-primary"
														: "bg-muted text-muted-foreground"
												}`}
											>
												{label}
											</div>
										);
									})}
								</div>
							)}
						</div>
					) : (
						<div className="text-sm text-muted-foreground">
							{t("settings.employees.detailView.noScheduleAssigned", "No schedule assigned")}
						</div>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
