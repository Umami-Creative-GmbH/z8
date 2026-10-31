import { ApiError } from "./api-error";
import { parseSuperJsonResponse } from "./superjson";

export { ApiError, isApiError, isUnauthorizedError } from "./api-error";

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
