"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { ChangePolicyRecord } from "@/app/[locale]/(app)/settings/change-policies/actions";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";
import { ChangePolicyAssignmentDialog } from "./change-policy-assignment-dialog";
import { ChangePolicyAssignmentManager } from "./change-policy-assignment-manager";
import { ChangePolicyDialog } from "./change-policy-dialog";
import { ChangePolicyTable } from "./change-policy-table";

interface ChangePolicyManagementProps {
	organizationId: string;
	canManage: boolean;
}

export function ChangePolicyManagement({ organizationId, canManage }: ChangePolicyManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Policy dialog state
	const [policyDialogOpen, setPolicyDialogOpen] = useState(false);
	const [editingPolicy, setEditingPolicy] = useState<ChangePolicyRecord | null>(null);

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

	const handleEditPolicy = (policy: ChangePolicyRecord) => {
		setEditingPolicy(policy);
		setPolicyDialogOpen(true);
	};

	const handlePolicySuccess = () => {
		queryClient.invalidateQueries({
			queryKey: queryKeys.changePolicies.list(organizationId),
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
			queryKey: queryKeys.changePolicies.assignments(organizationId),
		});
	};

	return (
		<div className="flex flex-col gap-4">
			<Tabs defaultValue="policies" className="space-y-4">
				<TabsList>
					<TabsTrigger value="policies">
						{t("settings.changePolicies.tab.policies", "Policies")}
					</TabsTrigger>
					<TabsTrigger value="assignments">
						{t("settings.changePolicies.tab.assignments", "Assignments")}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="policies" className="space-y-4">
					<ChangePolicyTable
						canManage={canManage}
						organizationId={organizationId}
						onCreateClick={handleCreatePolicy}
						onEditClick={handleEditPolicy}
					/>
				</TabsContent>

				<TabsContent value="assignments" className="space-y-4">
					<ChangePolicyAssignmentManager
						canManage={canManage}
						organizationId={organizationId}
						onAssignClick={handleAssignClick}
					/>
				</TabsContent>
			</Tabs>

			{canManage ? (
				<>
					<ChangePolicyDialog
						open={policyDialogOpen}
						onOpenChange={setPolicyDialogOpen}
						organizationId={organizationId}
						editingPolicy={editingPolicy}
						onSuccess={handlePolicySuccess}
					/>

					<ChangePolicyAssignmentDialog
						open={assignmentDialogOpen}
						onOpenChange={setAssignmentDialogOpen}
						organizationId={organizationId}
						assignmentType={assignmentType}
						onSuccess={handleAssignmentSuccess}
					/>
				</>
			) : null}
		</div>
	);
}
