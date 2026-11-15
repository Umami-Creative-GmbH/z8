import { Suspense } from "react";
import { resolveApprovalReviewArrival } from "@/lib/approvals/presentation/review-arrival";
import {
	approvalReviewPath,
	parseApprovalReviewTarget,
} from "@/lib/approvals/presentation/review-navigation";
import { getRequestSession } from "@/lib/auth/request-session";
import {
	ApprovalReviewLoading,
	ApprovalReviewOutcome,
} from "./approval-review-view";

// Ensure handlers are registered
import "@/lib/approvals/init";

interface ApprovalReviewPageProps {
	params: Promise<{ organizationId: string; kind: string; id: string }>;
}

async function ApprovalReviewContent({ params }: ApprovalReviewPageProps) {
	const [routeParams, session] = await Promise.all([
		params,
		getRequestSession(),
	]);
	const target = parseApprovalReviewTarget(routeParams);
	// The app layout sends signed-out visitors to sign-in with this path as the
	// callback; without a session nothing is looked up here.
	const arrival = session?.user
		? await resolveApprovalReviewArrival({
				userId: session.user.id,
				activeOrganizationId: session.session.activeOrganizationId,
				target,
			})
		: ({ status: "unavailable" } as const);

	return (
		<ApprovalReviewOutcome
			arrival={arrival}
			reviewPath={target ? approvalReviewPath(target) : null}
		/>
	);
}

export default function ApprovalReviewPage({
	params,
}: ApprovalReviewPageProps) {
	return (
		<Suspense fallback={<ApprovalReviewLoading />}>
			<ApprovalReviewContent params={params} />
		</Suspense>
	);
}
