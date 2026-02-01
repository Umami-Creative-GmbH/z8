import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { currentTimestamp } from "@/lib/datetime/drizzle-adapter";

// Import auth tables for FK references
import { organization, user } from "../auth-schema";
import { employee } from "./organization";
import { dataExport } from "./export";
import { payrollExportJob } from "./payroll-export";

// ============================================
// AUDIT EXPORT ENUMS
// ============================================

/**
 * Audit export processing status
 */
export const auditExportStatusEnum = pgEnum("audit_export_status", [
	"pending",
	"building_manifest",
	"signing",
	"timestamping",
	"uploading",
	"completed",
	"failed",
]);

/**
 * WORM retention mode (S3 Object Lock)
 */
export const wormRetentionModeEnum = pgEnum("worm_retention_mode", [
	"governance", // Can be deleted by users with bypass permission
	"compliance", // Cannot be deleted or modified, period
]);

/**
 * Verification check types
 */
export const verificationCheckEnum = pgEnum("verification_check", [
	"file_hashes",
	"merkle_root",
	"signature",
	"timestamp",
	"worm_lock",
]);

// ============================================
// AUDIT EXPORT CONFIGURATION
// ============================================

/**
 * Per-organization audit export configuration
 * Controls retention policy, key management, and feature flags
 */
export const auditExportConfig = pgTable(
	"audit_export_config",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" })
			.unique(),

		// Retention settings (GoBD requires 10 years for tax data)
		retentionYears: integer("retention_years").notNull().default(10),
		retentionMode: wormRetentionModeEnum("retention_mode").notNull().default("governance"),

		// Feature flags for automatic audit hardening
		autoEnableDataExports: boolean("auto_enable_data_exports").default(false).notNull(),
		autoEnablePayrollExports: boolean("auto_enable_payroll_exports").default(false).notNull(),

		// S3 Object Lock capability detection
		objectLockSupported: boolean("object_lock_supported").default(false).notNull(),
		objectLockCheckedAt: timestamp("object_lock_checked_at"),

		// Feature status
		isEnabled: boolean("is_enabled").default(true).notNull(),

		// Audit
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at")
			.$onUpdate(() => currentTimestamp())
			.notNull(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [index("auditExportConfig_organizationId_idx").on(table.organizationId)],
);

// ============================================
// AUDIT SIGNING KEYS
// ============================================

/**
 * Ed25519 signing keys per organization
 * Public keys stored in DB for verification
 * Private keys stored in HashiCorp Vault at:
 *   secret/data/organizations/{orgId}/audit/signing_key_private
 */
export const auditSigningKey = pgTable(
	"audit_signing_key",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),

		// Key material (public key only - private in Vault)
		publicKey: text("public_key").notNull(), // Base64-encoded Ed25519 public key (SPKI format)
		algorithm: text("algorithm").notNull().default("Ed25519"),

		// Key fingerprint for easy identification
		fingerprint: text("fingerprint").notNull(), // SHA-256 of public key

		// Key version for rotation tracking
		version: integer("version").notNull().default(1),

		// Status
		isActive: boolean("is_active").default(true).notNull(),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		rotatedAt: timestamp("rotated_at"), // When this key was superseded
		archivedAt: timestamp("archived_at"), // When archived (no longer valid for new signatures)
	},
	(table) => [
		index("auditSigningKey_organizationId_idx").on(table.organizationId),
		index("auditSigningKey_isActive_idx").on(table.isActive),
		index("auditSigningKey_fingerprint_idx").on(table.fingerprint),
	],
);

// ============================================
// AUDIT EXPORT PACKAGES
// ============================================

/**
 * Main audit export package record
 * Represents a cryptographically signed and timestamped export
 */
export const auditExportPackage = pgTable(
	"audit_export_package",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		organizationId: text("organization_id")
			.notNull()
			.references(() => organization.id, { onDelete: "cascade" }),
		requestedById: text("requested_by_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),

		// Reference to source export (one of these will be set)
		dataExportId: uuid("data_export_id").references(() => dataExport.id, { onDelete: "cascade" }),
		payrollExportJobId: uuid("payroll_export_job_id").references(() => payrollExportJob.id, {
			onDelete: "cascade",
		}),

		// Export type for filtering
		exportType: text("export_type").notNull(), // "data" | "payroll"

		// Status tracking
		status: auditExportStatusEnum("status").default("pending").notNull(),
		errorMessage: text("error_message"),

		// S3 storage
		s3Key: text("s3_key"), // audit-exports/{orgId}/{date}/{id}.zip
		fileSizeBytes: integer("file_size_bytes"),

		// Cryptographic metadata (stored here for quick access, also in package)
		merkleRoot: text("merkle_root"), // SHA-256 Merkle root of all file hashes
		manifestHash: text("manifest_hash"), // SHA-256 of manifest.json
		fileCount: integer("file_count"),

		// Ed25519 Signature
		signatureAlgorithm: text("signature_algorithm").default("Ed25519"),
		signatureValue: text("signature_value"), // Base64-encoded Ed25519 signature
		signingKeyId: uuid("signing_key_id").references(() => auditSigningKey.id),
		signedAt: timestamp("signed_at"),

		// RFC 3161 Timestamp
		timestampToken: text("timestamp_token"), // Base64-encoded TSR response
		timestampedAt: timestamp("timestamped_at"), // Extracted timestamp value
		timestampAuthority: text("timestamp_authority").default("freetsa.org"),

		// WORM Retention
		retentionYears: integer("retention_years"),
		retentionUntil: timestamp("retention_until"),
		objectLockEnabled: boolean("object_lock_enabled").default(false),
		objectLockMode: wormRetentionModeEnum("object_lock_mode"),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
		processingStartedAt: timestamp("processing_started_at"),
		completedAt: timestamp("completed_at"),
	},
	(table) => [
		index("auditExportPackage_organizationId_idx").on(table.organizationId),
		index("auditExportPackage_dataExportId_idx").on(table.dataExportId),
		index("auditExportPackage_payrollExportJobId_idx").on(table.payrollExportJobId),
		index("auditExportPackage_status_idx").on(table.status),
		index("auditExportPackage_createdAt_idx").on(table.createdAt),
		index("auditExportPackage_merkleRoot_idx").on(table.merkleRoot),
	],
);

// ============================================
// AUDIT EXPORT FILES (per-file hashes)
// ============================================

/**
 * Individual file hashes within an audit package
 * Enables granular verification of specific files
 */
export const auditExportFile = pgTable(
	"audit_export_file",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		packageId: uuid("package_id")
			.notNull()
			.references(() => auditExportPackage.id, { onDelete: "cascade" }),

		// File metadata
		filePath: text("file_path").notNull(), // Path within ZIP (e.g., "data/employees.json")
		sha256Hash: text("sha256_hash").notNull(), // Hex-encoded SHA-256
		sizeBytes: integer("size_bytes").notNull(),

		// Position in Merkle tree (for proof generation)
		merkleIndex: integer("merkle_index").notNull(),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		index("auditExportFile_packageId_idx").on(table.packageId),
		index("auditExportFile_sha256Hash_idx").on(table.sha256Hash),
	],
);

// ============================================
// AUDIT VERIFICATION LOG
// ============================================

/**
 * Log of verification attempts for audit trail
 * Required for GoBD compliance to prove verification occurred
 */
export const auditVerificationLog = pgTable(
	"audit_verification_log",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		packageId: uuid("package_id")
			.notNull()
			.references(() => auditExportPackage.id, { onDelete: "cascade" }),

		// Verification result
		isValid: boolean("is_valid").notNull(),

		// Detailed check results
		checksPerformed: text("checks_performed").array().notNull(), // ["file_hashes", "merkle_root", "signature", "timestamp"]
		checksPassed: text("checks_passed").array().notNull(),
		checksFailed: text("checks_failed").array(),

		// Detailed errors (if any)
		errorDetails: jsonb("error_details").$type<
			Array<{
				check: string;
				message: string;
				expected?: string;
				actual?: string;
			}>
		>(),

		// Who verified
		verifiedById: text("verified_by_id").references(() => user.id),
		verificationSource: text("verification_source").default("ui"), // "ui" | "api" | "cli"

		// Client info (for external verifications)
		clientIp: text("client_ip"),
		userAgent: text("user_agent"),

		// Timestamps
		verifiedAt: timestamp("verified_at").defaultNow().notNull(),
	},
	(table) => [
		index("auditVerificationLog_packageId_idx").on(table.packageId),
		index("auditVerificationLog_isValid_idx").on(table.isValid),
		index("auditVerificationLog_verifiedAt_idx").on(table.verifiedAt),
	],
);
