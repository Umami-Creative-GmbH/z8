import { getOrganizationBaseUrl } from "@/lib/app-url";

/**
 * The exact item an authenticated review opens. A compatibility reference is
 * the legacy approval request; a canonical reference is one stage assignment,
 * which pins a single approval cycle. Neither is authority: arrival rechecks
 * membership and current entitlement before anything is loaded.
 */
export type ApprovalReviewReference =
	| { kind: "compatibility"; approvalRequestId: string }
	| { kind: "canonical"; assignmentId: string };

export interface ApprovalReviewTarget {
	organizationId: string;
	reference: ApprovalReviewReference;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ORGANIZATION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The identifier a reference points at, whatever its kind. */
export function referenceId(reference: ApprovalReviewReference): string {
	return reference.kind === "compatibility" ? reference.approvalRequestId : reference.assignmentId;
}

/**
 * Locale-free path of the exact-item review route. It carries the target only
 * in path segments, because sign-in preserves the path but not query strings.
 */
export function approvalReviewPath(target: ApprovalReviewTarget): string {
	return [
		"/approvals/review",
		encodeURIComponent(target.organizationId),
		target.reference.kind,
		encodeURIComponent(referenceId(target.reference)),
	].join("/");
}

/** Absolute link for outbound providers, on the organization's own origin. */
export async function approvalReviewUrl(target: ApprovalReviewTarget): Promise<string> {
	const baseUrl = await getOrganizationBaseUrl(target.organizationId);
	return `${baseUrl}${approvalReviewPath(target)}`;
}

/** Parses receiving-route segments; anything malformed is not a target. */
export function parseApprovalReviewTarget(params: {
	organizationId: string;
	kind: string;
	id: string;
}): ApprovalReviewTarget | null {
	if (!ORGANIZATION_ID_PATTERN.test(params.organizationId)) return null;
	if (!UUID_PATTERN.test(params.id)) return null;
	const id = params.id.toLowerCase();
	switch (params.kind) {
		case "compatibility":
			return {
				organizationId: params.organizationId,
				reference: { kind: "compatibility", approvalRequestId: id },
			};
		case "canonical":
			return {
				organizationId: params.organizationId,
				reference: { kind: "canonical", assignmentId: id },
			};
		default:
			return null;
	}
}
