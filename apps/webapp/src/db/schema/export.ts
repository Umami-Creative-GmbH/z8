import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { exportStatusEnum } from "./enums";
import { employee } from "./organization";

// ============================================
// DATA EXPORT
// ============================================

// Tracks data export requests for organizations
export const dataExport = pgTable(
	"data_export",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestedById: uuid("requested_by_id")
			.notNull()
			.references(() => employee.id, { onDelete: "cascade" }),

		// Export configuration
		categories: text("categories").array().notNull(), // ['employees', 'teams', 'time_entries', ...]

		// Status tracking
		status: exportStatusEnum("status").default("pending").notNull(),
		errorMessage: text("error_message"),

		// S3 storage
		s3Key: text("s3_key"), // Path in S3 bucket
		fileSizeBytes: integer("file_size_bytes"),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		completedAt: timestamp("completed_at"),
		expiresAt: timestamp("expires_at"), // When S3 object should be deleted
	},
	(table) => [
		index("dataExport_organizationId_idx").on(table.organizationId),
		index("dataExport_requestedById_idx").on(table.requestedById),
		index("dataExport_status_idx").on(table.status),
		index("dataExport_createdAt_idx").on(table.createdAt),
	],
);

// S3 storage configuration for data exports (per organization)
// NOTE: Secrets (accessKeyId, secretAccessKey) are stored in Vault at:
//   - secret/data/organizations/{orgId}/storage/access_key_id
//   - secret/data/organizations/{orgId}/storage/secret_access_key
export const exportStorageConfig = pgTable(
	"export_storage_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(), // One config per organization

		// S3 non-secret config (secrets stored in Vault)
		bucket: text("bucket").notNull(),
		region: text("region").default("us-east-1").notNull(),
		endpoint: text("endpoint"), // Custom endpoint for MinIO/compatible services

		// Validation
		isVerified: boolean("is_verified").default(false).notNull(),
		lastVerifiedAt: timestamp("last_verified_at"),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [index("exportStorageConfig_organizationId_idx").on(table.organizationId)],
);
