import "server-only";

import { connection } from "next/server";
import type { z } from "zod";
import { db } from "@/db";
import { env } from "@/env";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/logger";
import { checkRateLimit, getClientIp, RATE_LIMIT_CONFIGS } from "@/lib/rate-limit";
import { createPublicApiDependencies } from "./dependencies";
import type { PublicApiEndpoint } from "./endpoint";
import { handlePublicApiRequest, type PublicApiDependencies } from "./pipeline";

const logger = createLogger("PublicApi");

let dependencies: PublicApiDependencies | undefined;

function productionDependencies(): PublicApiDependencies {
	dependencies ??= createPublicApiDependencies({
		database: db,
		verifyApiKey: (key) => auth.api.verifyApiKey({ body: { key } }),
		async checkOrganizationLimit(organizationId) {
			const result = await checkRateLimit(`public-api:${organizationId}`, "api");
			return {
				allowed: result.allowed,
				limit: result.limit ?? RATE_LIMIT_CONFIGS.api.maxRequests,
				remaining: result.remaining,
				resetAt: result.resetAt,
				retryAfterSeconds: Math.max(1, result.retryAfter),
			};
		},
		billingEnabled: () => env.BILLING_ENABLED === "true",
		clientIp(request) {
			const ip = getClientIp(request);
			return ip === "unknown" ? null : ip;
		},
		onError: (error, context) => logger.error({ error, ...context }, "Public API request failed"),
	});
	return dependencies;
}

/** The route handler for one Public API v1 endpoint. */
export function publicApiRoute<Query extends z.ZodObject, Response extends z.ZodType>(
	endpoint: PublicApiEndpoint<Query, Response>,
) {
	return async (request: Request) => {
		await connection();
		return handlePublicApiRequest(productionDependencies(), endpoint, request);
	};
}
