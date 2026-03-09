"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { publishShifts } from "@/app/[locale]/(app)/scheduling/actions";
import type { DateRange, PublishAcknowledgmentInput } from "@/app/[locale]/(app)/scheduling/types";
import { queryKeys } from "@/lib/query/keys";
import {
	getPendingPublishAcknowledgment,
	type PendingPublishAcknowledgment,
} from "./shift-publish-flow-utils";

interface UseShiftPublishFlowOptions {
	organizationId: string;
	dateRange: DateRange;
}

export function useShiftPublishFlow({ organizationId, dateRange }: UseShiftPublishFlowOptions) {
	const queryClient = useQueryClient();
	const [pendingAcknowledgment, setPendingAcknowledgment] =
		useState<PendingPublishAcknowledgment | null>(null);
	const [isComplianceDialogOpen, setIsComplianceDialogOpen] = useState(false);

	const publishMutation = useMutation({
		mutationFn: async (acknowledgment?: PublishAcknowledgmentInput | null) => {
			const result = await publishShifts(dateRange, acknowledgment ?? null);
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		onSuccess: (result) => {
			const nextPendingAcknowledgment = getPendingPublishAcknowledgment(result);

			if (nextPendingAcknowledgment) {
				setPendingAcknowledgment(nextPendingAcknowledgment);
				setIsComplianceDialogOpen(true);
				return;
			}

			setPendingAcknowledgment(null);
			setIsComplianceDialogOpen(false);
			toast.success(`Published ${result.count} shift(s)`);
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
			});
		},
		onError: (error) => {
			toast.error("Failed to publish shifts", { description: error.message });
		},
	});

	const publish = useCallback(() => {
		publishMutation.mutate(null);
	}, [publishMutation]);

	const confirmPublish = useCallback(() => {
		if (!pendingAcknowledgment) {
			return;
		}

		publishMutation.mutate({
			evaluationFingerprint: pendingAcknowledgment.evaluationFingerprint,
		});
	}, [pendingAcknowledgment, publishMutation]);

	return {
		pendingAcknowledgment,
		isComplianceDialogOpen,
		setIsComplianceDialogOpen,
		publish,
		confirmPublish,
		isPublishing: publishMutation.isPending,
	};
}
