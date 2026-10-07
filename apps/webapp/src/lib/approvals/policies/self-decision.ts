import { AuthorizationError } from "@/lib/effect/errors";

/**
 * No assignment, management or eligibility path lets a requester decide their
 * own request (#697). Routing never leaves a requester as the pending approver:
 * such stages are auto-approved as `requester_is_approver`.
 */
export function isOwnRequestDecision(input: {
	requesterEmployeeId: string | null | undefined;
	actorEmployeeId: string | null | undefined;
}): boolean {
	return (
		typeof input.requesterEmployeeId === "string" &&
		input.requesterEmployeeId.length > 0 &&
		input.requesterEmployeeId === input.actorEmployeeId
	);
}

const OWN_REQUEST_REFUSAL_PREFIX = "You cannot decide your own ";

/** Whether a failure message is this refusal, which is safe to show as is. */
export function isOwnRequestDecisionRefusal(message: string): boolean {
	return message.startsWith(OWN_REQUEST_REFUSAL_PREFIX);
}

export function ownRequestDecisionError(input: {
	actorEmployeeId: string;
	resource: string;
	action: string;
	/** What the refusal names, such as "expense report". */
	subject?: string;
}): AuthorizationError {
	return new AuthorizationError({
		message: `${OWN_REQUEST_REFUSAL_PREFIX}${input.subject ?? "request"}`,
		userId: input.actorEmployeeId,
		resource: input.resource,
		action: input.action,
	});
}
