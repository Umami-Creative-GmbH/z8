import { createPrivateKey } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { organizationSocialOAuth } from "@/db/schema";
import { getOrgSecret } from "@/lib/vault/secrets";
import type { SocialOAuthConfigurationCheckResult } from "./types";

const nonblank = z.string().trim().min(1);
const providerSchema = z.enum(["google", "github", "linkedin", "apple"]);
const appleConfigSchema = z.object({
	apple: z.object({ teamId: nonblank, keyId: nonblank }),
});

function incomplete(error: string): SocialOAuthConfigurationCheckResult {
	return {
		checkType: "configuration",
		authenticationVerified: false,
		success: false,
		status: "incomplete",
		error,
	};
}

function hasAppleProviderFields(providerConfig: unknown): boolean {
	try {
		const parsed: unknown =
			typeof providerConfig === "string"
				? JSON.parse(providerConfig)
				: providerConfig;
		return appleConfigSchema.safeParse(parsed).success;
	} catch {
		return false;
	}
}

function hasAppleSigningKey(privateKey: string): boolean {
	try {
		// Match the PKCS#8 format consumed by the Apple provider.
		if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) return false;
		const key = createPrivateKey(privateKey);
		return (
			key.asymmetricKeyType === "ec" &&
			key.asymmetricKeyDetails?.namedCurve === "prime256v1"
		);
	} catch {
		return false;
	}
}

/**
 * Check locally verifiable organization configuration, without contacting the
 * provider or recording an authentication test. Never fall back to shared secrets.
 */
export async function checkSocialOAuthConfiguration(
	configId: string,
	organizationId: string,
): Promise<SocialOAuthConfigurationCheckResult> {
	try {
		const identifiersValid =
			nonblank.safeParse(configId).success &&
			nonblank.safeParse(organizationId).success;
		const config = identifiersValid
			? await db.query.organizationSocialOAuth.findFirst({
					where: and(
						eq(organizationSocialOAuth.id, configId),
						eq(organizationSocialOAuth.organizationId, organizationId),
					),
				})
			: undefined;

		if (!config) {
			return {
				checkType: "configuration",
				authenticationVerified: false,
				success: false,
				status: "not_found",
				error: "Social OAuth configuration not found",
			};
		}
		if (!config.isActive) {
			return {
				checkType: "configuration",
				authenticationVerified: false,
				success: false,
				status: "inactive",
				error: "Social OAuth configuration is inactive",
			};
		}
		if (!nonblank.safeParse(config.clientId).success) {
			return incomplete("Client ID is missing");
		}
		if (!providerSchema.safeParse(config.provider).success) {
			return incomplete("Social OAuth provider is not supported");
		}
		if (
			config.provider === "apple" &&
			!hasAppleProviderFields(config.providerConfig)
		) {
			return incomplete("Apple Sign In requires a team ID and key ID");
		}

		const clientSecret = await getOrgSecret(
			organizationId,
			`social/${config.provider}/client_secret`,
		);
		if (!clientSecret?.trim()) {
			return incomplete("Organization client secret is missing or unavailable");
		}
		if (config.provider === "apple") {
			const privateKey = await getOrgSecret(
				organizationId,
				"social/apple/private_key",
			);
			if (!privateKey || !hasAppleSigningKey(privateKey)) {
				return incomplete("Apple Sign In requires a valid P-256 private key");
			}
		}

		return {
			checkType: "configuration",
			authenticationVerified: false,
			success: true,
			status: "ready",
		};
	} catch {
		// Infrastructure errors may contain credential-store details or secrets.
		return {
			checkType: "configuration",
			authenticationVerified: false,
			success: false,
			status: "unavailable",
			error:
				"Unable to check OAuth configuration right now. Please try again later.",
		};
	}
}
