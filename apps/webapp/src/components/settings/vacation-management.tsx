"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import { VacationAssignmentDialog } from "./vacation-assignment-dialog";
import { VacationAssignmentManager } from "./vacation-assignment-manager";

interface VacationManagementProps {
	organizationId: string;
	children: React.ReactNode; // The existing policy content
}

export function VacationManagement({ organizationId, children }: VacationManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Assignment dialog state (employee assignments moved to Employee Allowances page)
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<"organization" | "team">("organization");

	// Assignment handlers
	const handleAssignClick = (type: "organization" | "team") => {
		setAssignmentType(type);
		setAssignmentDialogOpen(true);
	};

	const handleAssignmentSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
		});
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.vacation.title", "Vacation Management")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.vacation.description",
						"Manage vacation policies and assignments for your organization",
					)}
				</p>
			</div>

			<Tabs defaultValue="policies" className="space-y-4">
				<TabsList>
					<TabsTrigger value="policies">
						{t("settings.vacation.tab.policies", "Policies")}
					</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.vacation.tab.assignments", "Assignments")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="policies" className="space-y-4">
					{children}
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<VacationAssignmentManager
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>
			</Tabs>

			<VacationAssignmentDialog
				open={assignmentDialogOpen}
				onOpenChange={setAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={assignmentType}
				onSuccess={handleAssignmentSuccess}
			/>
		</div>
	);
}
