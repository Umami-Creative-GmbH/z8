"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { publishShifts } from "@/app/[locale]/(app)/scheduling/actions";
import type { DateRange, PublishAcknowledgmentInput } from "@/app/[locale]/(app)/scheduling/types";
import type { RefusalMessages } from "@/lib/organization-action/action-error-message";
import { queryKeys } from "@/lib/query/keys";
import type { ScheduleStatutoryFindings } from "@/lib/statutory/scheduling/findings-list";
import { STATUTORY_PUBLICATION_BLOCKED } from "@/lib/statutory/scheduling/publication-block";
import { schedulingActionErrorMessage } from "../scheduling-action-error";
import {
	getPendingPublishAcknowledgment,
	type PendingPublishAcknowledgment,
} from "./shift-publish-flow-utils";

const PUBLISH_REFUSALS = {
	[STATUTORY_PUBLICATION_BLOCKED]: [
		"scheduling.scheduler.publish.statutoryBlocked",
		"Some shifts break youth protection limits (JArbSchG). Change the shifts or acknowledge a statutory sector exception before publishing.",
	],
} satisfies RefusalMessages<typeof STATUTORY_PUBLICATION_BLOCKED>;

/** A refused publication; `statutoryFindings` lists what blocks it, when the refusal says. */
class PublishRefusal extends Error {
	constructor(
		message: string,
		readonly statutoryFindings: ScheduleStatutoryFindings | null,
	) {
		super(message);
	}
}

/** The blocking findings a publish-block refusal carries (#2026), or null. */
function blockingFindingsOfRefusal(details: Record<string, unknown> | undefined) {
	const listed = details?.statutoryFindings as ScheduleStatutoryFindings | undefined;
	return listed && Array.isArray(listed.items) ? listed : null;
}

interface UseShiftPublishFlowOptions {
	organizationId: string;
	dateRange: DateRange;
}

export function useShiftPublishFlow({ organizationId, dateRange }: UseShiftPublishFlowOptions) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [pendingAcknowledgment, setPendingAcknowledgment] =
		useState<PendingPublishAcknowledgment | null>(null);
	const [isComplianceDialogOpen, setIsComplianceDialogOpen] = useState(false);
	const [blockedFindings, setBlockedFindings] = useState<ScheduleStatutoryFindings | null>(null);
	const [isBlockedDialogOpen, setIsBlockedDialogOpen] = useState(false);

	const publishMutation = useMutation({
		mutationFn: async (acknowledgment?: PublishAcknowledgmentInput | null) => {
			const result = await publishShifts(dateRange, acknowledgment ?? null);
			if (!result.success) {
				throw new PublishRefusal(
					schedulingActionErrorMessage(t, result, PUBLISH_REFUSALS),
					result.refusal === STATUTORY_PUBLICATION_BLOCKED
						? blockingFindingsOfRefusal(result.details)
						: null,
				);
			}
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
			toast.success(
				t("scheduling.scheduler.publish.published", "Published {count} shift(s)", {
					count: result.count,
				}),
			);
			queryClient.invalidateQueries({ queryKey: queryKeys.shifts.all });
			queryClient.invalidateQueries({
				queryKey: queryKeys.compliance.scheduleWarnings(organizationId, dateRange),
			});
		},
		onError: (error) => {
			// The publish block names who, which limit and which day: show them, not only a count.
			if (error instanceof PublishRefusal && error.statutoryFindings) {
				setIsComplianceDialogOpen(false);
				setBlockedFindings(error.statutoryFindings);
				setIsBlockedDialogOpen(true);
				return;
			}
			toast.error(t("scheduling.scheduler.publish.failed", "Failed to publish shifts"), {
				description: error.message,
			});
		},
	});

	const publish = () => {
		publishMutation.mutate(null);
	};

	const confirmPublish = () => {
		if (!pendingAcknowledgment) {
			return;
		}

		publishMutation.mutate({
			evaluationFingerprint: pendingAcknowledgment.evaluationFingerprint,
		});
	};

	return {
		pendingAcknowledgment,
		isComplianceDialogOpen,
		setIsComplianceDialogOpen,
		blockedFindings,
		isBlockedDialogOpen,
		setIsBlockedDialogOpen,
		publish,
		confirmPublish,
		isPublishing: publishMutation.isPending,
	};
}
