import { PostHog } from "posthog-node";
import { env } from "@/env";

let posthogInstance: PostHog | null = null;

export function getPostHogServer(): PostHog | null {
	if (env.NODE_ENV === "development") {
		return null;
	}

	const projectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();

	if (!projectToken) {
		return null;
	}

	if (!posthogInstance) {
		posthogInstance = new PostHog(projectToken, {
			host: env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://eu.i.posthog.com",
			flushAt: 1,
			flushInterval: 0,
		});
	}

	return posthogInstance;
}

export function getPostHogDistinctIdFromCookie(cookieHeader: string | string[] | undefined) {
	if (!cookieHeader) {
		return null;
	}

	const cookieString = Array.isArray(cookieHeader) ? cookieHeader.join("; ") : cookieHeader;
	const postHogCookieMatch = cookieString.match(/ph_phc_.*?_posthog=([^;]+)/);

	if (!postHogCookieMatch?.[1]) {
		return null;
	}

	try {
		const decodedCookie = decodeURIComponent(postHogCookieMatch[1]);
		const postHogData = JSON.parse(decodedCookie) as { distinct_id?: unknown };

		return typeof postHogData.distinct_id === "string" ? postHogData.distinct_id : null;
	} catch (error) {
		console.error("Error parsing PostHog cookie:", error);
		return null;
	}
}
