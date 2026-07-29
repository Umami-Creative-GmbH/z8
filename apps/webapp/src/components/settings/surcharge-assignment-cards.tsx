"use client";

import { IconPlus, IconTrash, IconUser, IconUsers } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

export interface SurchargeAssignmentData {
	id: string;
	modelId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	model: { id: string; name: string };
	team: { id: string; name: string } | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
}

interface AssignmentCardProps {
	assignments: SurchargeAssignmentData[];
	canManage: boolean;
	onAssign: () => void;
	onDelete: (assignment: SurchargeAssignmentData) => void;
}

export function SurchargeTeamAssignmentsCard({
	assignments,
	canManage,
	onAssign,
	onDelete,
}: AssignmentCardProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<IconUsers className="size-5 text-muted-foreground" />
					<div>
						<CardTitle className="text-base">
							{t("settings.surcharges.teamLevel", "Team Level")}
							{assignments.length > 0 && (
								<Badge variant="secondary" className="ml-2">
									{assignments.length}
								</Badge>
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.surcharges.teamLevelDescription",
								"Override organization defaults for specific teams",
							)}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{canManage ? (
					<div className="flex justify-end mb-2">
						<Button onClick={onAssign} size="sm" variant="outline">
							<IconPlus className="mr-2 size-4" />
							{t("settings.surcharges.assignTeam", "Assign to Team")}
						</Button>
					</div>
				) : null}
				{assignments.length > 0 ? (
					<div className="space-y-2">
						{assignments.map((assignment) => (
							<div
								key={assignment.id}
								className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
							>
								<div className="flex items-center gap-3">
									<IconUsers className="size-4 text-muted-foreground" />
									<div>
										<span className="font-medium">{assignment.team?.name}</span>
										<span className="text-muted-foreground mx-2">→</span>
										<span className="text-sm">{assignment.model.name}</span>
									</div>
								</div>
								{canManage ? (
									<Button
										aria-label={t(
											"settings.surcharges.removeTeamAssignment",
											"Remove team assignment",
										)}
										variant="ghost"
										size="icon"
										className="size-8 text-muted-foreground hover:text-destructive"
										onClick={() => onDelete(assignment)}
									>
										<IconTrash className="size-4" />
									</Button>
								) : null}
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground text-center py-4">
						{t(
							"settings.surcharges.noTeamAssignments",
							"No team-level assignments",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

export function SurchargeEmployeeAssignmentsCard({
	assignments,
	canManage,
	onAssign,
	onDelete,
}: AssignmentCardProps) {
	const { t } = useTranslate();

	return (
		<Card>
			<CardHeader>
				<div className="flex items-center gap-2">
					<IconUser className="size-5 text-muted-foreground" />
					<div>
						<CardTitle className="text-base">
							{t("settings.surcharges.employeeLevel", "Employee Overrides")}
							{assignments.length > 0 && (
								<Badge variant="secondary" className="ml-2">
									{assignments.length}
								</Badge>
							)}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.surcharges.employeeLevelDescription",
								"Override team or organization defaults for specific employees",
							)}
						</CardDescription>
					</div>
				</div>
			</CardHeader>
			<CardContent>
				{canManage ? (
					<div className="flex justify-end mb-2">
						<Button onClick={onAssign} size="sm" variant="outline">
							<IconPlus className="mr-2 size-4" />
							{t("settings.surcharges.assignEmployee", "Assign to Employee")}
						</Button>
					</div>
				) : null}
				{assignments.length > 0 ? (
					<div className="space-y-2">
						{assignments.map((assignment) => (
							<div
								key={assignment.id}
								className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
							>
								<div className="flex items-center gap-3">
									<IconUser className="size-4 text-muted-foreground" />
									<div>
										<span className="font-medium">
											{assignment.employee?.firstName}{" "}
											{assignment.employee?.lastName}
										</span>
										<span className="text-muted-foreground mx-2">→</span>
										<span className="text-sm">{assignment.model.name}</span>
									</div>
								</div>
								{canManage ? (
									<Button
										aria-label={t(
											"settings.surcharges.removeEmployeeAssignment",
											"Remove employee assignment",
										)}
										variant="ghost"
										size="icon"
										className="size-8 text-muted-foreground hover:text-destructive"
										onClick={() => onDelete(assignment)}
									>
										<IconTrash className="size-4" />
									</Button>
								) : null}
							</div>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground text-center py-4">
						{t(
							"settings.surcharges.noEmployeeAssignments",
							"No employee-level overrides",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
