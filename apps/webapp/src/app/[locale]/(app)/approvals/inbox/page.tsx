import { Suspense } from "react";
import { NeutralPageLoading } from "@/components/shells/neutral-page-loading";
import { ApprovalInboxGate } from "./approval-inbox-gate";

/** The guard decides before anything inbox-shaped renders; the inbox keeps its own loading state. */
export default function ApprovalInboxPage() {
	return (
		<Suspense fallback={<NeutralPageLoading />}>
			<ApprovalInboxGate />
		</Suspense>
	);
}
