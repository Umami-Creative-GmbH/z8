"use client";

import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
	ConfirmActionDialog,
	describeFailure,
	useConfirmedAction,
} from "@/components/settings/confirm-action-dialog";
import { Button } from "@/components/ui/button";

/** The wording of one policy's withdraw confirmation, translated by its card. */
export interface WithdrawVersionCopy {
	trigger: string;
	title: string;
	description: string;
	confirm: string;
	failed: string;
	withdrawn: string;
}

/**
 * Withdraws one dated policy version after a confirmation. The policy card
 * supplies the withdraw action, the query to refresh and its own wording. The
 * confirmation stays open while the withdrawal runs and shows a failure inline.
 */
export function WithdrawVersionButton({
	withdraw: withdrawVersion,
	queryKey,
	copy,
}: {
	withdraw: () => Promise<{ success: boolean }>;
	queryKey: QueryKey;
	copy: WithdrawVersionCopy;
}) {
	const queryClient = useQueryClient();
	const withdrawal = useConfirmedAction<"version">();

	async function withdrawAndRefresh() {
		const result = await withdrawVersion();
		if (!result.success) throw new Error(copy.failed);
		toast.success(copy.withdrawn);
		await queryClient.invalidateQueries({ queryKey });
	}

	return (
		<>
			<Button
				type="button"
				variant="ghost"
				size="sm"
				disabled={withdrawal.isPending}
				onClick={() => withdrawal.request("version")}
			>
				{copy.trigger}
			</Button>
			<ConfirmActionDialog
				open={withdrawal.open}
				onOpenChange={withdrawal.onOpenChange}
				variant="default"
				title={copy.title}
				description={copy.description}
				confirmLabel={copy.confirm}
				isPending={withdrawal.isPending}
				error={withdrawal.error}
				onConfirm={() =>
					void withdrawal.confirm(withdrawAndRefresh, (failure) =>
						describeFailure(failure, copy.failed),
					)
				}
			/>
		</>
	);
}
