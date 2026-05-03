import { DateTime } from "luxon";
import type {
	EnterpriseIdentityProtocol,
	EnterpriseIdentityProviderPresetId,
} from "./provider-presets";

export type EnterpriseIdentitySetupStep =
	| "provider"
	| "domain"
	| "sso"
	| "ssoTest"
	| "scim"
	| "accessPolicy"
	| "review";

export interface EnterpriseIdentitySetupState {
	organizationId: string;
	currentStep: EnterpriseIdentitySetupStep;
	provider: {
		preset: EnterpriseIdentityProviderPresetId;
		protocol: EnterpriseIdentityProtocol;
		providerId: string;
	} | null;
	domain: {
		domain: string;
		verified: boolean;
	} | null;
	ssoTest: {
		status: "not-run" | "passed" | "failed";
		testEmail: string | null;
		providerId: string | null;
		checkedAt: string | null;
		error: string | null;
	};
	scim: {
		enabled: boolean;
		providerId: string | null;
		verified: boolean;
		lastCheckedAt: string | null;
		error: string | null;
	};
	enforcement: {
		ssoRequired: boolean;
		domainRestrictionEnabled: boolean;
		inviteRestrictionEnabled: boolean;
	};
	activatedAt: string | null;
}

export interface EnterpriseIdentityReadiness {
	canActivate: boolean;
	missing: Array<"provider" | "domain" | "ssoTest">;
}

export function createDefaultEnterpriseIdentitySetupState({
	organizationId,
}: {
	organizationId: string;
}): EnterpriseIdentitySetupState {
	return {
		organizationId,
		currentStep: "provider",
		provider: null,
		domain: null,
		ssoTest: {
			status: "not-run",
			testEmail: null,
			providerId: null,
			checkedAt: null,
			error: null,
		},
		scim: {
			enabled: false,
			providerId: null,
			verified: false,
			lastCheckedAt: null,
			error: null,
		},
		enforcement: {
			ssoRequired: false,
			domainRestrictionEnabled: false,
			inviteRestrictionEnabled: false,
		},
		activatedAt: null,
	};
}

export function getEnterpriseIdentityReadiness(
	state: EnterpriseIdentitySetupState,
): EnterpriseIdentityReadiness {
	const missing: EnterpriseIdentityReadiness["missing"] = [];

	if (!state.provider?.providerId) missing.push("provider");
	if (!state.domain?.domain || !state.domain.verified) missing.push("domain");
	if (state.ssoTest.status !== "passed" || state.ssoTest.providerId !== state.provider?.providerId) {
		missing.push("ssoTest");
	}

	return {
		canActivate: missing.length === 0,
		missing,
	};
}

export function markSsoTestPassed(
	state: EnterpriseIdentitySetupState,
	{
		providerId,
		testEmail,
		checkedAt = DateTime.utc().toISO(),
	}: {
		providerId: string;
		testEmail: string;
		checkedAt?: string | null;
	},
): EnterpriseIdentitySetupState {
	return {
		...state,
		ssoTest: {
			status: "passed",
			testEmail,
			providerId,
			checkedAt,
			error: null,
		},
	};
}

export function mapBetterAuthIdentityError(error: unknown): string {
	if (error instanceof Error) return error.message;

	const code =
		typeof error === "object" && error !== null && "code" in error ? String(error.code) : null;

	switch (code) {
		case "discovery_untrusted_origin":
			return "The identity provider origin is not trusted by the auth server. Check the issuer URL and trusted origin configuration.";
		case "unsupported_token_auth_method":
			return "The identity provider only advertises an unsupported token authentication method. Use client_secret_basic or client_secret_post.";
		case "discovery_issuer_mismatch":
			return "The discovered issuer does not match the issuer URL. Check the identity provider metadata configuration.";
		case "discovery_incomplete_metadata":
			return "The identity provider metadata is incomplete. Confirm the issuer exposes authorization, token, and JWKS endpoints.";
		case "discovery_timeout":
			return "The identity provider metadata request timed out. Check network access and try again.";
		case "invalid_discovery_url":
			return "The issuer URL is invalid. Enter a complete HTTPS issuer URL from the identity provider.";
		case "invalid_discovery_json":
			return "The identity provider metadata response is not valid JSON. Check the issuer URL.";
		default:
			return "The identity provider setup could not be completed. Check the provider configuration and try again.";
	}
}
