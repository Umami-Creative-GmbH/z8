import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, sql } from "drizzle-orm";
import type { db as database } from "@/db";
import {
	equipmentItem,
	equipmentPolicy,
	equipmentSetupCommand,
	equipmentType,
} from "@/db/schema/equipment";
import { dateFromInstant, systemClock } from "@/lib/datetime/temporal-core";
import { AuthorizationError } from "@/lib/effect/errors";
import { lockLifecycleOrganization } from "@/lib/employee-lifecycle/locks";
import {
	holdGuard,
	userConfigurationAccessGuard,
} from "@/lib/time-tracking/work-transaction/ranks";
import { type EquipmentActor, equipmentAccess } from "./access";
import {
	type EquipmentItemView,
	type EquipmentSetupDetail,
	type EquipmentSetupDetailInput,
	type EquipmentSetupOutcome,
	type EquipmentSetupView,
	type EquipmentTypeView,
	equipmentSetupChangeSchema,
} from "./contracts";

function typeView(type: typeof equipmentType.$inferSelect): EquipmentTypeView {
	return {
		id: type.id,
		name: type.name,
		trackingMode: type.trackingMode,
		defaultReturnRequired: type.defaultReturnRequired,
		revision: type.revision,
		used: type.usedAt !== null,
		archived: type.archivedAt !== null,
	};
}
function itemView(item: typeof equipmentItem.$inferSelect): EquipmentItemView {
	return {
		id: item.id,
		typeId: item.typeId,
		identifier: item.identifier,
		serialNumber: item.serialNumber,
		status: item.status,
		inCustody: item.inCustody,
		archived: item.archivedAt !== null,
		revision: item.revision,
	};
}

export async function readEquipmentSetupDetail(
	db: Pick<typeof database, "select">,
	organizationId: string,
	input: EquipmentSetupDetailInput,
): Promise<EquipmentSetupDetail | null> {
	if (input.kind === "type") {
		const [type] = await db
			.select()
			.from(equipmentType)
			.where(
				and(
					eq(equipmentType.organizationId, organizationId),
					eq(equipmentType.id, input.id),
				),
			);
		return type ? { kind: "type", record: typeView(type) } : null;
	}
	const [item] = await db
		.select()
		.from(equipmentItem)
		.where(
			and(
				eq(equipmentItem.organizationId, organizationId),
				eq(equipmentItem.id, input.id),
			),
		);
	return item ? { kind: "item", record: itemView(item) } : null;
}

export type EquipmentTransaction = Parameters<
	Parameters<typeof database.transaction>[0]
>[0];
/** Serialize equipment writes. Cross-context writers must take lifecycle locks before this lock. */
export async function lockEquipmentOrganization(
	tx: Pick<EquipmentTransaction, "execute">,
	organizationId: string,
) {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`equipment:${organizationId}`}, 0))`,
	);
}

export async function readEquipmentSetup(
	db: Pick<typeof database, "select">,
	organizationId: string,
): Promise<EquipmentSetupView> {
	const [policies, types, items] = await Promise.all([
		db
			.select({
				retentionMonths: equipmentPolicy.retentionMonths,
				revision: equipmentPolicy.revision,
			})
			.from(equipmentPolicy)
			.where(eq(equipmentPolicy.organizationId, organizationId)),
		db
			.select()
			.from(equipmentType)
			.where(eq(equipmentType.organizationId, organizationId))
			.orderBy(asc(equipmentType.name), asc(equipmentType.id)),
		db
			.select()
			.from(equipmentItem)
			.where(eq(equipmentItem.organizationId, organizationId))
			.orderBy(asc(equipmentItem.identifier), asc(equipmentItem.id)),
	]);
	const views = types.map(typeView);
	return {
		policy: policies[0] ?? null,
		types: views,
		selectableTypes: views.filter((type) => !type.archived),
		items: items.map(itemView),
	};
}

/**
 * Issuance seam: call inside the assignment transaction, after authorizing the actor.
 * Takes the organization lock, requires policy and an active type, and permanently
 * fixes its mode. Copy the returned defaults onto the assignment; never join a live
 * default to interpret an existing agreement. Rollback undoes the use marker too.
 */
export async function prepareEquipmentTypeForIssuance(
	tx: EquipmentTransaction,
	input: { organizationId: string; typeId: string },
) {
	await lockEquipmentOrganization(tx, input.organizationId);
	const [policy] = await tx
		.select()
		.from(equipmentPolicy)
		.where(eq(equipmentPolicy.organizationId, input.organizationId));
	if (!policy) return { ok: false, reason: "policy_required" } as const;
	const [type] = await tx
		.select()
		.from(equipmentType)
		.where(
			and(
				eq(equipmentType.organizationId, input.organizationId),
				eq(equipmentType.id, input.typeId),
			),
		);
	if (!type) return { ok: false, reason: "not_found" } as const;
	if (type.archivedAt) return { ok: false, reason: "archived" } as const;
	if (!type.usedAt)
		await tx
			.update(equipmentType)
			.set({
				usedAt: dateFromInstant(systemClock.nowInstant()),
				revision: type.revision + 1,
			})
			.where(
				and(
					eq(equipmentType.id, type.id),
					eq(equipmentType.organizationId, input.organizationId),
				),
			);
	return {
		ok: true,
		typeId: type.id,
		trackingMode: type.trackingMode,
		defaultReturnRequired: type.defaultReturnRequired,
	} as const;
}

export async function applyEquipmentSetupChange(
	db: typeof database,
	actor: EquipmentActor,
	input: unknown,
): Promise<EquipmentSetupOutcome> {
	const parsed = equipmentSetupChangeSchema.safeParse(input);
	if (!parsed.success) return { ok: false, reason: "invalid_input" };
	const change = parsed.data;
	const fingerprint = createHash("sha256")
		.update(JSON.stringify({ actor: actor.userId, change }))
		.digest("hex");
	try {
		return await db.transaction(async (tx): Promise<EquipmentSetupOutcome> => {
			// Organization FK inserts must not wait for lifecycle while holding equipment.
			await holdGuard(tx, userConfigurationAccessGuard(actor.userId));
			await lockLifecycleOrganization(tx, actor.organizationId);
			await lockEquipmentOrganization(tx, actor.organizationId);
			if (!(await equipmentAccess(tx, actor)).canAdminister)
				throw new AuthorizationError({
					message: "Equipment setup is not available.",
					resource: "equipment",
					action: "manage",
				});
			const [replay] = await tx
				.select()
				.from(equipmentSetupCommand)
				.where(
					and(
						eq(equipmentSetupCommand.organizationId, actor.organizationId),
						eq(equipmentSetupCommand.requestId, change.requestId),
					),
				);
			if (replay)
				return replay.fingerprint === fingerprint
					? replay.result
					: { ok: false, reason: "request_conflict" };
			const now = dateFromInstant(systemClock.nowInstant());
			const audit = { updatedAt: now, updatedBy: actor.userId };
			let result: { id: string; revision: number };
			if (change.kind === "configure_policy") {
				const [policy] = await tx
					.select()
					.from(equipmentPolicy)
					.where(eq(equipmentPolicy.organizationId, actor.organizationId));
				if ((policy?.revision ?? 0) !== change.expectedRevision)
					return { ok: false, reason: "stale_revision" };
				const revision = (policy?.revision ?? 0) + 1;
				await tx
					.insert(equipmentPolicy)
					.values({
						organizationId: actor.organizationId,
						retentionMonths: change.retentionMonths,
						revision,
						...audit,
					})
					.onConflictDoUpdate({
						target: equipmentPolicy.organizationId,
						set: {
							retentionMonths: change.retentionMonths,
							revision,
							...audit,
						},
					});
				result = { id: actor.organizationId, revision };
			} else if (change.kind === "create_type") {
				const [type] = await tx
					.insert(equipmentType)
					.values({
						organizationId: actor.organizationId,
						name: change.name,
						trackingMode: change.trackingMode,
						defaultReturnRequired: change.defaultReturnRequired,
						createdBy: actor.userId,
						createdAt: now,
						...audit,
					})
					.returning();
				result = type;
			} else if (
				change.kind === "update_type" ||
				change.kind === "archive_type"
			) {
				const where = and(
					eq(equipmentType.organizationId, actor.organizationId),
					eq(equipmentType.id, change.id),
				);
				const [type] = await tx.select().from(equipmentType).where(where);
				if (!type) return { ok: false, reason: "not_found" };
				if (type.revision !== change.expectedRevision)
					return { ok: false, reason: "stale_revision" };
				if (type.archivedAt) return { ok: false, reason: "archived" };
				if (
					change.kind === "update_type" &&
					type.usedAt &&
					type.trackingMode !== change.trackingMode
				)
					return { ok: false, reason: "tracking_mode_fixed" };
				const [updated] = await tx
					.update(equipmentType)
					.set({
						...(change.kind === "archive_type"
							? { archivedAt: now }
							: {
									name: change.name,
									trackingMode: change.trackingMode,
									defaultReturnRequired: change.defaultReturnRequired,
								}),
						revision: type.revision + 1,
						...audit,
					})
					.where(where)
					.returning();
				result = updated;
			} else if (change.kind === "register_item") {
				const [type] = await tx
					.select()
					.from(equipmentType)
					.where(
						and(
							eq(equipmentType.organizationId, actor.organizationId),
							eq(equipmentType.id, change.typeId),
						),
					);
				if (type && type.trackingMode !== "individual")
					return { ok: false, reason: "individual_required" };
				const used = await prepareEquipmentTypeForIssuance(tx, {
					organizationId: actor.organizationId,
					typeId: change.typeId,
				});
				if (!used.ok) return used;
				if (used.trackingMode !== "individual")
					return { ok: false, reason: "individual_required" };
				const [item] = await tx
					.insert(equipmentItem)
					.values({
						organizationId: actor.organizationId,
						typeId: change.typeId,
						identifier: change.identifier,
						serialNumber: change.serialNumber || null,
						createdBy: actor.userId,
						createdAt: now,
						...audit,
					})
					.returning();
				result = item;
			} else {
				const where = and(
					eq(equipmentItem.organizationId, actor.organizationId),
					eq(equipmentItem.id, change.id),
				);
				const [item] = await tx.select().from(equipmentItem).where(where);
				if (!item) return { ok: false, reason: "not_found" };
				if (item.revision !== change.expectedRevision)
					return { ok: false, reason: "stale_revision" };
				if (item.archivedAt) return { ok: false, reason: "archived" };
				const [updated] = await tx
					.update(equipmentItem)
					.set({ archivedAt: now, revision: item.revision + 1, ...audit })
					.where(where)
					.returning();
				result = updated;
			}
			const outcome = {
				ok: true,
				id: result.id,
				revision: result.revision,
			} as const;
			await tx.insert(equipmentSetupCommand).values({
				organizationId: actor.organizationId,
				requestId: change.requestId,
				fingerprint,
				result: outcome,
			});
			return outcome;
		});
	} catch (error) {
		const cause =
			error && typeof error === "object" && "cause" in error
				? error.cause
				: error;
		if (
			cause &&
			typeof cause === "object" &&
			"code" in cause &&
			cause.code === "23505" &&
			"constraint" in cause &&
			cause.constraint === "equipment_item_identifier_org_unique"
		)
			return { ok: false, reason: "identifier_taken" };
		throw error;
	}
}
