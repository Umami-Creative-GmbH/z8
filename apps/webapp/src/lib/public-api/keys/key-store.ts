/**
 * Organization API keys (#763, ADR 0001): a key belongs to its organization
 * (`apikey.reference_id`) and acts as it, limited only by its key scopes. The
 * key creator is kept in the key's metadata for attribution only.
 *
 * Keys are written here rather than through the Better Auth API-key plugin's
 * endpoints: the plugin's organization mode authorizes through an `apiKey`
 * access-control statement Z8's member roles do not carry, and it cannot hold
 * the per-org limit and the audit entry in the key's transaction. The rows keep
 * the plugin's format (hashed key, `default` config), so `auth.api.verifyApiKey`
 * verifies them and enforces their per-key rate limit.
 */
import "server-only";

import { defaultKeyHasher } from "@better-auth/api-key";
import { generateRandomString } from "better-auth/crypto";
import { and, asc, count, eq, inArray, sql } from "drizzle-orm";
import type { db } from "@/db";
import { apikey, member, user } from "@/db/auth-schema";
import { auditLog, employee } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { isUuid } from "@/lib/billable-time/input";
import { employeeHasOrganizationAccess } from "@/lib/employee-lifecycle/access";
import {
	type ApiKeyPermissions,
	type ApiKeyScope,
	permissionsOfScopes,
	scopesOfPermissions,
} from "@/lib/public-api/scopes";

type Database = typeof db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
/** Anything that can run a select: the app database or a transaction. */
export type ApiKeyReader = Pick<Transaction, "select">;

export const API_KEY_PREFIX = "z8_org";
/** Random characters after the prefix, as the plugin's default generator makes them. */
const KEY_LENGTH = 64;
/** Characters of the key shown in the key list: the prefix and the first four random ones. */
const START_LENGTH = API_KEY_PREFIX.length + 4;
export const MAX_KEYS_PER_ORGANIZATION = 10;

export interface ApiKeyView {
	id: string;
	organizationId: string;
	name: string;
	start: string | null;
	enabled: boolean;
	scopes: ApiKeyScope[];
	rateLimitEnabled: boolean;
	rateLimitMax: number | null;
	rateLimitTimeWindow: number | null;
	requestCount: number;
	lastRequest: Date | null;
	expiresAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
	creator: {
		userId: string;
		name: string | null;
		email: string | null;
		/** No longer an active member and employee of the organization. */
		departed: boolean;
	} | null;
}

export interface ApiKeySettings {
	name: string;
	scopes: readonly ApiKeyScope[];
	rateLimitEnabled: boolean;
	rateLimitMax: number;
	rateLimitTimeWindow: number;
}

type KeyRow = typeof apikey.$inferSelect;

/** A JSON text column of the key; null when missing or unreadable. */
export function parseStoredJson(value: string | null): unknown {
	if (!value) return null;
	try {
		const parsed: unknown = JSON.parse(value);
		// Older plugin versions stored metadata JSON-encoded twice.
		return typeof parsed === "string" ? parseStoredJson(parsed) : parsed;
	} catch {
		return null;
	}
}

/** The key creator's user id from the key's metadata. */
export function creatorOfMetadata(metadata: unknown): string | null {
	if (!metadata || typeof metadata !== "object") return null;
	const createdBy = (metadata as Record<string, unknown>).createdBy;
	return typeof createdBy === "string" && createdBy.length > 0 ? createdBy : null;
}

const lockKeys = (tx: Pick<Transaction, "execute">, organizationId: string) =>
	tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`api_keys:${organizationId}`}, 0))`,
	);

/** Every API key of an organization, newest first, with its creator. */
export async function listOrganizationApiKeys(
	reader: ApiKeyReader,
	organizationId: string,
): Promise<ApiKeyView[]> {
	const rows = await reader
		.select()
		.from(apikey)
		.where(eq(apikey.referenceId, organizationId))
		.orderBy(sql`${apikey.createdAt} desc`, asc(apikey.id));
	return withCreators(reader, organizationId, rows);
}

/** One key of an organization, or null when it is not one of its keys. */
export async function getOrganizationApiKey(
	reader: ApiKeyReader,
	organizationId: string,
	keyId: string,
): Promise<ApiKeyView | null> {
	if (!isUuid(keyId)) return null;
	const rows = await reader
		.select()
		.from(apikey)
		.where(and(eq(apikey.referenceId, organizationId), eq(apikey.id, keyId)))
		.limit(1);
	const [view] = await withCreators(reader, organizationId, rows);
	return view ?? null;
}

async function withCreators(
	reader: ApiKeyReader,
	organizationId: string,
	rows: KeyRow[],
): Promise<ApiKeyView[]> {
	const creatorIds = [
		...new Set(rows.flatMap((row) => creatorOfMetadata(parseStoredJson(row.metadata)) ?? [])),
	];
	const creators =
		creatorIds.length === 0
			? []
			: await reader
					.select({
						userId: user.id,
						name: user.name,
						email: user.email,
						memberId: member.id,
						// Member-only accounts without an employee profile keep their access.
						employeeAccess: sql<boolean>`CASE WHEN ${employee.id} IS NULL THEN true ELSE ${employeeHasOrganizationAccess()} END`,
					})
					.from(user)
					.leftJoin(
						member,
						and(
							eq(member.userId, user.id),
							eq(member.organizationId, organizationId),
							eq(member.status, "approved"),
						),
					)
					.leftJoin(
						employee,
						and(eq(employee.userId, user.id), eq(employee.organizationId, organizationId)),
					)
					.where(inArray(user.id, creatorIds));
	const byId = new Map(creators.map((creator) => [creator.userId, creator]));

	return rows.map((row) => {
		const creatorId = creatorOfMetadata(parseStoredJson(row.metadata));
		const creator = creatorId ? byId.get(creatorId) : undefined;
		return {
			id: row.id,
			organizationId: row.referenceId,
			name: row.name ?? "",
			start: row.start,
			enabled: row.enabled ?? true,
			scopes: scopesOfPermissions(parseStoredJson(row.permissions)),
			rateLimitEnabled: row.rateLimitEnabled ?? true,
			rateLimitMax: row.rateLimitMax,
			rateLimitTimeWindow: row.rateLimitTimeWindow,
			requestCount: row.requestCount ?? 0,
			lastRequest: row.lastRequest,
			expiresAt: row.expiresAt,
			createdAt: row.createdAt,
			updatedAt: row.updatedAt,
			creator: creatorId
				? {
						userId: creatorId,
						name: creator?.name ?? null,
						email: creator?.email ?? null,
						departed: !creator?.memberId || creator.employeeAccess !== true,
					}
				: null,
		};
	});
}

function settingsAudit(row: {
	name: string | null;
	enabled: boolean | null;
	permissions: string | null;
	rateLimitEnabled: boolean | null;
	rateLimitMax: number | null;
	rateLimitTimeWindow: number | null;
	expiresAt?: Date | null;
}) {
	return {
		name: row.name,
		enabled: row.enabled ?? true,
		scopes: scopesOfPermissions(parseStoredJson(row.permissions)),
		rateLimitEnabled: row.rateLimitEnabled ?? true,
		rateLimitMax: row.rateLimitMax,
		rateLimitTimeWindow: row.rateLimitTimeWindow,
		...(row.expiresAt === undefined ? {} : { expiresAt: row.expiresAt?.toISOString() ?? null }),
	};
}

async function writeAudit(
	tx: Transaction,
	entry: {
		organizationId: string;
		actorUserId: string;
		keyId: string;
		action: AuditAction;
		changes: Record<string, unknown>;
		metadata: Record<string, unknown>;
	},
) {
	await tx.insert(auditLog).values({
		organizationId: entry.organizationId,
		entityType: "api_key",
		entityId: entry.keyId,
		action: entry.action,
		performedBy: entry.actorUserId,
		changes: JSON.stringify(entry.changes),
		metadata: JSON.stringify(entry.metadata),
	});
}

export type CreateApiKeyOutcome =
	| {
			ok: true;
			key: { id: string; key: string; name: string; start: string; expiresAt: Date | null };
	  }
	| { ok: false; reason: "key_limit_reached" };

/**
 * Creates an API key for an organization. The caller authorizes the actor as
 * an org admin first. Key creations of one organization are serialized, so two
 * admins creating keys at the same moment cannot pass the per-org limit. The
 * full key is returned only here.
 */
export async function createOrganizationApiKey(
	database: Database,
	input: ApiKeySettings & {
		organizationId: string;
		actorUserId: string;
		expiresAt: Date | null;
		now?: Date;
	},
): Promise<CreateApiKeyOutcome> {
	const now = input.now ?? new Date();
	const key = `${API_KEY_PREFIX}${generateRandomString(KEY_LENGTH, "a-z", "A-Z")}`;
	const hashed = await defaultKeyHasher(key);
	const permissions: ApiKeyPermissions = permissionsOfScopes(input.scopes);

	return database.transaction(async (tx) => {
		await lockKeys(tx, input.organizationId);
		const [{ keys }] = await tx
			.select({ keys: count() })
			.from(apikey)
			.where(eq(apikey.referenceId, input.organizationId));
		if (keys >= MAX_KEYS_PER_ORGANIZATION) {
			return { ok: false, reason: "key_limit_reached" } as const;
		}

		const [row] = await tx
			.insert(apikey)
			.values({
				id: crypto.randomUUID(),
				configId: "default",
				name: input.name,
				start: key.slice(0, START_LENGTH),
				prefix: API_KEY_PREFIX,
				key: hashed,
				referenceId: input.organizationId,
				enabled: true,
				rateLimitEnabled: input.rateLimitEnabled,
				rateLimitMax: input.rateLimitMax,
				rateLimitTimeWindow: input.rateLimitTimeWindow,
				requestCount: 0,
				expiresAt: input.expiresAt,
				createdAt: now,
				updatedAt: now,
				permissions: JSON.stringify(permissions),
				metadata: JSON.stringify({ createdBy: input.actorUserId }),
			})
			.returning();

		await writeAudit(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			keyId: row.id,
			action: AuditAction.API_KEY_CREATED,
			changes: { after: settingsAudit(row) },
			metadata: { start: row.start },
		});

		return {
			ok: true,
			key: { id: row.id, key, name: input.name, start: row.start ?? "", expiresAt: row.expiresAt },
		} as const;
	});
}

export type ApiKeyChange = Partial<ApiKeySettings> & { enabled?: boolean };

/**
 * Changes an API key's name, scopes, enabled state or rate limit. A new rate
 * limit takes effect on the key's next request. Audited with the acting admin.
 */
export async function updateOrganizationApiKey(
	database: Database,
	input: {
		organizationId: string;
		actorUserId: string;
		keyId: string;
		change: ApiKeyChange;
		now?: Date;
	},
): Promise<{ ok: true } | { ok: false; reason: "key_not_found" }> {
	if (!isUuid(input.keyId)) return { ok: false, reason: "key_not_found" };
	return database.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(apikey)
			.where(and(eq(apikey.referenceId, input.organizationId), eq(apikey.id, input.keyId)))
			.for("update")
			.limit(1);
		if (!row) return { ok: false, reason: "key_not_found" } as const;

		const { change } = input;
		const next = {
			name: change.name ?? row.name,
			enabled: change.enabled ?? row.enabled,
			permissions:
				change.scopes === undefined
					? row.permissions
					: JSON.stringify(permissionsOfScopes(change.scopes)),
			rateLimitEnabled: change.rateLimitEnabled ?? row.rateLimitEnabled,
			rateLimitMax: change.rateLimitMax ?? row.rateLimitMax,
			rateLimitTimeWindow: change.rateLimitTimeWindow ?? row.rateLimitTimeWindow,
		};
		const before = settingsAudit(row);
		const after = settingsAudit(next);
		const changedKeys = (Object.keys(after) as (keyof typeof after)[]).filter(
			(key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]),
		);
		if (changedKeys.length === 0) return { ok: true } as const;

		const limitChanged =
			next.rateLimitMax !== row.rateLimitMax ||
			next.rateLimitTimeWindow !== row.rateLimitTimeWindow ||
			next.rateLimitEnabled !== row.rateLimitEnabled;
		await tx
			.update(apikey)
			.set({
				...next,
				// A changed limit starts a fresh window, so it applies from the next request.
				...(limitChanged ? { requestCount: 0, lastRequest: null } : {}),
				updatedAt: input.now ?? new Date(),
			})
			.where(and(eq(apikey.referenceId, input.organizationId), eq(apikey.id, row.id)));

		const pick = (source: typeof after) =>
			Object.fromEntries(changedKeys.map((key) => [key, source[key]]));
		await writeAudit(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			keyId: row.id,
			action: AuditAction.API_KEY_UPDATED,
			changes: { before: pick(before), after: pick(after) },
			metadata: { start: row.start },
		});
		return { ok: true } as const;
	});
}

/**
 * Revokes an API key: it stops authenticating at once. Revoking is always an
 * explicit admin action; nothing revokes a key when its creator leaves.
 */
export async function revokeOrganizationApiKey(
	database: Database,
	input: { organizationId: string; actorUserId: string; keyId: string },
): Promise<{ ok: true } | { ok: false; reason: "key_not_found" }> {
	if (!isUuid(input.keyId)) return { ok: false, reason: "key_not_found" };
	return database.transaction(async (tx) => {
		const [row] = await tx
			.delete(apikey)
			.where(and(eq(apikey.referenceId, input.organizationId), eq(apikey.id, input.keyId)))
			.returning();
		if (!row) return { ok: false, reason: "key_not_found" } as const;
		await writeAudit(tx, {
			organizationId: input.organizationId,
			actorUserId: input.actorUserId,
			keyId: row.id,
			action: AuditAction.API_KEY_REVOKED,
			changes: { before: settingsAudit(row) },
			metadata: { start: row.start, createdBy: creatorOfMetadata(parseStoredJson(row.metadata)) },
		});
		return { ok: true } as const;
	});
}
