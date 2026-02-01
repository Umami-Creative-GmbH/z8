/**
 * Audit Export Module
 *
 * Provides GoBD-compliant audit hardening for exports:
 * - SHA-256 per-file hashes with Merkle tree
 * - Ed25519 digital signatures
 * - RFC 3161 trusted timestamps
 * - S3 Object Lock WORM retention
 */

// ============================================
// DOMAIN MODELS
// ============================================
export {
	SHA256Hash,
	Ed25519Signature,
	RFC3161Timestamp,
	AuditFileEntry,
	AuditManifest,
	SignedAuditPackage,
	type VerificationCheck,
	type VerificationResult,
} from "./domain/models";

// ============================================
// APPLICATION SERVICES
// ============================================
export {
	AuditExportOrchestrator,
	auditExportOrchestrator,
	type HardenExportParams,
	type HardenExportResult,
} from "./application/audit-export-orchestrator";

export {
	VerificationService,
	verificationService,
	type VerifyPackageParams,
} from "./application/verification-service";

export {
	ConfigurationService,
	configurationService,
	type AuditExportConfigData,
	type UpdateConfigParams,
} from "./application/configuration-service";

// ============================================
// DOMAIN SERVICES
// ============================================
export { ManifestBuilder, manifestBuilder, type IManifestBuilder } from "./domain/manifest-builder";

export { SigningService, signingService, type ISigningService } from "./domain/signing-service";

export { TimestampService, timestampService, type ITimestampService } from "./domain/timestamp-service";

// ============================================
// INFRASTRUCTURE (for advanced usage)
// ============================================
export { hashProvider, type IHashProvider } from "./infrastructure/crypto/hash-provider";

export { signingProvider, type ISigningProvider } from "./infrastructure/crypto/signing-provider";

export { timestampProvider, type ITimestampProvider } from "./infrastructure/crypto/timestamp-provider";

export { keyManager, type IKeyManager } from "./infrastructure/vault/key-manager";

export {
	wormStorageAdapter,
	S3WORMStorageAdapter,
	type IWORMStorageAdapter,
} from "./infrastructure/storage/worm-storage-adapter";
