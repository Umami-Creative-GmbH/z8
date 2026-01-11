"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { TimeRegulationWithBreakRules } from "@/app/[locale]/(app)/settings/time-regulations/actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import { TimeRegulationAssignmentDialog } from "./time-regulation-assignment-dialog";
import { TimeRegulationAssignmentManager } from "./time-regulation-assignment-manager";
import { TimeRegulationComplianceView } from "./time-regulation-compliance-view";
import { TimeRegulationDialog } from "./time-regulation-dialog";
import { TimeRegulationPresetImport } from "./time-regulation-preset-import";
import { TimeRegulationTemplatesTable } from "./time-regulation-templates-table";

interface TimeRegulationManagementProps {
	organizationId: string;
}

export function TimeRegulationManagement({ organizationId }: TimeRegulationManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Regulation dialog state
	const [regulationDialogOpen, setRegulationDialogOpen] = useState(false);
	const [editingRegulation, setEditingRegulation] = useState<TimeRegulationWithBreakRules | null>(
		null,
	);

	// Assignment dialog state
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<"organization" | "team" | "employee">(
		"organization",
	);

	// Regulation handlers
	const handleCreateRegulation = () => {
		setEditingRegulation(null);
		setRegulationDialogOpen(true);
	};

	const handleEditRegulation = (regulation: TimeRegulationWithBreakRules) => {
		setEditingRegulation(regulation);
		setRegulationDialogOpen(true);
	};

	const handleRegulationSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.timeRegulations.list(organizationId),
		});
		setRegulationDialogOpen(false);
		setEditingRegulation(null);
	};

	// Assignment handlers
	const handleAssignClick = (type: "organization" | "team" | "employee") => {
		setAssignmentType(type);
		setAssignmentDialogOpen(true);
	};

	const handleAssignmentSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.timeRegulations.assignments(organizationId),
		});
	};

	const handlePresetImportSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.timeRegulations.list(organizationId),
		});
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.timeRegulations.title", "Time Regulations")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.timeRegulations.description",
						"Manage working time limits and break requirements for your organization",
					)}
				</p>
			</div>

			<Tabs defaultValue="regulations" className="space-y-4">
				<TabsList>
					<TabsTrigger value="regulations">
						{t("settings.timeRegulations.tab.regulations", "Regulations")}
					</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.timeRegulations.tab.assignments", "Assignments")}
					</TabsTrigger>
					<TabsTrigger value="presets">
						{t("settings.timeRegulations.tab.presets", "Import Presets")}
					</TabsTrigger>
					<TabsTrigger value="compliance">
						{t("settings.timeRegulations.tab.compliance", "Compliance")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="regulations" className="space-y-4">
					<TimeRegulationTemplatesTable
						organizationId={organizationId}
						onCreateClick={handleCreateRegulation}
						onEditClick={handleEditRegulation}
					/>
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<TimeRegulationAssignmentManager
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>

				<TabsContent value="presets" className="space-y-4">
					<TimeRegulationPresetImport
						organizationId={organizationId}
						onImportSuccess={handlePresetImportSuccess}
					/>
				</TabsContent>

				<TabsContent value="compliance" className="space-y-4">
					<TimeRegulationComplianceView organizationId={organizationId} />
				</TabsContent>
			</Tabs>

			<TimeRegulationDialog
				open={regulationDialogOpen}
				onOpenChange={setRegulationDialogOpen}
				organizationId={organizationId}
				editingRegulation={editingRegulation}
				onSuccess={handleRegulationSuccess}
			/>

			<TimeRegulationAssignmentDialog
				open={assignmentDialogOpen}
				onOpenChange={setAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={assignmentType}
				onSuccess={handleAssignmentSuccess}
			/>
		</div>
	);
}
