import { and, eq, sql } from "drizzle-orm";
import type { DatabaseClient } from "@/lib/effect/services/database.service";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/effect/errors";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";
import { plainDateAt, systemClock } from "@/lib/datetime/temporal-core";
import { loadOrganizationTimezone } from "@/lib/timezone/load-organization-timezone";
import { location } from "@/db/schema";

export type LocationTransaction = Parameters<Parameters<DatabaseClient["transaction"]>[0]>[0];

export interface BlockingWorkPolicyRef {
	readonly id: string;
	readonly name: string;
}

export type LocationPolicyReferenceClassification =
	| { readonly kind: "unreferenced" }
	| { readonly kind: "historical_only"; readonly historicalReferenceCount: number }
	| {
			readonly kind: "active_or_future";
			readonly blockingPolicies: readonly BlockingWorkPolicyRef[];
	  };

export interface LockedLocationRow {
	readonly id: string;
	readonly organizationId: string;
	readonly name: string;
	readonly isActive: boolean;
}

export type DeleteLocationOutcome =
	| { readonly outcome: "deleted"; readonly id: string; readonly name: string }
	| {
			readonly outcome: "archived";
			readonly id: string;
			readonly name: string;
			readonly historicalReferenceCount: number;
	  };

function toRows(result: unknown): Record<string, unknown>[] {
	if (
		typeof result === "object" &&
		result !== null &&
		"rows" in result &&
		Array.isArray(result.rows)
	) {
		return result.rows as Record<string, unknown>[];
	}
	return [];
}

/**
 * Acquires `FOR UPDATE` on the target location row inside the caller's transaction.
 * Preserves the acyclic lock graph `work_policy -> location`: location writers lock ONLY
 * `location` and perform plain snapshot reads against `work_policy*`.
 */
export async function lockLocationForUpdateInTx(
	tx: LocationTransaction,
	input: { organizationId: string; locationId: string },
): Promise<LockedLocationRow | null> {
	const result = await tx.execute(sql`
		SELECT
			"id",
			"organization_id" AS "organizationId",
			"name",
			"is_active" AS "isActive"
		FROM "location"
		WHERE "id" = ${input.locationId}::uuid
			AND "organization_id" = ${input.organizationId}
		FOR UPDATE
	`);
	const row = toRows(result)[0];
	if (!row || typeof row.id !== "string" || typeof row.name !== "string") {
		return null;
	}
	return {
		id: row.id,
		organizationId: String(row.organizationId),
		name: row.name,
		isActive: Boolean(row.isActive),
	};
}

/**
 * Classifies all `work_policy_presence` references to a locked location as:
 * - `active_or_future`: referenced by any active policy's currently effective version
 *   (on `asOfDate`) or non-superseded future effective version with `presence_enabled = true`.
 * - `historical_only`: referenced only by sealed historical, superseded, presence-disabled,
 *   or inactive-policy rows (must archive instead of physically deleting to preserve history
 *   and satisfy `ON DELETE NO ACTION`).
 * - `unreferenced`: zero `work_policy_presence` rows point to this location.
 */
export async function classifyLocationPolicyReferencesInTx(
	tx: LocationTransaction,
	input: {
		organizationId: string;
		locationId: string;
		asOfDate: string;
	},
): Promise<LocationPolicyReferenceClassification> {
	const result = await tx.execute(sql`
		WITH ranked_versions AS (
			SELECT
				v."id" AS "versionId",
				v."policy_id" AS "policyId",
				v."effective_from_date"::text AS "effectiveFromDate",
				v."presence_enabled" AS "presenceEnabled",
				ROW_NUMBER() OVER (
					PARTITION BY v."policy_id", v."effective_from_date"
					ORDER BY v."version_number" DESC
				) AS "sameDayRank",
				CASE
					WHEN v."effective_from_date" <= ${input.asOfDate}::date THEN
						ROW_NUMBER() OVER (
							PARTITION BY v."policy_id", (v."effective_from_date" <= ${input.asOfDate}::date)
							ORDER BY v."effective_from_date" DESC, v."version_number" DESC
						)
					ELSE NULL
				END AS "currentRank"
			FROM "work_policy_version" v
			WHERE v."organization_id" = ${input.organizationId}
		)
		SELECT
			wpp."id" AS "presenceId",
			wpp."policy_id" AS "policyId",
			wpp."policy_version_id" AS "policyVersionId",
			wp."name" AS "policyName",
			wp."is_active" AS "policyIsActive",
			wp."presence_enabled" AS "legacyPresenceEnabled",
			rv."effectiveFromDate",
			rv."presenceEnabled" AS "versionPresenceEnabled",
			rv."sameDayRank",
			rv."currentRank"
		FROM "work_policy_presence" wpp
		INNER JOIN "work_policy" wp
			ON wp."id" = wpp."policy_id"
			AND wp."organization_id" = ${input.organizationId}
		LEFT JOIN ranked_versions rv
			ON rv."versionId" = wpp."policy_version_id"
		WHERE wpp."location_id" = ${input.locationId}::uuid
	`);

	const rows = toRows(result);
	if (rows.length === 0) {
		return { kind: "unreferenced" };
	}

	const blockingById = new Map<string, string>();
	for (const row of rows) {
		const policyId = String(row.policyId);
		const policyName = String(row.policyName);
		const policyIsActive = Boolean(row.policyIsActive);
		if (!policyIsActive) continue;

		const hasVersion = row.policyVersionId !== null && row.policyVersionId !== undefined;
		if (hasVersion) {
			const versionPresenceEnabled = Boolean(row.versionPresenceEnabled);
			if (!versionPresenceEnabled) continue;
			const currentRank =
				row.currentRank === null || row.currentRank === undefined ? null : Number(row.currentRank);
			const sameDayRank =
				row.sameDayRank === null || row.sameDayRank === undefined ? null : Number(row.sameDayRank);
			const effectiveFromDate =
				typeof row.effectiveFromDate === "string" ? row.effectiveFromDate : null;
			const isCurrent = currentRank === 1;
			const isFutureActive =
				effectiveFromDate !== null && effectiveFromDate > input.asOfDate && sameDayRank === 1;
			if (isCurrent || isFutureActive) {
				blockingById.set(policyId, policyName);
			}
		} else if (row.legacyPresenceEnabled) {
			blockingById.set(policyId, policyName);
		}
	}

	if (blockingById.size > 0) {
		const blockingPolicies = [...blockingById.entries()]
			.map(([id, name]) => ({ id, name }))
			.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
		return { kind: "active_or_future", blockingPolicies };
	}

	return { kind: "historical_only", historicalReferenceCount: rows.length };
}

async function resolveAsOfDate(
	tx: LocationTransaction,
	organizationId: string,
	asOfDate?: string,
): Promise<string> {
	if (asOfDate) return asOfDate;
	const timezone = await loadOrganizationTimezone(tx, organizationId);
	return plainDateAt(systemClock.nowInstant(), timezone).toString();
}

export async function updateLocationInTx(
	tx: LocationTransaction,
	input: {
		organizationId: string;
		locationId: string;
		actorUserId: string;
		data: {
			name?: string;
			street?: string | null;
			city?: string | null;
			postalCode?: string | null;
			country?: string | null;
			isActive?: boolean;
		};
		asOfDate?: string;
	},
): Promise<{ existingName: string; updatedName: string }> {
	const existing = await lockLocationForUpdateInTx(tx, {
		organizationId: input.organizationId,
		locationId: input.locationId,
	});
	if (!existing) {
		throw new NotFoundError({
			message: "Location not found",
			entityType: "location",
			entityId: input.locationId,
		});
	}

	if (existing.isActive && input.data.isActive === false) {
		const asOfDate = await resolveAsOfDate(tx, input.organizationId, input.asOfDate);
		const classification = await classifyLocationPolicyReferencesInTx(tx, {
			organizationId: input.organizationId,
			locationId: input.locationId,
			asOfDate,
		});
		if (classification.kind === "active_or_future") {
			const policyNames = classification.blockingPolicies.map((p) => p.name);
			throw new ValidationError({
				message: `Cannot deactivate location because it is required by active or scheduled work policies: ${policyNames.join(", ")}`,
				field: "isActive",
				refusal: "location_in_use_by_work_policy",
				value: { blockingPolicies: classification.blockingPolicies },
			});
		}
	}

	if (input.data.name && input.data.name !== existing.name) {
		const duplicate = await tx.query.location.findFirst({
			where: and(
				eq(location.organizationId, input.organizationId),
				eq(location.name, input.data.name),
			),
		});
		if (duplicate && duplicate.id !== input.locationId) {
			throw new ConflictError({
				message: "A location with this name already exists",
				conflictType: "duplicate_name",
				details: { field: "name" },
			});
		}
	}

	await tx
		.update(location)
		.set({ ...input.data, updatedBy: input.actorUserId, updatedAt: currentTimestamp() })
		.where(
			and(eq(location.id, input.locationId), eq(location.organizationId, input.organizationId)),
		);

	return {
		existingName: existing.name,
		updatedName: input.data.name ?? existing.name,
	};
}

export async function deleteOrArchiveLocationInTx(
	tx: LocationTransaction,
	input: {
		organizationId: string;
		locationId: string;
		actorUserId: string;
		asOfDate?: string;
	},
): Promise<DeleteLocationOutcome> {
	const existing = await lockLocationForUpdateInTx(tx, {
		organizationId: input.organizationId,
		locationId: input.locationId,
	});
	if (!existing) {
		throw new NotFoundError({
			message: "Location not found",
			entityType: "location",
			entityId: input.locationId,
		});
	}

	const asOfDate = await resolveAsOfDate(tx, input.organizationId, input.asOfDate);
	const classification = await classifyLocationPolicyReferencesInTx(tx, {
		organizationId: input.organizationId,
		locationId: input.locationId,
		asOfDate,
	});

	if (classification.kind === "active_or_future") {
		const policyNames = classification.blockingPolicies.map((p) => p.name);
		throw new ValidationError({
			message: `Cannot delete location because it is required by active or scheduled work policies: ${policyNames.join(", ")}`,
			refusal: "location_in_use_by_work_policy",
			value: { blockingPolicies: classification.blockingPolicies },
		});
	}

	if (classification.kind === "historical_only") {
		await tx
			.update(location)
			.set({
				isActive: false,
				updatedBy: input.actorUserId,
				updatedAt: currentTimestamp(),
			})
			.where(
				and(eq(location.id, input.locationId), eq(location.organizationId, input.organizationId)),
			);
		return {
			outcome: "archived",
			id: input.locationId,
			name: existing.name,
			historicalReferenceCount: classification.historicalReferenceCount,
		};
	}

	await tx
		.delete(location)
		.where(
			and(eq(location.id, input.locationId), eq(location.organizationId, input.organizationId)),
		);

	return {
		outcome: "deleted",
		id: input.locationId,
		name: existing.name,
	};
}

export async function updateLocationGuarded(
	db: DatabaseClient,
	input: Parameters<typeof updateLocationInTx>[1],
) {
	return db.transaction((tx) => updateLocationInTx(tx, input), {
		isolationLevel: "read committed",
	});
}

export async function deleteOrArchiveLocationGuarded(
	db: DatabaseClient,
	input: Parameters<typeof deleteOrArchiveLocationInTx>[1],
) {
	return db.transaction((tx) => deleteOrArchiveLocationInTx(tx, input), {
		isolationLevel: "read committed",
	});
}
