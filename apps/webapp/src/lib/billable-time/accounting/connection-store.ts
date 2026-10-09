import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { db } from "@/db";
import { user } from "@/db/auth-schema";
import { accountingConnection, auditLog } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import { createLogger } from "@/lib/logger";
import type { Transaction } from "@/lib/time-tracking/work-transaction/ranks";
import { deleteOrgSecret, getOrgSecret, storeOrgSecret } from "@/lib/vault";
import { getBillableTimeSettings, lockBillableTimeSettings } from "../settings";
import {
	type AccountingConnectionSettings,
	type AccountingProvider,
	AccountingProviderError,
	type AccountingProviderKind,
	isAccountingProviderKind,
} from "./provider";
import { type AccountingProviderRegistry, getAccountingProviderRegistry } from "./registry";
import {
	formatTaxRate,
	parseTaxTreatment,
	type TaxTreatment,
	taxTreatmentFromStored,
} from "./tax-treatment";

/**
 * The accounting connection (#903): at most one active per organization, its
 * API key only in the organization secret store, every create, replace,
 * default change and removal audited in the same transaction, never with the
 * key. Callers authorize the actor as an org admin of `organizationId` first.
 */

const logger = createLogger("AccountingConnection");

export type AccountingReader = Pick<Transaction, "select">;

/** Where a connection's API key lives in the organization secret store. */
export function accountingApiKeySecretKey(connectionId: string): string {
	return `accounting/${connectionId}/api_key`;
}

/** The organization secret store, as the accounting connection uses it. */
export interface AccountingSecretStore {
	store(organizationId: string, key: string, value: string): Promise<void>;
	get(organizationId: string, key: string): Promise<string | null>;
	delete(organizationId: string, key: string): Promise<void>;
}

export interface AccountingDependencies {
	registry: AccountingProviderRegistry;
	secrets: AccountingSecretStore;
}

/** The production registry and the organization secret store (`lib/vault`). */
export function defaultAccountingDependencies(): AccountingDependencies {
	return {
		registry: getAccountingProviderRegistry(),
		secrets: {
			store: (organizationId, key, value) => storeOrgSecret(organizationId, key, value),
			get: (organizationId, key) => getOrgSecret(organizationId, key),
			delete: (organizationId, key) => deleteOrgSecret(organizationId, key),
		},
	};
}

export interface ActiveAccountingConnection {
	id: string;
	organizationId: string;
	providerKind: AccountingProviderKind;
	accountRef: string;
	accountLabel: string | null;
	settings: AccountingConnectionSettings;
	defaultTaxTreatment: TaxTreatment;
	connectedAt: Date;
	connectedBy: string | null;
}

function connectionFromRow(
	row: typeof accountingConnection.$inferSelect,
): ActiveAccountingConnection {
	if (!isAccountingProviderKind(row.providerKind)) {
		throw new RangeError(`Not a stored provider kind: ${row.providerKind}`);
	}
	return {
		id: row.id,
		organizationId: row.organizationId,
		providerKind: row.providerKind,
		accountRef: row.accountRef,
		accountLabel: row.accountLabel,
		settings: row.settings,
		defaultTaxTreatment: taxTreatmentFromStored(row.defaultTaxTreatment, row.defaultTaxRate),
		connectedAt: row.connectedAt,
		connectedBy: row.connectedBy,
	};
}

const activeCondition = (organizationId: string) =>
	and(
		eq(accountingConnection.organizationId, organizationId),
		eq(accountingConnection.status, "active"),
	);

/** The organization's active accounting connection, or null. Never holds the key. */
export async function getActiveAccountingConnection(
	reader: AccountingReader,
	organizationId: string,
): Promise<ActiveAccountingConnection | null> {
	const [row] = await reader
		.select()
		.from(accountingConnection)
		.where(activeCondition(organizationId))
		.limit(1);
	return row ? connectionFromRow(row) : null;
}

/** The active connection with the name of the user who connected it, for settings. */
export async function getActiveAccountingConnectionSummary(
	reader: AccountingReader,
	organizationId: string,
): Promise<(ActiveAccountingConnection & { connectedByName: string | null }) | null> {
	const [row] = await reader
		.select({ connection: accountingConnection, connectedByName: user.name })
		.from(accountingConnection)
		.leftJoin(user, eq(user.id, accountingConnection.connectedBy))
		.where(activeCondition(organizationId))
		.limit(1);
	return row
		? { ...connectionFromRow(row.connection), connectedByName: row.connectedByName }
		: null;
}

export type OpenAccountingProviderRefusal =
	/** No active accounting connection. */
	| "not_connected"
	/** The connection's tool has no connector in this deployment. */
	| "provider_unavailable"
	/** The secret store has no API key for the connection. */
	| "credentials_missing";

/**
 * Opens the provider of the organization's active connection with its API key
 * from the secret store. The contact picker and the hand-off (903b) use this.
 */
export async function openAccountingProvider(
	reader: AccountingReader,
	dependencies: AccountingDependencies,
	organizationId: string,
): Promise<
	| { ok: true; connection: ActiveAccountingConnection; provider: AccountingProvider }
	| { ok: false; reason: OpenAccountingProviderRefusal }
> {
	const connection = await getActiveAccountingConnection(reader, organizationId);
	if (!connection) return { ok: false, reason: "not_connected" };
	const connector = dependencies.registry.get(connection.providerKind);
	if (!connector) return { ok: false, reason: "provider_unavailable" };
	const apiKey = await dependencies.secrets.get(
		organizationId,
		accountingApiKeySecretKey(connection.id),
	);
	if (!apiKey) return { ok: false, reason: "credentials_missing" };
	return {
		ok: true,
		connection,
		provider: connector.open({ apiKey, settings: connection.settings }),
	};
}

/** Whether the secret store holds the API key of a connection. */
export async function hasAccountingApiKey(
	dependencies: AccountingDependencies,
	organizationId: string,
	connectionId: string,
): Promise<boolean> {
	const key = await dependencies.secrets.get(
		organizationId,
		accountingApiKeySecretKey(connectionId),
	);
	return key !== null && key !== "";
}

export type ConnectAccountingRefusal =
	| { reason: "billable_time_off" }
	| { reason: "invalid_provider" }
	| { reason: "provider_unavailable" }
	| { reason: "invalid_api_key" }
	| { reason: "invalid_tax_treatment" }
	/** The tool refused the API key. */
	| { reason: "credentials_refused" }
	/** The tool could not be reached or failed; `message` is safe to show. */
	| { reason: "tool_unreachable"; message: string }
	/** The connector refused the connection (e.g. Lexware and a non-EUR currency). */
	| { reason: "connection_refused"; code: string; message: string }
	/** Another admin changed the connection at the same time. */
	| { reason: "concurrent_change" };

export type ConnectAccountingOutcome =
	| { ok: true; connection: ActiveAccountingConnection; replacedConnectionId: string | null }
	| ({ ok: false } & ConnectAccountingRefusal);

const MAX_API_KEY_LENGTH = 1024;

function parseApiKey(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (trimmed === "" || trimmed.length > MAX_API_KEY_LENGTH || /\s/.test(trimmed)) return null;
	return trimmed;
}

function describeTax(treatment: TaxTreatment) {
	return { kind: treatment.kind, rate: formatTaxRate(treatment.rateBasisPoints) };
}

function isUniqueViolation(error: unknown): boolean {
	let candidate: unknown = error;
	for (let depth = 0; depth < 4 && candidate && typeof candidate === "object"; depth += 1) {
		const current = candidate as { code?: unknown; cause?: unknown };
		if (current.code === "23505") return true;
		candidate = current.cause;
	}
	return false;
}

async function bestEffortDeleteSecret(
	dependencies: AccountingDependencies,
	organizationId: string,
	connectionId: string,
): Promise<void> {
	try {
		await dependencies.secrets.delete(organizationId, accountingApiKeySecretKey(connectionId));
	} catch {
		// Never log the error itself: a secret store error could echo the request.
		logger.warn(
			{ organizationId, connectionId },
			"Could not delete an accounting API key from the secret store",
		);
	}
}

async function lockConnections(tx: Transaction, organizationId: string): Promise<void> {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`accounting_connection:${organizationId}`}, 0))`,
	);
}

/**
 * Connects the organization to an accounting tool, or replaces its active
 * connection (new key, other tool, or both). The connector validates the
 * connection first and may refuse it. The key goes into the secret store under
 * the new connection's id; a replaced connection's key is deleted after commit.
 * Audited as created or replaced, without the key.
 */
export async function connectAccounting(
	database: typeof db,
	dependencies: AccountingDependencies,
	input: {
		organizationId: string;
		actorUserId: string;
		providerKind: unknown;
		apiKey: unknown;
		settings: unknown;
		defaultTaxTreatment: unknown;
	},
): Promise<ConnectAccountingOutcome> {
	if (!isAccountingProviderKind(input.providerKind)) {
		return { ok: false, reason: "invalid_provider" };
	}
	const providerKind = input.providerKind;
	const apiKey = parseApiKey(input.apiKey);
	if (!apiKey) return { ok: false, reason: "invalid_api_key" };
	const tax = parseTaxTreatment(input.defaultTaxTreatment);
	if (!tax.ok) return { ok: false, reason: "invalid_tax_treatment" };

	const settings = await getBillableTimeSettings(input.organizationId, database);
	if (!settings.enabled || settings.currency === null) {
		return { ok: false, reason: "billable_time_off" };
	}
	const connector = dependencies.registry.get(providerKind);
	if (!connector) return { ok: false, reason: "provider_unavailable" };

	let validation: Awaited<ReturnType<typeof connector.validateConnection>>;
	try {
		validation = await connector.validateConnection({
			apiKey,
			settings: input.settings,
			context: { organizationId: input.organizationId, billableCurrency: settings.currency },
		});
	} catch (error) {
		if (error instanceof AccountingProviderError) {
			return error.failure === "unauthorized"
				? { ok: false, reason: "credentials_refused" }
				: { ok: false, reason: "tool_unreachable", message: error.message };
		}
		throw error;
	}
	if (!validation.ok) {
		return {
			ok: false,
			reason: "connection_refused",
			code: validation.code,
			message: validation.message,
		};
	}

	const accepted = validation;
	const connectionId = crypto.randomUUID();
	await dependencies.secrets.store(
		input.organizationId,
		accountingApiKeySecretKey(connectionId),
		apiKey,
	);

	let outcome: ConnectAccountingOutcome;
	try {
		outcome = await database.transaction(async (tx) => {
			const locked = await lockBillableTimeSettings(tx, input.organizationId, "share");
			if (!locked.enabled) return { ok: false, reason: "billable_time_off" } as const;
			await lockConnections(tx, input.organizationId);

			const [previousRow] = await tx
				.select()
				.from(accountingConnection)
				.where(activeCondition(input.organizationId))
				.limit(1)
				.for("update");
			const previous = previousRow ? connectionFromRow(previousRow) : null;
			if (previous) {
				await tx
					.update(accountingConnection)
					.set({
						status: "replaced",
						endedAt: sql`now()`,
						endedBy: input.actorUserId,
						updatedAt: sql`now()`,
						updatedBy: input.actorUserId,
					})
					.where(
						and(
							eq(accountingConnection.id, previous.id),
							eq(accountingConnection.organizationId, input.organizationId),
						),
					);
			}

			const [row] = await tx
				.insert(accountingConnection)
				.values({
					id: connectionId,
					organizationId: input.organizationId,
					providerKind,
					status: "active",
					accountRef: accepted.accountRef,
					accountLabel: accepted.accountLabel,
					settings: accepted.settings,
					defaultTaxTreatment: tax.treatment.kind,
					defaultTaxRate: formatTaxRate(tax.treatment.rateBasisPoints),
					connectedBy: input.actorUserId,
					updatedBy: input.actorUserId,
				})
				.returning();

			await tx.insert(auditLog).values({
				organizationId: input.organizationId,
				entityType: "accounting_connection",
				entityId: connectionId,
				action: previous
					? AuditAction.ACCOUNTING_CONNECTION_REPLACED
					: AuditAction.ACCOUNTING_CONNECTION_CREATED,
				performedBy: input.actorUserId,
				changes: JSON.stringify({
					providerKind: { from: previous?.providerKind ?? null, to: providerKind },
					account: {
						from: previous ? { ref: previous.accountRef, label: previous.accountLabel } : null,
						to: { ref: accepted.accountRef, label: accepted.accountLabel },
					},
					defaultTaxTreatment: {
						from: previous ? describeTax(previous.defaultTaxTreatment) : null,
						to: describeTax(tax.treatment),
					},
					// The key itself is never recorded, only that a new one was stored.
					apiKey: "stored_in_secret_store",
				}),
				metadata: JSON.stringify({ previousConnectionId: previous?.id ?? null }),
			});

			return {
				ok: true,
				connection: connectionFromRow(row),
				replacedConnectionId: previous?.id ?? null,
			} as const;
		});
	} catch (error) {
		await bestEffortDeleteSecret(dependencies, input.organizationId, connectionId);
		if (isUniqueViolation(error)) return { ok: false, reason: "concurrent_change" };
		throw error;
	}

	if (!outcome.ok) {
		await bestEffortDeleteSecret(dependencies, input.organizationId, connectionId);
		return outcome;
	}
	if (outcome.replacedConnectionId) {
		await bestEffortDeleteSecret(dependencies, input.organizationId, outcome.replacedConnectionId);
	}
	logger.info(
		{
			organizationId: input.organizationId,
			connectionId,
			providerKind,
			replacedConnectionId: outcome.replacedConnectionId,
		},
		"Accounting connection stored",
	);
	return outcome;
}

export type UpdateAccountingDefaultsOutcome =
	| { ok: true; changed: boolean; connection: ActiveAccountingConnection }
	| { ok: false; reason: "billable_time_off" | "not_connected" | "invalid_tax_treatment" };

/** Changes the active connection's default tax treatment. Audited when it changes. */
export async function updateAccountingConnectionDefaults(
	database: typeof db,
	input: {
		organizationId: string;
		actorUserId: string;
		connectionId: string;
		defaultTaxTreatment: unknown;
	},
): Promise<UpdateAccountingDefaultsOutcome> {
	const tax = parseTaxTreatment(input.defaultTaxTreatment);
	if (!tax.ok) return { ok: false, reason: "invalid_tax_treatment" };

	return database.transaction(async (tx) => {
		const locked = await lockBillableTimeSettings(tx, input.organizationId, "share");
		if (!locked.enabled) return { ok: false, reason: "billable_time_off" } as const;
		await lockConnections(tx, input.organizationId);
		const [row] = await tx
			.select()
			.from(accountingConnection)
			.where(
				and(activeCondition(input.organizationId), eq(accountingConnection.id, input.connectionId)),
			)
			.limit(1)
			.for("update");
		if (!row) return { ok: false, reason: "not_connected" } as const;
		const current = connectionFromRow(row);
		if (
			current.defaultTaxTreatment.kind === tax.treatment.kind &&
			current.defaultTaxTreatment.rateBasisPoints === tax.treatment.rateBasisPoints
		) {
			return { ok: true, changed: false, connection: current } as const;
		}
		const [updated] = await tx
			.update(accountingConnection)
			.set({
				defaultTaxTreatment: tax.treatment.kind,
				defaultTaxRate: formatTaxRate(tax.treatment.rateBasisPoints),
				updatedAt: sql`now()`,
				updatedBy: input.actorUserId,
			})
			.where(
				and(
					eq(accountingConnection.id, current.id),
					eq(accountingConnection.organizationId, input.organizationId),
				),
			)
			.returning();
		await tx.insert(auditLog).values({
			organizationId: input.organizationId,
			entityType: "accounting_connection",
			entityId: current.id,
			action: AuditAction.ACCOUNTING_CONNECTION_UPDATED,
			performedBy: input.actorUserId,
			changes: JSON.stringify({
				defaultTaxTreatment: {
					from: describeTax(current.defaultTaxTreatment),
					to: describeTax(tax.treatment),
				},
			}),
		});
		return { ok: true, changed: true, connection: connectionFromRow(updated) } as const;
	});
}

export type RemoveAccountingConnectionOutcome =
	| { ok: true }
	| { ok: false; reason: "not_connected" };

/**
 * Removes the active connection: it is kept as `removed` (for the drafts it
 * created) and its API key is deleted from the secret store. Audited. Contact
 * links stay, so reconnecting the same tool account brings them back.
 */
export async function removeAccountingConnection(
	database: typeof db,
	dependencies: AccountingDependencies,
	input: { organizationId: string; actorUserId: string; connectionId: string },
): Promise<RemoveAccountingConnectionOutcome> {
	const removed = await database.transaction(async (tx) => {
		await lockConnections(tx, input.organizationId);
		const [row] = await tx
			.select()
			.from(accountingConnection)
			.where(
				and(activeCondition(input.organizationId), eq(accountingConnection.id, input.connectionId)),
			)
			.limit(1)
			.for("update");
		if (!row) return null;
		const current = connectionFromRow(row);
		await tx
			.update(accountingConnection)
			.set({
				status: "removed",
				endedAt: sql`now()`,
				endedBy: input.actorUserId,
				updatedAt: sql`now()`,
				updatedBy: input.actorUserId,
			})
			.where(
				and(
					eq(accountingConnection.id, current.id),
					eq(accountingConnection.organizationId, input.organizationId),
				),
			);
		await tx.insert(auditLog).values({
			organizationId: input.organizationId,
			entityType: "accounting_connection",
			entityId: current.id,
			action: AuditAction.ACCOUNTING_CONNECTION_REMOVED,
			performedBy: input.actorUserId,
			changes: JSON.stringify({
				providerKind: { from: current.providerKind, to: null },
				account: { from: { ref: current.accountRef, label: current.accountLabel }, to: null },
				apiKey: "deleted_from_secret_store",
			}),
		});
		return current;
	});
	if (!removed) return { ok: false, reason: "not_connected" };
	await bestEffortDeleteSecret(dependencies, input.organizationId, removed.id);
	logger.info(
		{ organizationId: input.organizationId, connectionId: removed.id },
		"Accounting connection removed",
	);
	return { ok: true };
}
