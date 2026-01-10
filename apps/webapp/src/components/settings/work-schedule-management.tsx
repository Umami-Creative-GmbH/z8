"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { WorkScheduleTemplateWithDays } from "@/app/[locale]/(app)/settings/work-schedules/actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import { WorkScheduleAssignmentDialog } from "./work-schedule-assignment-dialog";
import { WorkScheduleAssignmentManager } from "./work-schedule-assignment-manager";
import { WorkScheduleTemplateDialog } from "./work-schedule-template-dialog";
import { WorkScheduleTemplatesTable } from "./work-schedule-templates-table";

interface WorkScheduleManagementProps {
	organizationId: string;
}

export function WorkScheduleManagement({ organizationId }: WorkScheduleManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Template dialog state
	const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
	const [editingTemplate, setEditingTemplate] = useState<WorkScheduleTemplateWithDays | null>(null);

	// Assignment dialog state
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<"organization" | "team" | "employee">(
		"organization",
	);

	// Template handlers
	const handleCreateTemplate = () => {
		setEditingTemplate(null);
		setTemplateDialogOpen(true);
	};

	const handleEditTemplate = (template: WorkScheduleTemplateWithDays) => {
		setEditingTemplate(template);
		setTemplateDialogOpen(true);
	};

	const handleTemplateSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.workScheduleTemplates.list(organizationId),
		});
		setTemplateDialogOpen(false);
		setEditingTemplate(null);
	};

	// Assignment handlers
	const handleAssignClick = (type: "organization" | "team" | "employee") => {
		setAssignmentType(type);
		setAssignmentDialogOpen(true);
	};

	const handleAssignmentSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.workScheduleAssignments.list(organizationId),
		});
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.workSchedules.title", "Work Schedules")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.workSchedules.description",
						"Manage work schedule templates and assignments for your organization",
					)}
				</p>
			</div>

			<Tabs defaultValue="templates" className="space-y-4">
				<TabsList>
					<TabsTrigger value="templates">
						{t("settings.workSchedules.tab.templates", "Templates")}
					</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.workSchedules.tab.assignments", "Assignments")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="templates" className="space-y-4">
					<WorkScheduleTemplatesTable
						organizationId={organizationId}
						onCreateClick={handleCreateTemplate}
						onEditClick={handleEditTemplate}
					/>
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<WorkScheduleAssignmentManager
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>
			</Tabs>

			<WorkScheduleTemplateDialog
				open={templateDialogOpen}
				onOpenChange={setTemplateDialogOpen}
				organizationId={organizationId}
				editingTemplate={editingTemplate}
				onSuccess={handleTemplateSuccess}
			/>

			<WorkScheduleAssignmentDialog
				open={assignmentDialogOpen}
				onOpenChange={setAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={assignmentType}
				onSuccess={handleAssignmentSuccess}
			/>
		</div>
	);
}
