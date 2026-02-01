/**
 * Configuration Service
 * Manages audit export configuration for organizations
 */
import { eq } from "drizzle-orm";
import { db, auditExportConfig, auditSigningKey } from "@/db";
import { createLogger } from "@/lib/logger";
import { keyManager, type IKeyManager } from "../infrastructure/vault/key-manager";
import { wormStorageAdapter, type IWORMStorageAdapter } from "../infrastructure/storage/worm-storage-adapter";

const logger = createLogger("AuditConfigurationService");

// ============================================
// TYPES
// ============================================

export interface AuditExportConfigData {
	retentionYears: number;
	retentionMode: "governance" | "compliance";
	autoEnableDataExports: boolean;
	autoEnablePayrollExports: boolean;
	isEnabled: boolean;
	objectLockSupported: boolean;
	signingKeyFingerprint?: string;
	signingKeyVersion?: number;
}

export interface UpdateConfigParams {
	organizationId: string;
	updatedBy: string;
	retentionYears?: number;
	retentionMode?: "governance" | "compliance";
	autoEnableDataExports?: boolean;
	autoEnablePayrollExports?: boolean;
}

// ============================================
// SERVICE
// ============================================

export class ConfigurationService {
	constructor(
		private readonly keys: IKeyManager = keyManager,
		private readonly storage: IWORMStorageAdapter = wormStorageAdapter,
	) {}

	/**
	 * Get audit export configuration for organization
	 */
	async getConfig(organizationId: string): Promise<AuditExportConfigData | null> {
		const config = await db.query.auditExportConfig.findFirst({
			where: eq(auditExportConfig.organizationId, organizationId),
		});

		if (!config) {
			return null;
		}

		// Get active signing key info
		const activeKey = await this.keys.getActiveKey(organizationId);

		return {
			retentionYears: config.retentionYears,
			retentionMode: config.retentionMode as "governance" | "compliance",
			autoEnableDataExports: config.autoEnableDataExports,
			autoEnablePayrollExports: config.autoEnablePayrollExports,
			isEnabled: config.isEnabled,
			objectLockSupported: config.objectLockSupported,
			signingKeyFingerprint: activeKey?.fingerprint,
			signingKeyVersion: activeKey?.version,
		};
	}

	/**
	 * Create or update audit export configuration
	 */
	async updateConfig(params: UpdateConfigParams): Promise<AuditExportConfigData> {
		const { organizationId, updatedBy, ...updates } = params;

		logger.info({ organizationId, updates }, "Updating audit export configuration");

		// Validate retention years
		if (updates.retentionYears !== undefined) {
			if (updates.retentionYears < 1 || updates.retentionYears > 10) {
				throw new Error("Retention years must be between 1 and 10");
			}
		}

		// Check for existing config
		const existing = await db.query.auditExportConfig.findFirst({
			where: eq(auditExportConfig.organizationId, organizationId),
		});

		if (existing) {
			// Update existing
			await db
				.update(auditExportConfig)
				.set({
					...(updates.retentionYears !== undefined && { retentionYears: updates.retentionYears }),
					...(updates.retentionMode !== undefined && { retentionMode: updates.retentionMode }),
					...(updates.autoEnableDataExports !== undefined && {
						autoEnableDataExports: updates.autoEnableDataExports,
					}),
					...(updates.autoEnablePayrollExports !== undefined && {
						autoEnablePayrollExports: updates.autoEnablePayrollExports,
					}),
				})
				.where(eq(auditExportConfig.id, existing.id));
		} else {
			// Create new
			await db.insert(auditExportConfig).values({
				organizationId,
				retentionYears: updates.retentionYears ?? 10,
				retentionMode: updates.retentionMode ?? "governance",
				autoEnableDataExports: updates.autoEnableDataExports ?? false,
				autoEnablePayrollExports: updates.autoEnablePayrollExports ?? false,
				isEnabled: true,
				createdBy: updatedBy,
			});
		}

		logger.info({ organizationId }, "Configuration updated successfully");

		return (await this.getConfig(organizationId))!;
	}

	/**
	 * Initialize audit export for organization
	 * Creates config and generates signing key
	 */
	async initialize(
		organizationId: string,
		createdBy: string,
	): Promise<{
		config: AuditExportConfigData;
		signingKeyFingerprint: string;
	}> {
		logger.info({ organizationId }, "Initializing audit export");

		// Check S3 Object Lock support
		const objectLockSupported = await this.storage.checkObjectLockSupport(organizationId);

		// Create config if not exists
		const existing = await db.query.auditExportConfig.findFirst({
			where: eq(auditExportConfig.organizationId, organizationId),
		});

		if (!existing) {
			await db.insert(auditExportConfig).values({
				organizationId,
				retentionYears: 10,
				retentionMode: "governance",
				autoEnableDataExports: false,
				autoEnablePayrollExports: false,
				isEnabled: true,
				objectLockSupported,
				objectLockCheckedAt: new Date(),
				createdBy,
			});
		} else {
			// Update Object Lock status
			await db
				.update(auditExportConfig)
				.set({
					objectLockSupported,
					objectLockCheckedAt: new Date(),
				})
				.where(eq(auditExportConfig.id, existing.id));
		}

		// Generate signing key
		const { keyId, fingerprint } = await this.keys.getOrCreateSigningKey(organizationId);

		const config = await this.getConfig(organizationId);

		logger.info(
			{ organizationId, objectLockSupported, keyFingerprint: fingerprint },
			"Audit export initialized",
		);

		return {
			config: config!,
			signingKeyFingerprint: fingerprint,
		};
	}

	/**
	 * Rotate signing key for organization
	 */
	async rotateSigningKey(organizationId: string): Promise<{
		fingerprint: string;
		version: number;
	}> {
		logger.info({ organizationId }, "Rotating signing key");

		const { fingerprint, version } = await this.keys.rotateKey(organizationId);

		logger.info({ organizationId, fingerprint, version }, "Signing key rotated");

		return { fingerprint, version };
	}

	/**
	 * Get signing key history for organization
	 */
	async getSigningKeyHistory(
		organizationId: string,
	): Promise<
		Array<{
			keyId: string;
			fingerprint: string;
			version: number;
			isActive: boolean;
			createdAt: Date;
		}>
	> {
		return this.keys.getAllKeys(organizationId);
	}

	/**
	 * Export public key for external verification
	 */
	async exportPublicKey(organizationId: string): Promise<{
		publicKeyPem: string;
		fingerprint: string;
		algorithm: string;
		version: number;
	} | null> {
		const activeKey = await this.keys.getActiveKey(organizationId);

		if (!activeKey) {
			return null;
		}

		return {
			publicKeyPem: activeKey.publicKeyPem,
			fingerprint: activeKey.fingerprint,
			algorithm: "Ed25519",
			version: activeKey.version,
		};
	}

	/**
	 * Check if audit export is enabled and configured
	 */
	async isEnabled(organizationId: string): Promise<boolean> {
		const config = await db.query.auditExportConfig.findFirst({
			where: eq(auditExportConfig.organizationId, organizationId),
		});

		return config?.isEnabled ?? false;
	}

	/**
	 * Check if auto-audit is enabled for a specific export type
	 */
	async isAutoAuditEnabled(
		organizationId: string,
		exportType: "data" | "payroll",
	): Promise<boolean> {
		const config = await db.query.auditExportConfig.findFirst({
			where: eq(auditExportConfig.organizationId, organizationId),
		});

		if (!config?.isEnabled) {
			return false;
		}

		return exportType === "data" ? config.autoEnableDataExports : config.autoEnablePayrollExports;
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const configurationService = new ConfigurationService();
