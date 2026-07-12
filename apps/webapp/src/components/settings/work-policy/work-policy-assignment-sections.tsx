import {
	IconBuilding,
	IconFileText,
	IconPlus,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { WorkPolicyAssignmentWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";

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

function formatAssignmentEmployeeName(
	employeeRecord: { firstName?: string | null; lastName?: string | null } | null | undefined,
	fallback: string,
) {
	return employeeRecord ? buildAuthUserDisplayName(employeeRecord) || fallback : fallback;
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
			<CardHeader>
				<div className="flex items-center gap-2">
					<IconBuilding className="size-5 text-muted-foreground" />
					<div>
						<CardTitle className="text-base">
							{t("settings.workPolicies.orgLevel", "Organization Default")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.workPolicies.orgLevelDescription",
								"Default work policy applied to all employees unless overridden",
							)}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{assignment ? (
					<div className="flex items-center justify-between rounded-lg border bg-muted/30 p-3">
						<div className="flex items-center gap-3">
							<IconFileText className="size-5 text-muted-foreground" />
							<p className="font-medium">
								{assignment.policy?.name || t("common.unknown", "Unknown")}
							</p>
						</div>
						{canManageAssignments ? (
							<Button
								variant="ghost"
								size="icon"
								aria-label={t("settings.workPolicies.removeAssignment", "Remove Assignment")}
								className="text-destructive hover:text-destructive"
								onClick={() => onDeleteClick(assignment)}
							>
								<IconTrash className="size-4" />
							</Button>
						) : null}
					</div>
				) : (
					<div className="flex items-center justify-between rounded-lg border border-dashed p-3">
						<p className="text-sm text-muted-foreground">
							{t("settings.workPolicies.noOrgAssignment", "No organization default set")}
						</p>
						{canManageAssignments ? (
							<Button onClick={onAssignClick} size="sm" variant="outline">
								<IconPlus className="mr-2 size-4" />
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
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<IconUsers className="size-5 text-muted-foreground" />
						<div>
							<CardTitle className="text-base">
								{t("settings.workPolicies.teamLevel", "Team Overrides")}
								{assignments.length > 0 ? (
									<Badge variant="secondary" className="ml-2">
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
							<IconPlus className="mr-2 size-4" />
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
							<div
								key={assignment.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex items-center gap-3">
									<IconUsers className="size-4 text-muted-foreground" />
									<div>
										<p className="font-medium">
											{assignment.team?.name || t("common.unknownTeam", "Unknown Team")}
										</p>
										<p className="text-xs text-muted-foreground">
											{assignment.policy?.name || t("common.unknown", "Unknown")}
										</p>
									</div>
								</div>
								{canManageAssignments ? (
									<Button
										variant="ghost"
										size="icon"
										aria-label={t("settings.workPolicies.removeAssignment", "Remove Assignment")}
										className="text-destructive hover:text-destructive"
										onClick={() => onDeleteClick(assignment)}
									>
										<IconTrash className="size-4" />
									</Button>
								) : null}
							</div>
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
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<IconUser className="size-5 text-muted-foreground" />
						<div>
							<CardTitle className="text-base">
								{t("settings.workPolicies.employeeLevel", "Employee Overrides")}
								{assignments.length > 0 ? (
									<Badge variant="secondary" className="ml-2">
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
							<IconPlus className="mr-2 size-4" />
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
							<div
								key={assignment.id}
								className="flex items-center justify-between rounded-lg border p-3"
							>
								<div className="flex items-center gap-3">
									<IconUser className="size-4 text-muted-foreground" />
									<div>
										<p className="font-medium">
											{formatAssignmentEmployeeName(
												assignment.employee,
												t("common.unknownEmployee", "Unknown Employee"),
											)}
										</p>
										<p className="text-xs text-muted-foreground">
											{assignment.policy?.name || t("common.unknown", "Unknown")}
										</p>
									</div>
								</div>
								{canManageAssignments ? (
									<Button
										variant="ghost"
										size="icon"
										aria-label={t("settings.workPolicies.removeAssignment", "Remove Assignment")}
										className="text-destructive hover:text-destructive"
										onClick={() => onDeleteClick(assignment)}
									>
										<IconTrash className="size-4" />
									</Button>
								) : null}
							</div>
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
