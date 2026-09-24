"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import {
	disposeApprovalEscalationAttention,
	getApprovalEscalationOverview,
	recheckApprovalEscalationAttention,
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
}: {
	organizationId: string;
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
	});
	const transferMutation = useMutation({
		mutationFn: transferApprovalEscalationAssignment,
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
		await invalidate();
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
			await invalidate();
			return false;
		}
		toast.success(
			t(
				"settings.approvalEscalation.toast.transferred",
				"Approval assignment transferred",
			),
		);
		await invalidate();
		return true;
	}

	async function handleDispose(
		attentionId: string,
		note: string,
	): Promise<boolean> {
		const result = await disposeMutation
			.mutateAsync({ attentionId, note })
			.catch(() => ({ success: false as const, error: requestFailed() }));
		if (!result.success) {
			toast.error(result.error);
			await invalidate();
			return false;
		}
		toast.success(
			t("settings.approvalEscalation.toast.disposed", "Attention item closed"),
		);
		await invalidate();
		return true;
	}

	return (
		<div className="flex flex-1 flex-col gap-4 p-4">
			<div className="flex flex-col gap-2">
				<h1 className="text-2xl font-semibold tracking-tight">
					{t("settings.approvalEscalation.title", "Approval Escalation")}
				</h1>
				<p className="text-sm text-muted-foreground">
					{t(
						"settings.approvalEscalation.description",
						"Review the organization escalation policy, how it was migrated from channel settings, and conditions that need an approval manager.",
					)}
				</p>
			</div>

			{isLoading ? (
				<div className="space-y-4">
					<Skeleton className="h-48 w-full" />
					<Skeleton className="h-64 w-full" />
				</div>
			) : !overview ? (
				<Alert variant="destructive">
					<AlertDescription>
						{t(
							"settings.approvalEscalation.loadFailed",
							"Escalation settings could not be loaded.",
						)}
					</AlertDescription>
				</Alert>
			) : (
				<>
					<EscalationOwnershipNotice control={overview.control} />
					<EscalationAttentionCard
						openAttention={overview.openAttention}
						closedAttention={overview.closedAttention}
						isRechecking={recheckMutation.isPending}
						isDisposing={disposeMutation.isPending}
						isTransferring={transferMutation.isPending}
						onRecheck={() => recheckMutation.mutate()}
						onDispose={handleDispose}
						onTransfer={handleTransfer}
					/>
					<EscalationPolicyCard
						key={overview.policy.revision}
						policy={overview.policy}
						isSaving={policyMutation.isPending}
						onSubmit={handlePolicySubmit}
					/>
					<EscalationMigrationCard
						policy={overview.policy}
						isReviewing={reviewMutation.isPending}
						onReview={() => reviewMutation.mutate()}
					/>
					<EscalationChannelsCard
						channels={overview.channels}
						responseWindowHours={overview.policy.responseWindowHours}
					/>
					<EscalationRevisionsCard revisions={overview.revisions} />
				</>
			)}
		</div>
	);
}
