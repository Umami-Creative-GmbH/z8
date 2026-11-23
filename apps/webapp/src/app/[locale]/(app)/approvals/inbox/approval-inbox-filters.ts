import type { ApprovalInboxType } from "@/lib/approvals/inbox/types";
import { SUPPORTED_APPROVAL_INBOX_TYPES } from "@/lib/approvals/inbox/types";
import type { ApprovalInboxFilters } from "@/lib/query/use-approval-inbox";

/** The inbox opens on pending requests, narrowed to the `types` named in the URL. */
export function getInitialApprovalInboxFilters(
	searchParams: Pick<URLSearchParams, "get"> | null,
): ApprovalInboxFilters {
	const rawTypes = searchParams?.get("types") ?? null;
	const types = rawTypes
		?.split(",")
		.map((value) => value.trim())
		.filter((value): value is ApprovalInboxType =>
			(SUPPORTED_APPROVAL_INBOX_TYPES as readonly string[]).includes(value),
		);

	return {
		status: "pending",
		...(types?.length ? { types } : {}),
	};
}
