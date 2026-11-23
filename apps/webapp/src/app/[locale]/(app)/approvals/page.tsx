import { Suspense } from "react";
import { ApprovalInboxLoadingState } from "./inbox/components/approval-inbox-loading-state";
import { ApprovalsRedirect, type ApprovalsSearchParams } from "./approvals-redirect";

/** Legacy `/approvals` route redirects to the Approval inbox, keeping its query (#1976). */
export default function ApprovalsPage({
	searchParams,
}: {
	searchParams: Promise<ApprovalsSearchParams>;
}) {
	return (
		<Suspense fallback={<ApprovalInboxLoadingState />}>
			<ApprovalsRedirect searchParams={searchParams} />
		</Suspense>
	);
}
