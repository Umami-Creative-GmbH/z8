/**
 * Vault Key Manager for Audit Export
 * Manages Ed25519 signing keys in HashiCorp Vault
 */
import { db, auditSigningKey } from "@/db";
import { eq, and, desc } from "drizzle-orm";
import { createLogger } from "@/lib/logger";
import { getOrgSecret, storeOrgSecret, deleteOrgSecret } from "@/lib/vault";
import { signingProvider, type ISigningProvider } from "../crypto/signing-provider";

const logger = createLogger("AuditKeyManager");

// Vault paths for audit signing keys
const VAULT_PATHS = {
	privateKey: "audit/signing_key_private",
	publicKey: "audit/signing_key_public",
} as const;

// ============================================
// INTERFACE
// ============================================

export interface IKeyManager {
	/**
	 * Get or create signing key for organization
	 * Returns existing active key or generates new one
	 */
	getOrCreateSigningKey(organizationId: string): Promise<{
		keyId: string;
		publicKeyPem: string;
		fingerprint: string;
	}>;

	/**
	 * Get private key for signing (from Vault)
	 */
	getPrivateKey(organizationId: string): Promise<string | null>;

	/**
	 * Get public key by key ID (from database)
	 */
	getPublicKeyById(keyId: string): Promise<string | null>;

	/**
	 * Get active signing key for organization
	 */
	getActiveKey(organizationId: string): Promise<{
		keyId: string;
		publicKeyPem: string;
		fingerprint: string;
		version: number;
	} | null>;

	/**
	 * Rotate signing key (archive old, create new)
	 */
	rotateKey(organizationId: string): Promise<{
		keyId: string;
		publicKeyPem: string;
		fingerprint: string;
		version: number;
	}>;

	/**
	 * Verify a key exists and is valid
	 */
	verifyKeyExists(organizationId: string): Promise<boolean>;

	/**
	 * Get all signing keys for an organization (active and archived)
	 */
	getAllKeys(organizationId: string): Promise<
		Array<{
			keyId: string;
			fingerprint: string;
			version: number;
			isActive: boolean;
			createdAt: Date;
		}>
	>;
}

// ============================================
// IMPLEMENTATION
// ============================================

export class VaultKeyManager implements IKeyManager {
	constructor(private readonly signing: ISigningProvider = signingProvider) {}

	/**
	 * Get or create signing key for organization
	 */
	async getOrCreateSigningKey(organizationId: string): Promise<{
		keyId: string;
		publicKeyPem: string;
		fingerprint: string;
	}> {
		// Check for existing active key
		const existingKey = await this.getActiveKey(organizationId);
		if (existingKey) {
			logger.info(
				{ organizationId, keyId: existingKey.keyId, fingerprint: existingKey.fingerprint },
				"Using existing signing key",
			);
			return existingKey;
		}

		// Generate new key pair
		logger.info({ organizationId }, "Generating new Ed25519 signing key");
		const { privateKeyPem, publicKeyPem, fingerprint } = await this.signing.generateKeyPair();

		// Store private key in Vault
		await storeOrgSecret(organizationId, VAULT_PATHS.privateKey, privateKeyPem);

		// Store public key in Vault (for backup)
		await storeOrgSecret(organizationId, VAULT_PATHS.publicKey, publicKeyPem);

		// Store public key and metadata in database
		const [keyRecord] = await db
			.insert(auditSigningKey)
			.values({
				organizationId,
				publicKey: publicKeyPem,
				algorithm: "Ed25519",
				fingerprint,
				version: 1,
				isActive: true,
			})
			.returning();

		logger.info(
			{ organizationId, keyId: keyRecord.id, fingerprint },
			"Created new signing key",
		);

		return {
			keyId: keyRecord.id,
			publicKeyPem,
			fingerprint,
		};
	}

	/**
	 * Get private key from Vault
	 */
	async getPrivateKey(organizationId: string): Promise<string | null> {
		return getOrgSecret(organizationId, VAULT_PATHS.privateKey);
	}

	/**
	 * Get public key by key ID from database
	 */
	async getPublicKeyById(keyId: string): Promise<string | null> {
		const key = await db.query.auditSigningKey.findFirst({
			where: eq(auditSigningKey.id, keyId),
		});

		return key?.publicKey ?? null;
	}

	/**
	 * Get active signing key for organization
	 */
	async getActiveKey(organizationId: string): Promise<{
		keyId: string;
		publicKeyPem: string;
		fingerprint: string;
		version: number;
	} | null> {
		const key = await db.query.auditSigningKey.findFirst({
			where: and(
				eq(auditSigningKey.organizationId, organizationId),
				eq(auditSigningKey.isActive, true),
			),
		});

		if (!key) {
			return null;
		}

		return {
			keyId: key.id,
			publicKeyPem: key.publicKey,
			fingerprint: key.fingerprint,
			version: key.version,
		};
	}

	/**
	 * Rotate signing key
	 * Archives current key and creates a new one
	 */
	async rotateKey(organizationId: string): Promise<{
		keyId: string;
		publicKeyPem: string;
		fingerprint: string;
		version: number;
	}> {
		// Get current active key to determine next version
		const currentKey = await this.getActiveKey(organizationId);
		const nextVersion = (currentKey?.version ?? 0) + 1;

		// Archive current key if exists
		if (currentKey) {
			await db
				.update(auditSigningKey)
				.set({
					isActive: false,
					rotatedAt: new Date(),
				})
				.where(eq(auditSigningKey.id, currentKey.keyId));

			logger.info(
				{ organizationId, oldKeyId: currentKey.keyId },
				"Archived previous signing key",
			);
		}

		// Generate new key pair
		const { privateKeyPem, publicKeyPem, fingerprint } = await this.signing.generateKeyPair();

		// Store in Vault (overwrites old keys)
		await storeOrgSecret(organizationId, VAULT_PATHS.privateKey, privateKeyPem);
		await storeOrgSecret(organizationId, VAULT_PATHS.publicKey, publicKeyPem);

		// Store in database
		const [newKey] = await db
			.insert(auditSigningKey)
			.values({
				organizationId,
				publicKey: publicKeyPem,
				algorithm: "Ed25519",
				fingerprint,
				version: nextVersion,
				isActive: true,
			})
			.returning();

		logger.info(
			{ organizationId, keyId: newKey.id, fingerprint, version: nextVersion },
			"Created rotated signing key",
		);

		return {
			keyId: newKey.id,
			publicKeyPem,
			fingerprint,
			version: nextVersion,
		};
	}

	/**
	 * Verify key exists in both Vault and database
	 */
	async verifyKeyExists(organizationId: string): Promise<boolean> {
		const [dbKey, vaultPrivate] = await Promise.all([
			this.getActiveKey(organizationId),
			this.getPrivateKey(organizationId),
		]);

		return dbKey !== null && vaultPrivate !== null;
	}

	/**
	 * Get all keys for organization (including archived)
	 * Useful for verification of old packages
	 */
	async getAllKeys(organizationId: string): Promise<
		Array<{
			keyId: string;
			publicKeyPem: string;
			fingerprint: string;
			version: number;
			isActive: boolean;
			createdAt: Date;
		}>
	> {
		const keys = await db.query.auditSigningKey.findMany({
			where: eq(auditSigningKey.organizationId, organizationId),
			orderBy: [desc(auditSigningKey.version)],
		});

		return keys.map((k) => ({
			keyId: k.id,
			publicKeyPem: k.publicKey,
			fingerprint: k.fingerprint,
			version: k.version,
			isActive: k.isActive,
			createdAt: k.createdAt,
		}));
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const keyManager = new VaultKeyManager();
