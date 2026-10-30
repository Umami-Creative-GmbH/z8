export type ClockReadScope = {
	userId: string;
	organizationId: string;
};

export const CLOCK_READ_SCOPE_CHANGED =
	"Your account or organization changed. Refresh and try again.";

/** An expectation binds a response to its query key; only fresh server admission authorizes it.
 * Argument-less server callers retain the current authenticated scope. */
export function matchesClockReadScope(
	expected: ClockReadScope | undefined,
	current: { userId: string | null; organizationId: string },
): boolean {
	return (
		expected === undefined ||
		(typeof expected?.userId === "string" &&
			typeof expected?.organizationId === "string" &&
			expected.userId === current.userId &&
			expected.organizationId === current.organizationId)
	);
}
