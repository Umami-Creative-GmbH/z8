"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query/keys";
import { AbsenceCategoriesTable } from "../absence-category/absence-categories-table";
import {
	VacationAssignmentDialog,
	type VacationAssignmentType,
} from "./vacation-assignment-dialog";
import { VacationAssignmentManager } from "./vacation-assignment-manager";

interface VacationManagementProps {
	organizationId: string;
	allowedAssignmentTypes: readonly ("team" | "employee")[];
	canManageCategories: boolean;
	children: React.ReactNode; // The existing policy content
	/** Organization-wide absence settings, above the categories (#982). */
	absenceSettings?: React.ReactNode;
	/** A notice for owners and admins above the tabs, such as the proration notice (#1112). */
	notice?: React.ReactNode;
}

export function VacationManagement({
	organizationId,
	allowedAssignmentTypes,
	canManageCategories,
	children,
	absenceSettings,
	notice,
}: VacationManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Assignment dialog state
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentTargetId, setAssignmentTargetId] = useState<string>();
	const [assignmentType, setAssignmentType] =
		useState<VacationAssignmentType>("team");

	// Assignment handlers
	const handleAssignClick = (
		type: VacationAssignmentType,
		targetId?: string,
	) => {
		if (
			type === "organization"
				? !allowedAssignmentTypes.includes("team")
				: !allowedAssignmentTypes.includes(type)
		) {
			return;
		}

		setAssignmentType(type);
		setAssignmentTargetId(targetId);
		setAssignmentDialogOpen(true);
	};

	const handleAssignmentSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
		});
	};

	return (
		<div className="flex flex-col gap-4">
			{notice}

			<Tabs defaultValue="policies" className="space-y-4">
				<TabsList>
					<TabsTrigger value="policies">
						{t("settings.vacation.tab.policies", "Policies")}
					</TabsTrigger>
					<TabsTrigger value="categories">
						{t("settings.vacation.tab.categories", "Categories")}
					</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.vacation.tab.assignments", "Assignments")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="policies" className="space-y-4">
					{children}
				</TabsContent>

				<TabsContent value="categories" className="space-y-4">
					{absenceSettings}
					<AbsenceCategoriesTable
						organizationId={organizationId}
						canManageCategories={canManageCategories}
					/>
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<VacationAssignmentManager
						organizationId={organizationId}
						allowedAssignmentTypes={allowedAssignmentTypes}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>
			</Tabs>

			<VacationAssignmentDialog
				key={`${assignmentType}:${assignmentTargetId ?? "new"}:${assignmentDialogOpen}`}
				initialTargetId={assignmentTargetId}
				open={assignmentDialogOpen}
				onOpenChange={setAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={assignmentType}
				onSuccess={handleAssignmentSuccess}
			/>
		</div>
	);
}
