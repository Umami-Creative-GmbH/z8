import { headers } from "next/headers";
import { Suspense } from "react";
import { Card, CardFooter, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { resolveApprovalReviewArrival } from "@/lib/approvals/presentation/review-arrival";
import {
	approvalReviewPath,
	parseApprovalReviewTarget,
} from "@/lib/approvals/presentation/review-navigation";
import { auth } from "@/lib/auth";
import { ApprovalReviewOutcome } from "./approval-review-view";

// Ensure handlers are registered
import "@/lib/approvals/init";

interface ApprovalReviewPageProps {
	params: Promise<{ organizationId: string; kind: string; id: string }>;
}

async function ApprovalReviewContent({ params }: ApprovalReviewPageProps) {
	const [routeParams, headersList] = await Promise.all([params, headers()]);
	const session = await auth.api.getSession({ headers: headersList });
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

function ApprovalReviewLoading() {
	return (
		<div aria-busy="true" className="flex flex-1 flex-col gap-6 p-4 md:p-6" role="status">
			<Card className="mx-auto w-full max-w-xl">
				<CardHeader className="space-y-2">
					<Skeleton aria-hidden="true" className="h-6 w-48" />
					<Skeleton aria-hidden="true" className="h-4 w-full" />
				</CardHeader>
				<CardFooter className="flex gap-2">
					<Skeleton aria-hidden="true" className="h-9 w-32" />
					<Skeleton aria-hidden="true" className="h-9 w-32" />
				</CardFooter>
			</Card>
		</div>
	);
}

export default function ApprovalReviewPage({ params }: ApprovalReviewPageProps) {
	return (
		<Suspense fallback={<ApprovalReviewLoading />}>
			<ApprovalReviewContent params={params} />
		</Suspense>
	);
}
