import { workPolicyAssignmentTargetLabel } from "./work-policy-assignment-target";
import {
	IconBuilding,
	IconFileText,
	IconPlus,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import type { WorkPolicyAssignmentWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { AssignmentLevelCardHeader } from "@/components/settings/assignment-level-card-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type AssignmentType = "organization" | "team" | "employee";

interface WorkPolicyAssignmentSectionsProps {
	sections: {
		organization?: {
			assignment: WorkPolicyAssignmentWithDetails | undefined;
			canManage: boolean;
		};
		team?: {
			assignments: WorkPolicyAssignmentWithDetails[];
			canManage: boolean;
		};
		employee?: {
			assignments: WorkPolicyAssignmentWithDetails[];
			canManage: boolean;
		};
	};
	onAssignClick: (type: AssignmentType) => void;
	onDeleteClick: (assignment: WorkPolicyAssignmentWithDetails) => void;
}

function RemoveAssignmentButton({
	assignment,
	kind,
	onDeleteClick,
}: {
	assignment: WorkPolicyAssignmentWithDetails;
	kind: AssignmentType;
	onDeleteClick: (assignment: WorkPolicyAssignmentWithDetails) => void;
}) {
	const { t } = useTranslate();
	return (
		<Button
			variant="ghost"
			size="icon"
			aria-label={t("settings.workPolicies.removeAssignmentFor", "Remove assignment for {name}", {
				name: workPolicyAssignmentTargetLabel(assignment, t, kind),
			})}
			className="shrink-0 text-destructive hover:text-destructive"
			onClick={() => onDeleteClick(assignment)}
		>
			<IconTrash className="size-4" aria-hidden="true" />
		</Button>
	);
}

function AssignmentRow({
	icon: Icon,
	title,
	subtitle,
	action,
	className,
}: {
	icon: typeof IconUser;
	title: string;
	subtitle?: string;
	action: ReactNode;
	className?: string;
}) {
	return (
		<div className={cn("flex items-center justify-between gap-3 rounded-lg border p-3", className)}>
			<div className="flex min-w-0 items-center gap-3">
				<Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
				<div className="min-w-0">
					<p className="truncate font-medium" title={title}>
						{title}
					</p>
					{subtitle ? (
						<p className="truncate text-xs text-muted-foreground" title={subtitle}>
							{subtitle}
						</p>
					) : null}
				</div>
			</div>
			{action}
		</div>
	);
}

interface OrganizationAssignmentSectionProps {
	assignment: WorkPolicyAssignmentWithDetails | undefined;
	canManageAssignments: boolean;
	onAssignClick: () => void;
	onDeleteClick: (assignment: WorkPolicyAssignmentWithDetails) => void;
}

export function OrganizationAssignmentSection({
	assignment,
	canManageAssignments,
	onAssignClick,
	onDeleteClick,
}: OrganizationAssignmentSectionProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<AssignmentLevelCardHeader
				icon={IconBuilding}
				title={t("settings.workPolicies.orgLevel", "Organization Default")}
				description={t(
					"settings.workPolicies.orgLevelDescription",
					"Default work policy applied to all employees unless overridden",
				)}
			/>
			<CardContent>
				{assignment ? (
					<AssignmentRow
						icon={IconFileText}
						className="bg-muted/30"
						title={assignment.policy?.name || t("common.unknown", "Unknown")}
						action={
							canManageAssignments ? (
								<RemoveAssignmentButton
									assignment={assignment}
									kind="organization"
									onDeleteClick={onDeleteClick}
								/>
							) : null
						}
					/>
				) : (
					<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-3">
						<p className="text-sm text-muted-foreground">
							{t("settings.workPolicies.noOrgAssignment", "No organization default set")}
						</p>
						{canManageAssignments ? (
							<Button onClick={onAssignClick} size="sm" variant="outline">
								<IconPlus className="mr-2 size-4" aria-hidden="true" />
								{t("settings.workPolicies.assignPolicy", "Assign Policy")}
							</Button>
						) : null}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

interface TeamAssignmentSectionProps {
	assignments: WorkPolicyAssignmentWithDetails[];
	canManageAssignments: boolean;
	onAssignClick: () => void;
	onDeleteClick: (assignment: WorkPolicyAssignmentWithDetails) => void;
}

export function TeamAssignmentSection({
	assignments,
	canManageAssignments,
	onAssignClick,
	onDeleteClick,
}: TeamAssignmentSectionProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<IconUsers className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
						<div className="min-w-0">
							<CardTitle className="text-base">
								{t("settings.workPolicies.teamLevel", "Team Overrides")}
								{assignments.length > 0 ? (
									<Badge variant="secondary" className="ml-2 tabular-nums">
										{assignments.length}
									</Badge>
								) : null}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.workPolicies.teamLevelDescription",
									"Override the organization default for specific teams",
								)}
							</CardDescription>
						</div>
					</div>
					{canManageAssignments ? (
						<Button onClick={onAssignClick} size="sm" variant="outline">
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.workPolicies.addTeam", "Add Team")}
						</Button>
					) : null}
				</div>
			</CardHeader>
			<CardContent>
				{assignments.length === 0 ? (
					<p className="py-4 text-center text-sm text-muted-foreground">
						{t("settings.workPolicies.noTeamAssignments", "No team-specific policies")}
					</p>
				) : (
					<div className="space-y-2">
						{assignments.map((assignment) => (
							<AssignmentRow
								key={assignment.id}
								icon={IconUsers}
								title={workPolicyAssignmentTargetLabel(assignment, t, "team")}
								subtitle={assignment.policy?.name || t("common.unknown", "Unknown")}
								action={
									canManageAssignments ? (
										<RemoveAssignmentButton
											assignment={assignment}
											kind="team"
											onDeleteClick={onDeleteClick}
										/>
									) : null
								}
							/>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

interface EmployeeAssignmentSectionProps {
	assignments: WorkPolicyAssignmentWithDetails[];
	canManageAssignments: boolean;
	onAssignClick: () => void;
	onDeleteClick: (assignment: WorkPolicyAssignmentWithDetails) => void;
}

export function EmployeeAssignmentSection({
	assignments,
	canManageAssignments,
	onAssignClick,
	onDeleteClick,
}: EmployeeAssignmentSectionProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div className="flex min-w-0 items-center gap-2">
						<IconUser className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
						<div className="min-w-0">
							<CardTitle className="text-base">
								{t("settings.workPolicies.employeeLevel", "Employee Overrides")}
								{assignments.length > 0 ? (
									<Badge variant="secondary" className="ml-2 tabular-nums">
										{assignments.length}
									</Badge>
								) : null}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.workPolicies.employeeLevelDescription",
									"Override policies for specific employees",
								)}
							</CardDescription>
						</div>
					</div>
					{canManageAssignments ? (
						<Button onClick={onAssignClick} size="sm" variant="outline">
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.workPolicies.addEmployee", "Add Employee")}
						</Button>
					) : null}
				</div>
			</CardHeader>
			<CardContent>
				{assignments.length === 0 ? (
					<p className="py-4 text-center text-sm text-muted-foreground">
						{t("settings.workPolicies.noEmployeeAssignments", "No employee-specific policies")}
					</p>
				) : (
					<div className="space-y-2">
						{assignments.map((assignment) => (
							<AssignmentRow
								key={assignment.id}
								icon={IconUser}
								title={workPolicyAssignmentTargetLabel(assignment, t, "employee")}
								subtitle={assignment.policy?.name || t("common.unknown", "Unknown")}
								action={
									canManageAssignments ? (
										<RemoveAssignmentButton
											assignment={assignment}
											kind="employee"
											onDeleteClick={onDeleteClick}
										/>
									) : null
								}
							/>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	);
}

export function WorkPolicyAssignmentSections({
	sections,
	onAssignClick,
	onDeleteClick,
}: WorkPolicyAssignmentSectionsProps) {
	return (
		<>
			{sections.organization ? (
				<OrganizationAssignmentSection
					assignment={sections.organization.assignment}
					canManageAssignments={sections.organization.canManage}
					onAssignClick={() => onAssignClick("organization")}
					onDeleteClick={onDeleteClick}
				/>
			) : null}
			{sections.team ? (
				<TeamAssignmentSection
					assignments={sections.team.assignments}
					canManageAssignments={sections.team.canManage}
					onAssignClick={() => onAssignClick("team")}
					onDeleteClick={onDeleteClick}
				/>
			) : null}
			{sections.employee ? (
				<EmployeeAssignmentSection
					assignments={sections.employee.assignments}
					canManageAssignments={sections.employee.canManage}
					onAssignClick={() => onAssignClick("employee")}
					onDeleteClick={onDeleteClick}
				/>
			) : null}
		</>
	);
}
