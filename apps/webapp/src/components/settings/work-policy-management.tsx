"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { WorkPolicyWithDetails } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import { WorkPolicyAssignmentDialog } from "./work-policy-assignment-dialog";
import { WorkPolicyAssignmentManager } from "./work-policy-assignment-manager";
import { WorkPolicyComplianceView } from "./work-policy-compliance-view";
import { WorkPolicyDialog } from "./work-policy-dialog";
import { WorkPolicyPresetImport } from "./work-policy-preset-import";
import { WorkPolicyTable } from "./work-policy-table";

interface WorkPolicyManagementProps {
	organizationId: string;
}

export function WorkPolicyManagement({ organizationId }: WorkPolicyManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Policy dialog state
	const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
	const [editingPolicy, setEditingPolicy] = useState<WorkPolicyWithDetails | null>(null);

	// Assignment dialog state
	const [assignmentDialogOpen, setAssignmentDialogOpen] = useState(false);
	const [assignmentType, setAssignmentType] = useState<"organization" | "team" | "employee">(
		"organization",
	);

	// Policy handlers
	const handleCreatePolicy = () => {
		setEditingPolicy(null);
		setPolicyDialogOpen(true);
	};

	const handleEditPolicy = (policy: WorkPolicyWithDetails) => {
		setEditingPolicy(policy);
		setPolicyDialogOpen(true);
	};

	const handlePolicySuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.workPolicies.list(organizationId),
		});
		setPolicyDialogOpen(false);
		setEditingPolicy(null);
	};

	// Assignment handlers
	const handleAssignClick = (type: "organization" | "team" | "employee") => {
		setAssignmentType(type);
		setAssignmentDialogOpen(true);
	};

	const handleAssignmentSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.workPolicies.assignments(organizationId),
		});
	};

	const handlePresetImportSuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.workPolicies.list(organizationId),
		});
	};

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.workPolicies.title", "Work Policies")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.workPolicies.description",
						"Manage work schedules, time limits, and break requirements for your organization",
					)}
				</p>
			</div>

			<Tabs defaultValue="policies" className="space-y-4">
				<TabsList>
					<TabsTrigger value="policies">
						{t("settings.workPolicies.tab.policies", "Policies")}
					</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.workPolicies.tab.assignments", "Assignments")}
					</TabsTrigger>
					<TabsTrigger value="presets">
						{t("settings.workPolicies.tab.presets", "Import Presets")}
					</TabsTrigger>
					<TabsTrigger value="compliance">
						{t("settings.workPolicies.tab.compliance", "Compliance")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="policies" className="space-y-4">
					<WorkPolicyTable
						organizationId={organizationId}
						onCreateClick={handleCreatePolicy}
						onEditClick={handleEditPolicy}
					/>
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<WorkPolicyAssignmentManager
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>

				<TabsContent value="presets" className="space-y-4">
					<WorkPolicyPresetImport
						organizationId={organizationId}
						onImportSuccess={handlePresetImportSuccess}
					/>
				</TabsContent>

				<TabsContent value="compliance" className="space-y-4">
					<WorkPolicyComplianceView organizationId={organizationId} />
				</TabsContent>
			</Tabs>

			<WorkPolicyDialog
				open={policyDialogOpen}
				onOpenChange={setPolicyDialogOpen}
				organizationId={organizationId}
				editingPolicy={editingPolicy}
				onSuccess={handlePolicySuccess}
			/>

			<WorkPolicyAssignmentDialog
				open={assignmentDialogOpen}
				onOpenChange={setAssignmentDialogOpen}
				organizationId={organizationId}
				assignmentType={assignmentType}
				onSuccess={handleAssignmentSuccess}
			/>
		</div>
	);
}
