/**
 * TanStack Query keys of the § 12 TzBfG on-call surfaces (#1992). Each starts with the organization
 * so cached findings never show under another organization; a prefix invalidates every view.
 */
import type { OnCallReferenceMethod } from "@/lib/statutory/on-call/reference-period";

/** Every on-call query of the organization: the reviews list and each employee's status. */
export function onCallQueryScope(organizationId: string) {
	return ["statutory", "on-call", organizationId] as const;
}

export function onCallReviewsQueryKey(organizationId: string) {
	return [...onCallQueryScope(organizationId), "reviews"] as const;
}

export function onCallStatusQueryKey(
	organizationId: string,
	employeeId: string,
	method: OnCallReferenceMethod,
) {
	return [...onCallQueryScope(organizationId), "status", employeeId, method] as const;
}
