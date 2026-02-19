/**
 * Domain models and value objects for audit export
 * Uses immutable value objects with validation
 */

// ============================================
// VALUE OBJECTS
// ============================================

/**
 * Represents a SHA-256 hash with format validation
 */
export class SHA256Hash {
	private readonly value: string;

	constructor(value: string) {
		if (!/^[a-f0-9]{64}$/i.test(value)) {
			throw new Error(`Invalid SHA-256 hash format: ${value.substring(0, 20)}...`);
		}
		this.value = value.toLowerCase();
	}

	toString(): string {
		return this.value;
	}

	equals(other: SHA256Hash): boolean {
		return this.value === other.value;
	}

	toJSON(): string {
		return this.value;
	}
}

/**
 * Represents an Ed25519 signature with public key
 */
export class Ed25519Signature {
	constructor(
		private readonly signatureBase64: string,
		private readonly publicKeyBase64: string,
	) {
		// Basic validation
		if (!signatureBase64 || signatureBase64.length === 0) {
			throw new Error("Signature cannot be empty");
		}
		if (!publicKeyBase64 || publicKeyBase64.length === 0) {
			throw new Error("Public key cannot be empty");
		}
	}

	getSignature(): string {
		return this.signatureBase64;
	}

	getPublicKey(): string {
		return this.publicKeyBase64;
	}

	toJSON(): { signature: string; publicKey: string } {
		return {
			signature: this.signatureBase64,
			publicKey: this.publicKeyBase64,
		};
	}
}

/**
 * Represents an RFC 3161 timestamp token
 */
export class RFC3161Timestamp {
	constructor(
		private readonly tokenBase64: string,
		private readonly timestamp: Date,
		private readonly authority: string = "freetsa.org",
	) {
		if (!tokenBase64 || tokenBase64.length === 0) {
			throw new Error("Timestamp token cannot be empty");
		}
	}

	getToken(): string {
		return this.tokenBase64;
	}

	getTimestamp(): Date {
		return this.timestamp;
	}

	getAuthority(): string {
		return this.authority;
	}

	toJSON(): { token: string; timestamp: string; authority: string } {
		return {
			token: this.tokenBase64,
			timestamp: this.timestamp.toISOString(),
			authority: this.authority,
		};
	}
}

// ============================================
// DOMAIN ENTITIES
// ============================================

/**
 * Represents a single file entry in an audit manifest
 */
export class AuditFileEntry {
	constructor(
		public readonly path: string,
		public readonly hash: SHA256Hash,
		public readonly sizeBytes: number,
		public readonly merkleIndex: number,
	) {
		if (!path || path.length === 0) {
			throw new Error("File path cannot be empty");
		}
		if (sizeBytes < 0) {
			throw new Error("File size cannot be negative");
		}
		if (merkleIndex < 0) {
			throw new Error("Merkle index cannot be negative");
		}
	}

	toJSON(): { path: string; hash: string; sizeBytes: number; merkleIndex: number } {
		return {
			path: this.path,
			hash: this.hash.toString(),
			sizeBytes: this.sizeBytes,
			merkleIndex: this.merkleIndex,
		};
	}
}

/**
 * Audit manifest containing file inventory and cryptographic proofs
 */
export class AuditManifest {
	public static readonly VERSION = "1.0";

	constructor(
		public readonly exportId: string,
		public readonly organizationId: string,
		public readonly exportType: "data" | "payroll" | "audit_pack",
		public readonly files: AuditFileEntry[],
		public readonly merkleRoot: SHA256Hash,
		public readonly createdAt: Date,
	) {
		if (!exportId) {
			throw new Error("Export ID cannot be empty");
		}
		if (!organizationId) {
			throw new Error("Organization ID cannot be empty");
		}
		if (files.length === 0) {
			throw new Error("Manifest must contain at least one file");
		}
	}

	getFileCount(): number {
		return this.files.length;
	}

	getTotalSize(): number {
		return this.files.reduce((sum, file) => sum + file.sizeBytes, 0);
	}

	/**
	 * Serialize to canonical JSON for signing
	 * IMPORTANT: This must be deterministic for signature verification
	 */
	toCanonicalJSON(): string {
		const obj = {
			version: AuditManifest.VERSION,
			exportId: this.exportId,
			organizationId: this.organizationId,
			exportType: this.exportType,
			createdAt: this.createdAt.toISOString(),
			merkleRoot: this.merkleRoot.toString(),
			files: this.files
				.slice()
				.sort((a, b) => a.path.localeCompare(b.path))
				.map((f) => ({
					path: f.path,
					hash: f.hash.toString(),
					sizeBytes: f.sizeBytes,
				})),
		};
		// Use null replacer and no spacing for canonical form
		return JSON.stringify(obj, null, 0);
	}

	/**
	 * Serialize to pretty JSON for human-readable output
	 */
	toPrettyJSON(): string {
		const obj = {
			version: AuditManifest.VERSION,
			exportId: this.exportId,
			organizationId: this.organizationId,
			exportType: this.exportType,
			createdAt: this.createdAt.toISOString(),
			merkleRoot: this.merkleRoot.toString(),
			fileCount: this.files.length,
			totalSizeBytes: this.getTotalSize(),
			files: this.files.map((f) => f.toJSON()),
		};
		return JSON.stringify(obj, null, 2);
	}
}

/**
 * Complete signed audit package
 */
export class SignedAuditPackage {
	constructor(
		public readonly manifest: AuditManifest,
		public readonly signature: Ed25519Signature,
		public readonly timestamp: RFC3161Timestamp,
		public readonly retentionYears: number,
		public readonly s3Key?: string,
	) {
		if (retentionYears < 1 || retentionYears > 10) {
			throw new Error("Retention years must be between 1 and 10");
		}
	}

	/**
	 * Calculate retention end date
	 */
	getRetentionUntil(): Date {
		const date = new Date(this.manifest.createdAt);
		date.setFullYear(date.getFullYear() + this.retentionYears);
		return date;
	}

	toJSON(): object {
		return {
			manifest: JSON.parse(this.manifest.toPrettyJSON()),
			signature: this.signature.toJSON(),
			timestamp: this.timestamp.toJSON(),
			retentionYears: this.retentionYears,
			retentionUntil: this.getRetentionUntil().toISOString(),
			s3Key: this.s3Key,
		};
	}
}

// ============================================
// VERIFICATION RESULT TYPES
// ============================================

export interface VerificationCheck {
	name: string;
	passed: boolean;
	details: string;
	expected?: string;
	actual?: string;
}

export interface VerificationResult {
	isValid: boolean;
	checks: VerificationCheck[];
	summary: string;
	verifiedAt: Date;
}
