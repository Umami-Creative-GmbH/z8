// Dependency-free so global client code (QueryProvider) can classify errors without
// pulling the SuperJSON/Luxon response parser from `@/lib/fetch` into every page.

/**
 * Custom API error class that includes HTTP status code
 */
export class ApiError extends Error {
	public readonly status: number;
	public readonly statusText: string;

	constructor(message: string, status: number, statusText: string = "") {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.statusText = statusText;
	}

	/**
	 * Check if error is an unauthorized (401) error
	 */
	isUnauthorized(): boolean {
		return this.status === 401;
	}

	/**
	 * Check if error is a forbidden (403) error
	 */
	isForbidden(): boolean {
		return this.status === 403;
	}

	/**
	 * Check if error is a not found (404) error
	 */
	isNotFound(): boolean {
		return this.status === 404;
	}
}

/**
 * Check if an error is an ApiError
 */
export function isApiError(error: unknown): error is ApiError {
	return error instanceof ApiError;
}

/**
 * Check if an error indicates unauthorized access
 */
export function isUnauthorizedError(error: unknown): boolean {
	if (isApiError(error)) {
		return error.isUnauthorized();
	}
	// Also check for error messages that might indicate auth issues
	if (error instanceof Error) {
		const message = error.message.toLowerCase();
		return message.includes("unauthorized") || message.includes("401");
	}
	return false;
}
