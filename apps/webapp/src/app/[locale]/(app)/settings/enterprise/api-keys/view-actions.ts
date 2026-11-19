"use server";

import { Effect } from "effect";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, ValidationError } from "@/lib/effect/errors";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { organizationAction } from "@/lib/organization-action/organization-action";
import { refuseUnless } from "@/lib/organization-action/refuse-unless";
import { getWebhookEndpointsByOrganization } from "@/lib/webhooks/webhook-service";
import { listApiKeys } from "./actions";

// Expectations fence presentation requests; the canonical resolver still grants access.
const expectation = z.strictObject({
	userId: z.string().min(1),
	organizationId: z.string().min(1),
});

export const readApiKeysForView = organizationAction(
	{ name: "developerAccess.keys", requires: "orgAdmin", schema: expectation },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* refuseUnless(
				actor.userId === input.userId && organizationId === input.organizationId,
				{
					userId: actor.userId,
					resource: "developerAccess.keys",
					action: "read",
					message: "Organization context changed. Refresh to continue.",
				},
			);
			const result = yield* Effect.promise(() => listApiKeys());
			if (!result.success && result.code === "AuthorizationError")
				return yield* Effect.fail(
					new AuthorizationError({ message: "You do not have access to this setting" }),
				);
			if (!result.success && result.code === "AuthenticationError")
				return yield* Effect.fail(new AuthenticationError({ message: "Sign in to continue" }));
			if (!result.success)
				return yield* Effect.fail(
					new ValidationError({
						message: "API keys unavailable. Refresh to continue.",
						field: "apiKeys",
					}),
				);
			return result.data;
		}),
);

export const readWebhooksForView = organizationAction(
	{ name: "developerAccess.webhooks", requires: "orgAdmin", schema: expectation },
	({ actor, organizationId, input }) =>
		Effect.gen(function* () {
			yield* refuseUnless(
				actor.userId === input.userId && organizationId === input.organizationId,
				{
					userId: actor.userId,
					resource: "developerAccess.webhooks",
					action: "read",
					message: "Organization context changed. Refresh to continue.",
				},
			);
			const database = yield* DatabaseService;
			return yield* database.query("developerAccess.webhooks", () =>
				getWebhookEndpointsByOrganization(organizationId),
			);
		}),
);
