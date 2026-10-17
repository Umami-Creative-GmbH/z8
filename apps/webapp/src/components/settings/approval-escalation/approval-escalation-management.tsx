"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	disposeApprovalEscalationAttention,
	getApprovalEscalationOverview,
	recheckApprovalEscalationAttention,
	retryApprovalEscalationDelivery,
	reviewApprovalEscalationPolicyConflicts,
	transferApprovalEscalationAssignment,
	updateApprovalEscalationPolicy,
} from "@/app/[locale]/(app)/settings/approval-escalation/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
	EscalationAttentionCard,
	type EscalationTransferRequest,
} from "./escalation-attention-section";
import {
	EscalationChannelsCard,
	EscalationMigrationCard,
	EscalationOwnershipNotice,
	EscalationPolicyCard,
	type EscalationPolicyFormValues,
	EscalationRevisionsCard,
} from "./escalation-policy-section";

const approvalEscalationQueryKey = (organizationId: string) =>
	["approval-escalation", organizationId] as const;

export function ApprovalEscalationManagement({
	organizationId,
	section,
}: {
	organizationId: string;
	section: "escalation" | "attention" | "channels" | "history";
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const queryKey = approvalEscalationQueryKey(organizationId);
	const { data, isLoading } = useQuery({
		queryKey,
		queryFn: getApprovalEscalationOverview,
	});
	const invalidate = () => queryClient.invalidateQueries({ queryKey });
	const requestFailed = () =>
		t(
			"settings.approvalEscalation.toast.requestFailed",
			"The request failed. Try again.",
		);
	const overview = data?.success ? data.data : null;

	const policyMutation = useMutation({
		mutationFn: updateApprovalEscalationPolicy,
		onSettled: () => invalidate(),
	});
	const reviewMutation = useMutation({
		mutationFn: reviewApprovalEscalationPolicyConflicts,
		onSuccess: async (result) => {
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(
				t(
					"settings.approvalEscalation.toast.reviewed",
					"Conflicts marked as reviewed",
				),
			);
			await invalidate();
		},
		onError: () => toast.error(requestFailed()),
	});
	const disposeMutation = useMutation({
		mutationFn: disposeApprovalEscalationAttention,
		onSettled: () => invalidate(),
	});
	const transferMutation = useMutation({
		mutationFn: transferApprovalEscalationAssignment,
		onSettled: () => invalidate(),
	});
	const recheckMutation = useMutation({
		mutationFn: recheckApprovalEscalationAttention,
		onSuccess: async (result) => {
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			toast.success(
				t(
					"settings.approvalEscalation.toast.rechecked",
					"Checked {checked} items, {resolved} resolved",
					{ checked: result.data.checked, resolved: result.data.resolved },
				),
			);
			await invalidate();
		},
		onError: () => toast.error(requestFailed()),
	});

	async function handlePolicySubmit(
		values: EscalationPolicyFormValues,
	): Promise<boolean> {
		if (!overview) return false;
		const result = await policyMutation
			.mutateAsync({
				expectedRevision: overview.policy.revision,
				enabled: values.enabled,
				responseWindowHours: values.responseWindowHours,
				reason: values.reason,
			})
			.catch(() => ({ success: false as const, error: requestFailed() }));
		if (!result.success) {
			toast.error(result.error);
			return false;
		}
		toast.success(
			result.data.changed
				? t(
						"settings.approvalEscalation.toast.saved",
						"Escalation policy saved",
					)
				: t(
						"settings.approvalEscalation.toast.unchanged",
						"No changes to save",
					),
		);
		return true;
	}

	async function handleTransfer(
		request: EscalationTransferRequest,
	): Promise<boolean> {
		const result = await transferMutation
			.mutateAsync(request)
			.catch(() => ({ success: false as const, error: requestFailed() }));
		if (!result.success) {
			toast.error(result.error);
			return false;
		}
		toast.success(
			t(
				"settings.approvalEscalation.toast.transferred",
				"Approval assignment transferred",
			),
		);
		return true;
	}

	const retryDeliveryMutation = useMutation({
		mutationFn: retryApprovalEscalationDelivery,
		onSuccess: async (result) => {
			if (!result.success) {
				toast.error(result.error);
			} else {
				toast.success(
					t(
						"settings.approvalEscalation.toast.deliveryRetried",
						"Delivery retry scheduled",
					),
				);
			}
			await invalidate();
		},
		onError: () => toast.error(requestFailed()),
	});

	async function handleDispose(
		attentionId: string,
		note: string,
	): Promise<boolean> {
		const result = await disposeMutation
			.mutateAsync({ attentionId, note })
			.catch(() => ({ success: false as const, error: requestFailed() }));
		if (!result.success) {
			toast.error(result.error);
			return false;
		}
		toast.success(
			t("settings.approvalEscalation.toast.disposed", "Attention item closed"),
		);
		return true;
	}

	if (isLoading) {
		return <Skeleton className="h-64 w-full" />;
	}
	if (!overview) {
		return (
			<Alert variant="destructive">
				<AlertDescription>
					{t(
						"settings.approvalEscalation.loadFailed",
						"Escalation settings could not be loaded.",
					)}
				</AlertDescription>
			</Alert>
		);
	}

	switch (section) {
		case "attention":
			return (
				<div className="space-y-4">
					<EscalationOwnershipNotice control={overview.control} />
					<EscalationAttentionCard
						openAttention={overview.openAttention}
						closedAttention={overview.closedAttention}
						isRechecking={recheckMutation.isPending}
						isDisposing={disposeMutation.isPending}
						isTransferring={transferMutation.isPending}
						isRetryingDelivery={retryDeliveryMutation.isPending}
						onRecheck={() => recheckMutation.mutate()}
						onDispose={handleDispose}
						onTransfer={handleTransfer}
						onRetryDelivery={(attentionId) =>
							retryDeliveryMutation.mutate({ attentionId })
						}
					/>
				</div>
			);
		case "channels":
			return (
				<div className="space-y-4">
					<EscalationChannelsCard
						channels={overview.channels}
						responseWindowHours={overview.policy.responseWindowHours}
					/>
					<EscalationMigrationCard
						policy={overview.policy}
						isReviewing={reviewMutation.isPending}
						onReview={() => reviewMutation.mutate()}
					/>
				</div>
			);
		case "history":
			return <EscalationRevisionsCard revisions={overview.revisions} />;
		case "escalation":
			return (
				<div className="space-y-4">
					<EscalationOwnershipNotice control={overview.control} />
					<EscalationPolicyCard
						key={overview.policy.revision}
						policy={overview.policy}
						isSaving={policyMutation.isPending}
						onSubmit={handlePolicySubmit}
					/>
				</div>
			);
	}
}
