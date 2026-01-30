import { z } from "zod";

/**
 * Available permission scopes for API keys
 * These define what operations an API key can perform
 */
export const API_KEY_SCOPES = [
	"time-entries:read",
	"time-entries:write",
	"employees:read",
	"reports:read",
	"projects:read",
	"projects:write",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

/**
 * Human-readable labels for permission scopes
 */
export const SCOPE_LABELS: Record<ApiKeyScope, string> = {
	"time-entries:read": "Read time entries",
	"time-entries:write": "Write time entries",
	"employees:read": "Read employees",
	"reports:read": "Read reports",
	"projects:read": "Read projects",
	"projects:write": "Write projects",
};

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
 * Maximum number of API keys per organization
 */
export const MAX_API_KEYS_PER_ORG = 10;

/**
 * Schema for creating a new API key
 */
export const createApiKeySchema = z.object({
	name: z
		.string()
		.min(3, "Name must be at least 3 characters")
		.max(100, "Name must be at most 100 characters"),
	expiresInDays: z
		.number()
		.int()
		.min(1, "Expiration must be at least 1 day")
		.max(365, "Expiration must be at most 365 days")
		.optional()
		.nullable(),
	scopes: z
		.array(z.enum(API_KEY_SCOPES))
		.min(1, "At least one scope is required")
		.default(["time-entries:read"]),
	rateLimitEnabled: z.boolean().default(true),
	rateLimitMax: z
		.number()
		.int()
		.min(10, "Rate limit must be at least 10 requests")
		.max(10000, "Rate limit must be at most 10,000 requests")
		.optional()
		.default(100),
	rateLimitTimeWindow: z
		.number()
		.int()
		.min(1000, "Time window must be at least 1 second")
		.max(3600000, "Time window must be at most 1 hour")
		.optional()
		.default(60000), // 1 minute in milliseconds
});

export type CreateApiKeyData = z.infer<typeof createApiKeySchema>;

/**
 * Schema for updating an existing API key
 */
export const updateApiKeySchema = z.object({
	name: z
		.string()
		.min(3, "Name must be at least 3 characters")
		.max(100, "Name must be at most 100 characters")
		.optional(),
	enabled: z.boolean().optional(),
	rateLimitEnabled: z.boolean().optional(),
	rateLimitMax: z
		.number()
		.int()
		.min(10, "Rate limit must be at least 10 requests")
		.max(10000, "Rate limit must be at most 10,000 requests")
		.optional(),
	scopes: z.array(z.enum(API_KEY_SCOPES)).min(1, "At least one scope is required").optional(),
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
	createdBy: string | null;
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
