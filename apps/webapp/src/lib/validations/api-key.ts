import { z } from "zod";
import { API_KEY_SCOPES, type ApiKeyScope } from "@/lib/public-api/scopes";

export { API_KEY_SCOPES, type ApiKeyScope };

/**
 * Expiration options for API keys
 */
export const EXPIRATION_OPTIONS = [
	{ value: "7", label: "7 days" },
	{ value: "30", label: "30 days" },
	{ value: "90", label: "90 days" },
	{ value: "180", label: "6 months" },
	{ value: "365", label: "1 year" },
	{ value: "never", label: "Never" },
] as const;

/**
 * Time windows an admin can choose for a key's rate limit, in milliseconds:
 * a second, a minute, an hour.
 */
export const RATE_LIMIT_WINDOWS = [1_000, 60_000, 3_600_000] as const;

export type RateLimitWindow = (typeof RATE_LIMIT_WINDOWS)[number];

export const DEFAULT_RATE_LIMIT_MAX = 100;
export const DEFAULT_RATE_LIMIT_WINDOW: RateLimitWindow = 60_000;

/**
 * Maximum number of API keys per organization
 */
export const MAX_API_KEYS_PER_ORG = 10;

const nameSchema = z
	.string()
	.trim()
	.min(3, "Name must be at least 3 characters")
	.max(100, "Name must be at most 100 characters");

const scopesSchema = z.array(z.enum(API_KEY_SCOPES)).min(1, "At least one scope is required");

const rateLimitMaxSchema = z
	.number()
	.int()
	.min(10, "Rate limit must be at least 10 requests")
	.max(10000, "Rate limit must be at most 10,000 requests");

const rateLimitTimeWindowSchema = z
	.number()
	.int()
	.min(1000, "Time window must be at least 1 second")
	.max(3600000, "Time window must be at most 1 hour");

/**
 * Schema for creating a new API key
 */
export const createApiKeySchema = z.object({
	name: nameSchema,
	expiresInDays: z
		.number()
		.int()
		.min(1, "Expiration must be at least 1 day")
		.max(365, "Expiration must be at most 365 days")
		.optional()
		.nullable(),
	scopes: scopesSchema,
	rateLimitEnabled: z.boolean().default(true),
	rateLimitMax: rateLimitMaxSchema.optional().default(DEFAULT_RATE_LIMIT_MAX),
	rateLimitTimeWindow: rateLimitTimeWindowSchema.optional().default(DEFAULT_RATE_LIMIT_WINDOW),
});

export type CreateApiKeyData = z.input<typeof createApiKeySchema>;

/**
 * Schema for updating an existing API key
 */
export const updateApiKeySchema = z.object({
	name: nameSchema.optional(),
	enabled: z.boolean().optional(),
	rateLimitEnabled: z.boolean().optional(),
	rateLimitMax: rateLimitMaxSchema.optional(),
	rateLimitTimeWindow: rateLimitTimeWindowSchema.optional(),
	scopes: scopesSchema.optional(),
});

export type UpdateApiKeyData = z.infer<typeof updateApiKeySchema>;

/**
 * API key response type (what we return to the UI)
 * Note: Never includes the actual key value (only shown once on creation)
 * Uses ISO string dates for serialization between server and client
 */
export interface ApiKeyResponse {
	id: string;
	name: string;
	/** First few characters of the key for identification */
	prefix: string | null;
	organizationId: string;
	/** The admin who created the key, for attribution only (ADR 0001). */
	createdBy: string | null;
	creator: ApiKeyCreator | null;
	/** ISO date string */
	createdAt: string;
	/** ISO date string */
	updatedAt: string;
	/** ISO date string or null */
	expiresAt: string | null;
	/** ISO date string or null */
	lastRequest: string | null;
	enabled: boolean;
	scopes: ApiKeyScope[];
	rateLimitEnabled: boolean | null;
	rateLimitMax: number | null;
	rateLimitTimeWindow: number | null;
	requestCount: number | null;
}

export interface ApiKeyCreator {
	userId: string;
	name: string | null;
	email: string | null;
	/** No longer an active member of the organization; the key keeps working. */
	departed: boolean;
}

/**
 * Response when creating a new API key
 * This is the ONLY time the full key is returned
 */
export interface CreateApiKeyResponse {
	id: string;
	/** The full API key - only shown once! */
	key: string;
	name: string;
	prefix: string | null;
	/** ISO date string or null */
	expiresAt: string | null;
}
