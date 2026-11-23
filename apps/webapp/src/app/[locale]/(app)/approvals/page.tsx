import { Suspense } from "react";
import { NeutralPageLoading } from "@/components/shells/neutral-page-loading";
import { ApprovalsRedirect, type ApprovalsSearchParams } from "./approvals-redirect";

/** Legacy `/approvals` route redirects to the Approval inbox, keeping its query (#1976). */
export default function ApprovalsPage({
	searchParams,
}: {
	searchParams: Promise<ApprovalsSearchParams>;
}) {
	return (
		<Suspense fallback={<NeutralPageLoading />}>
			<ApprovalsRedirect searchParams={searchParams} />
		</Suspense>
	);
}
