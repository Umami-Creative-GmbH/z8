export function getAuthErrorMessage(error: unknown, fallback: string): string {
	if (typeof error === "string" && error.length > 0) {
		return error;
	}

	if (
		typeof error === "object" &&
		error !== null &&
		"message" in error &&
		typeof error.message === "string" &&
		error.message.length > 0
	) {
		return error.message;
	}

	return fallback;
}
