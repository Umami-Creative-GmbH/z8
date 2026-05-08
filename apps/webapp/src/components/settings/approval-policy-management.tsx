"use client";

import { IconPencil, IconPlus } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getApprovalPolicies,
	upsertApprovalPolicy,
} from "@/app/[locale]/(app)/settings/approval-policies/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { ApprovalPolicyDialog, type buildApprovalPolicyPayload } from "./approval-policy-dialog";
import { ApprovalPolicyPreview } from "./approval-policy-preview";
import { EmployeeGroupManagement } from "./employee-group-management";

export const approvalPolicyQueryKey = (organizationId: string) =>
	["approval-policies", organizationId] as const;

type ApprovalPolicyData = Awaited<ReturnType<typeof getApprovalPolicies>>[number];
type ApprovalPolicyPayload = ReturnType<typeof buildApprovalPolicyPayload>;

interface ApprovalPolicyManagementProps {
	organizationId: string;
}

function conditionsCount(policy: ApprovalPolicyData) {
	return policy.conditions.length;
}

function stagesCount(policy: ApprovalPolicyData) {
	return policy.stages.length;
}

export function ApprovalPolicyManagement({ organizationId }: ApprovalPolicyManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const policyQueryKey = approvalPolicyQueryKey(organizationId);
	const { data, isLoading, isError } = useQuery({
		queryKey: policyQueryKey,
		queryFn: getApprovalPolicies,
	});
	const mutation = useMutation({
		mutationFn: upsertApprovalPolicy,
		onSuccess: async (result) => {
			if (!result.success) {
				toast.error(
					result.error ||
						t("settings.approvalPolicies.toast.saveFailed", "Approval policy could not be saved."),
				);
				return;
			}

			toast.success(t("settings.approvalPolicies.toast.created", "Approval policy created"));
			await queryClient.invalidateQueries({ queryKey: policyQueryKey });
			setDialogOpen(false);
		},
		onError: () => {
			toast.error(
				t("settings.approvalPolicies.toast.saveFailed", "Approval policy could not be saved."),
			);
		},
	});
	const policies = data || [];

	async function handleSubmit(payload: ApprovalPolicyPayload) {
		await mutation.mutateAsync(payload);
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.approvalPolicies.title", "Approval Policies")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.approvalPolicies.description",
						"Configure sequential approval chains by team, location, category, amount, overtime risk, and employee group.",
					)}
				</p>
			</div>

			<ApprovalPolicyPreview />
			<EmployeeGroupManagement organizationId={organizationId} />

			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="space-y-1.5">
							<CardTitle>
								{t("settings.approvalPolicies.activePolicyTable", "Active Policy Table")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.approvalPolicies.activePolicyTableDescription",
									"Policies are evaluated by priority; the first matching active policy provides the approval chain.",
								)}
							</CardDescription>
						</div>
						<Button onClick={() => setDialogOpen(true)}>
							<IconPlus className="mr-2 h-4 w-4" aria-hidden="true" />
							{t("settings.approvalPolicies.addPolicy", "Add Policy")}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="py-6 text-sm text-muted-foreground">
							{t("settings.approvalPolicies.loading", "Loading policies…")}
						</div>
					) : isError ? (
						<div className="py-6 text-sm text-destructive" role="status">
							{t("settings.approvalPolicies.loadFailed", "Approval policies could not be loaded.")}
						</div>
					) : policies.length === 0 ? (
						<div className="py-6 text-sm text-muted-foreground">
							{t(
								"settings.approvalPolicies.empty",
								"No approval policies configured yet. Create a policy to define your first approval chain.",
							)}
						</div>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>{t("settings.approvalPolicies.priority", "Priority")}</TableHead>
									<TableHead className="min-w-0">{t("common.name", "Name")}</TableHead>
									<TableHead>
										{t("settings.approvalPolicies.activeStatus", "Active status")}
									</TableHead>
									<TableHead>
										{t("settings.approvalPolicies.conditionsCount", "Conditions count")}
									</TableHead>
									<TableHead>
										{t("settings.approvalPolicies.stagesCount", "Stages count")}
									</TableHead>
									<TableHead className="w-[80px]">{t("common.actions", "Actions")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{policies.map((policy) => (
									<TableRow key={policy.id}>
										<TableCell>{policy.priority}</TableCell>
										<TableCell className="min-w-0 max-w-[18rem] font-medium">
											<div className="truncate" title={policy.name}>
												{policy.name}
											</div>
										</TableCell>
										<TableCell>
											<Badge variant={policy.isActive ? "default" : "outline"}>
												{policy.isActive
													? t("settings.approvalPolicies.status.active", "Active")
													: t("settings.approvalPolicies.status.inactive", "Inactive")}
											</Badge>
										</TableCell>
										<TableCell>{conditionsCount(policy)}</TableCell>
										<TableCell>{stagesCount(policy)}</TableCell>
										<TableCell>
											<Button
												variant="ghost"
												size="icon"
												disabled
												aria-label={t("settings.approvalPolicies.editPolicy", "Edit policy")}
											>
												<IconPencil className="h-4 w-4" aria-hidden="true" />
											</Button>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<ApprovalPolicyDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				onSubmit={handleSubmit}
			/>
		</div>
	);
}
