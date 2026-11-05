"use client";
import { useTranslate } from "@tolgee/react";
import { toast } from "sonner";
import type { ApprovalInboxDetailSection } from "@/lib/approvals/inbox/types";
import { comparisonEndpointText } from "@/lib/approvals/presentation/time-comparison";
import type { CorrectionOverlap } from "@/lib/time-tracking/correction-overlaps";
import { TimeCorrectionRevision } from "./time-correction-revision";

export function ApprovalCorrectionOverlap({
	approvalId,
	overlaps,
	sections,
	canRevise,
	onActiveChange,
	onRejected,
	onComplete,
}: {
	approvalId: string;
	overlaps: CorrectionOverlap[];
	sections: ApprovalInboxDetailSection[];
	canRevise: boolean;
	onActiveChange: (active: boolean) => void;
	onRejected: () => void;
	onComplete: () => void;
}) {
	const { t } = useTranslate();
	if (overlaps.length === 0) return null;
	const comparison = sections.find(
		(section) => section.type === "time_comparison",
	);
	const utcOffsetMinutes = comparison?.requested.start?.utcOffsetMinutes ?? 0;
	return (
		<section
			className="space-y-3 rounded-xl border border-destructive/30 bg-card p-4"
			aria-label={t(
				"approvals:approvals.overlappingWork",
				"Overlapping recorded work",
			)}
		>
			<p role="alert" className="text-sm font-medium">
				{t(
					"approvals:approvals.overlapExplanation",
					"The requested correction overlaps the recorded work below. Adjust the requested times or reject the correction.",
				)}
			</p>
			<ul className="space-y-2 break-words text-sm tabular-nums">
				{overlaps.map((conflict) => (
					<li key={conflict.kind + conflict.id}>
						{comparisonEndpointText({ at: conflict.startAt, utcOffsetMinutes })}{" "}
						–{" "}
						{conflict.endAt
							? comparisonEndpointText({ at: conflict.endAt, utcOffsetMinutes })
							: t("approvals:approvals.overlapOngoing", "Ongoing")}
					</li>
				))}
			</ul>
			{canRevise && (
				<TimeCorrectionRevision
					key={approvalId}
					approvalId={approvalId}
					overlaps={overlaps}
					onActiveChange={onActiveChange}
					onRejected={onRejected}
					onComplete={(status) => {
						toast.success(
							status === "approved"
								? t(
										"approvals:approvals.revisedApproved",
										"Revised correction approved",
									)
								: status === "pending"
									? t(
											"approvals:approvals.revisedPending",
											"Revised correction submitted for approval",
										)
									: t(
											"approvals:approvals.reviseClosed",
											"Original request rejected; no revision submitted",
										),
						);
						onComplete();
					}}
				/>
			)}
		</section>
	);
}
