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
// APPLICATION SERVICES
// ============================================
export {
	AuditExportOrchestrator,
	auditExportOrchestrator,
	type HardenExportParams,
	type HardenExportResult,
} from "./application/audit-export-orchestrator";
export {
	type AuditExportConfigData,
	ConfigurationService,
	configurationService,
	type UpdateConfigParams,
} from "./application/configuration-service";

export {
	VerificationService,
	type VerifyPackageParams,
	verificationService,
} from "./application/verification-service";
// ============================================
// DOMAIN SERVICES
// ============================================
export { type IManifestBuilder, ManifestBuilder, manifestBuilder } from "./domain/manifest-builder";
// ============================================
// DOMAIN MODELS
// ============================================
export {
	AuditFileEntry,
	AuditManifest,
	Ed25519Signature,
	RFC3161Timestamp,
	SHA256Hash,
	SignedAuditPackage,
	type VerificationCheck,
	type VerificationResult,
} from "./domain/models";

export { type ISigningService, SigningService, signingService } from "./domain/signing-service";

export {
	type ITimestampService,
	TimestampService,
	timestampService,
} from "./domain/timestamp-service";

// ============================================
// INFRASTRUCTURE (for advanced usage)
// ============================================
export { hashProvider, type IHashProvider } from "./infrastructure/crypto/hash-provider";

export { type ISigningProvider, signingProvider } from "./infrastructure/crypto/signing-provider";

export {
	type ITimestampProvider,
	timestampProvider,
} from "./infrastructure/crypto/timestamp-provider";
export {
	type IWORMStorageAdapter,
	S3WORMStorageAdapter,
	wormStorageAdapter,
} from "./infrastructure/storage/worm-storage-adapter";
export { type IKeyManager, keyManager } from "./infrastructure/vault/key-manager";
