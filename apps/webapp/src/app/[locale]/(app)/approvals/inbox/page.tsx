import { Suspense } from "react";
import { ApprovalInboxGate } from "./approval-inbox-gate";
import { ApprovalInboxLoadingState } from "./components/approval-inbox-loading-state";

export default function ApprovalInboxPage() {
	return (
		<Suspense fallback={<ApprovalInboxLoadingState />}>
			<ApprovalInboxGate />
		</Suspense>
	);
}
