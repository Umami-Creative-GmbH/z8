"use client";

import {
	IconLoader2,
	IconPencil,
	IconPlayerPause,
	IconPlus,
	IconRefresh,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	getApprovalPolicies,
	upsertApprovalPolicy,
} from "@/app/[locale]/(app)/settings/approval-policies/actions";
import {
	ConfirmActionDialog,
	describeFailure,
	useConfirmedAction,
} from "@/components/settings/confirm-action-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { actionErrorMessage } from "@/lib/organization-action/action-error-message";
import {
	ApprovalPolicyDialog,
	type ApprovalPolicySubmitPayload,
} from "./approval-policy-dialog";
import {
	type ApprovalPolicyEditState,
	approvalPolicyToEditState,
	buildApprovalPolicyPayload,
} from "./approval-policy-dialog-utils";

const approvalPolicyQueryKey = (organizationId: string) =>
	["approval-policies", organizationId] as const;

type ApprovalPolicyData = Extract<
	Awaited<ReturnType<typeof getApprovalPolicies>>,
	{ success: true }
>["data"][number];

interface ApprovalPolicyManagementProps {
	organizationId: string;
}

/** The stored policy with only its active state changed, everything else kept. */
function activeStatePayload(
	policy: ApprovalPolicyData,
	isActive: boolean,
): ApprovalPolicySubmitPayload {
	const state = approvalPolicyToEditState(policy);
	return {
		...buildApprovalPolicyPayload(
			{ ...state.values, isActive },
			undefined,
			{
				preservedConditions: state.preservedConditions,
				legacyApprovalTypes: state.legacyApprovalTypes,
			},
		),
		id: policy.id,
	};
}

export function ApprovalPolicyManagement({
	organizationId,
}: ApprovalPolicyManagementProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [editing, setEditing] = useState<ApprovalPolicyEditState | null>(null);
	const policyQueryKey = approvalPolicyQueryKey(organizationId);
	const { data, isLoading, isError, isRefetching, refetch } = useQuery({
		queryKey: policyQueryKey,
		queryFn: async () => {
			const result = await getApprovalPolicies();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	const saveFailedMessage = () =>
		t(
			"settings.approvalPolicies.toast.saveFailed",
			"Approval policy could not be saved.",
		);
	const mutation = useMutation({
		mutationFn: upsertApprovalPolicy,
		onSuccess: async (result, payload) => {
			if (!result.success) {
				toast.error(
					actionErrorMessage(t, result, {}, [
						"settings.approvalPolicies.toast.saveFailed",
						"Approval policy could not be saved.",
					]),
				);
				return;
			}

			toast.success(
				payload.id
					? t("settings.approvalPolicies.toast.updated", "Approval policy saved")
					: t("settings.approvalPolicies.toast.created", "Approval policy created"),
			);
			await queryClient.invalidateQueries({ queryKey: policyQueryKey });
			setDialogOpen(false);
		},
		onError: () => {
			toast.error(saveFailedMessage());
		},
	});
	const activeStateMutation = useMutation({
		mutationFn: ({
			policy,
			isActive,
		}: {
			policy: ApprovalPolicyData;
			isActive: boolean;
		}) => upsertApprovalPolicy(activeStatePayload(policy, isActive)),
		onSuccess: async (result, { policy, isActive }) => {
			if (!result.success) {
				// A refused deactivation is shown inside its confirmation dialog instead.
				if (isActive) {
					toast.error(
						actionErrorMessage(t, result, {}, [
							"settings.approvalPolicies.toast.saveFailed",
							"Approval policy could not be saved.",
						]),
					);
				}
				return;
			}
			await queryClient.invalidateQueries({ queryKey: policyQueryKey });
			if (isActive) {
				toast.success(
					t(
						"settings.approvalPolicies.toast.reactivated",
						"“{name}” is active again",
						{ name: policy.name },
					),
				);
				return;
			}
			toast.success(
				t("settings.approvalPolicies.toast.deactivated", "“{name}” deactivated", {
					name: policy.name,
				}),
				{
					action: {
						label: t("common.undo", "Undo"),
						onClick: () => reactivate(policy),
					},
				},
			);
		},
		onError: (_error, { isActive }) => {
			if (isActive) toast.error(saveFailedMessage());
		},
	});
	// Deactivating stays open until it settles and keeps a refusal visible inline.
	const deactivation = useConfirmedAction<ApprovalPolicyData>();
	const confirmDeactivation = () =>
		void deactivation.confirm(
			async (policy) => {
				const result = await activeStateMutation.mutateAsync({ policy, isActive: false });
				if (!result.success) {
					throw new Error(
						actionErrorMessage(t, result, {}, [
							"settings.approvalPolicies.toast.saveFailed",
							"Approval policy could not be saved.",
						]),
					);
				}
			},
			(failure) => describeFailure(failure, saveFailedMessage()),
		);
	const policies = data || [];

	function reactivate(policy: ApprovalPolicyData): void {
		activeStateMutation.mutate({ policy, isActive: true });
	}

	function openCreate() {
		setEditing(null);
		setDialogOpen(true);
	}

	function openEdit(policy: ApprovalPolicyData) {
		setEditing(approvalPolicyToEditState(policy));
		setDialogOpen(true);
	}

	async function handleSubmit(payload: ApprovalPolicySubmitPayload) {
		await mutation.mutateAsync(payload);
	}

	return (
		<div className="flex flex-col gap-4">
			<Card>
				<CardHeader>
					<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div className="min-w-0 space-y-1.5">
							<CardTitle>
								{t(
									"settings.approvalPolicies.activePolicyTable",
									"Active Policy Table",
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.approvalPolicies.activePolicyTableDescription",
									"Policies are evaluated by priority; the first matching active policy provides the approval chain.",
								)}
							</CardDescription>
						</div>
						<Button className="shrink-0" onClick={openCreate}>
							<IconPlus className="mr-2 size-4" aria-hidden="true" />
							{t("settings.approvalPolicies.addPolicy", "Add Policy")}
						</Button>
					</div>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div
							className="py-6 text-sm text-muted-foreground"
							role="status"
						>
							{t("settings.approvalPolicies.loading", "Loading policies…")}
						</div>
					) : isError ? (
						<div className="flex flex-wrap items-center gap-3 py-6">
							<p className="text-sm text-destructive" role="alert">
								{t(
									"settings.approvalPolicies.loadFailed",
									"Approval policies could not be loaded.",
								)}
							</p>
							<Button
								variant="outline"
								size="sm"
								onClick={() => refetch()}
								disabled={isRefetching}
							>
								{isRefetching ? (
									<IconLoader2
										className="mr-2 size-4 motion-safe:animate-spin"
										aria-hidden="true"
									/>
								) : (
									<IconRefresh className="mr-2 size-4" aria-hidden="true" />
								)}
								{t("common.retry", "Retry")}
							</Button>
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
									<TableHead>
										{t("settings.approvalPolicies.priority", "Priority")}
									</TableHead>
									<TableHead className="min-w-0">
										{t("common.name", "Name")}
									</TableHead>
									<TableHead>
										{t(
											"settings.approvalPolicies.activeStatus",
											"Active status",
										)}
									</TableHead>
									<TableHead>
										{t(
											"settings.approvalPolicies.conditionsCount",
											"Conditions count",
										)}
									</TableHead>
									<TableHead>
										{t("settings.approvalPolicies.stagesCount", "Stages count")}
									</TableHead>
									<TableHead className="w-[96px]">
										{t("common.actions", "Actions")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{policies.map((policy) => {
									const changingActiveState =
										activeStateMutation.isPending &&
										activeStateMutation.variables?.policy.id === policy.id;
									return (
										<TableRow key={policy.id}>
											<TableCell className="tabular-nums">
												{policy.priority}
											</TableCell>
											<TableCell className="min-w-0 max-w-[18rem] font-medium">
												<div className="truncate" title={policy.name}>
													{policy.name}
												</div>
											</TableCell>
											<TableCell>
												<Badge variant={policy.isActive ? "default" : "outline"}>
													{policy.isActive
														? t(
																"settings.approvalPolicies.status.active",
																"Active",
															)
														: t(
																"settings.approvalPolicies.status.inactive",
																"Inactive",
															)}
												</Badge>
											</TableCell>
											<TableCell className="tabular-nums">
												{policy.conditions.length}
											</TableCell>
											<TableCell className="tabular-nums">
												{policy.stages.length}
											</TableCell>
											<TableCell>
												<div className="flex items-center gap-1">
													<Button
														variant="ghost"
														size="icon"
														onClick={() => openEdit(policy)}
														aria-label={t(
															"settings.approvalPolicies.editPolicyNamed",
															"Edit {name}",
															{ name: policy.name },
														)}
													>
														<IconPencil className="size-4" aria-hidden="true" />
													</Button>
													{policy.isActive ? (
														<Button
															variant="ghost"
															size="icon"
															onClick={() => deactivation.request(policy)}
															disabled={changingActiveState}
															aria-label={t(
																"settings.approvalPolicies.deactivatePolicyNamed",
																"Deactivate {name}",
																{ name: policy.name },
															)}
														>
															{changingActiveState ? (
																<IconLoader2
																	className="size-4 motion-safe:animate-spin"
																	aria-hidden="true"
																/>
															) : (
																<IconPlayerPause
																	className="size-4"
																	aria-hidden="true"
																/>
															)}
														</Button>
													) : null}
												</div>
											</TableCell>
										</TableRow>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>

			<ApprovalPolicyDialog
				open={dialogOpen}
				onOpenChange={setDialogOpen}
				policy={editing}
				onSubmit={handleSubmit}
			/>

			<ConfirmActionDialog
				open={deactivation.open}
				onOpenChange={deactivation.onOpenChange}
				variant="default"
				title={t("settings.approvalPolicies.deactivateConfirm.title", "Deactivate “{name}”?", {
					name: deactivation.target?.name ?? "",
				})}
				description={t(
					"settings.approvalPolicies.deactivateConfirm.description",
					"New requests stop matching this policy and are routed by the next matching active policy or the default approval route. You can activate it again by editing it.",
				)}
				confirmLabel={t("settings.approvalPolicies.deactivateConfirm.confirm", "Deactivate")}
				isPending={deactivation.isPending}
				error={deactivation.error}
				onConfirm={confirmDeactivation}
			/>
		</div>
	);
}
