import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

import { organization } from "../auth-schema";

export const secretStoreProviderEnum = pgEnum("secret_store_provider", ["vault", "scaleway"]);

export const organizationSecretKey = pgTable(
	"organization_secret_key",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		provider: secretStoreProviderEnum("provider").notNull(),
		scalewayKeyId: text("scaleway_key_id").notNull(),
		region: text("region").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		disabledAt: timestamp("disabled_at"),
	},
	(table) => [
		index("organizationSecretKey_organizationId_idx").on(table.organizationId),
		uniqueIndex("organizationSecretKey_org_provider_active_idx")
			.on(table.organizationId, table.provider)
			.where(sql`${table.disabledAt} IS NULL`),
		uniqueIndex("organizationSecretKey_scalewayKeyId_idx").on(table.scalewayKeyId),
	],
);

export const organizationSecret = pgTable(
	"organization_secret",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		key: text("key").notNull(),
		provider: secretStoreProviderEnum("provider").notNull(),
		kmsKeyId: text("kms_key_id").notNull(),
		ciphertext: text("ciphertext").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
	},
	(table) => [
		index("organizationSecret_organizationId_idx").on(table.organizationId),
		uniqueIndex("organizationSecret_org_key_idx").on(table.organizationId, table.key),
	],
);
