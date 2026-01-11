import { parseSuperJsonResponse } from "./superjson";

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

type FetchOptions = RequestInit & {
	/** If true, don't throw on non-2xx responses (default: false) */
	noThrow?: boolean;
};

/**
 * Wrapper around fetch that throws ApiError for non-2xx responses
 * and can automatically handle 401 redirects
 */
export async function fetchApi<T = unknown>(url: string, options: FetchOptions = {}): Promise<T> {
	const { noThrow, ...fetchOptions } = options;

	const response = await fetch(url, fetchOptions);

	if (!response.ok && !noThrow) {
		// Try to get error message from response body
		let errorMessage = response.statusText || `HTTP ${response.status}`;
		try {
			const errorBody = await response.json();
			if (errorBody.message) {
				errorMessage = errorBody.message;
			} else if (errorBody.error) {
				errorMessage = errorBody.error;
			}
		} catch {
			// Ignore JSON parsing errors
		}

		throw new ApiError(errorMessage, response.status, response.statusText);
	}

	// Return empty object for 204 No Content
	if (response.status === 204) {
		return {} as T;
	}

	// Use SuperJSON to parse response - handles both SuperJSON format and plain JSON
	return parseSuperJsonResponse<T>(response);
}
