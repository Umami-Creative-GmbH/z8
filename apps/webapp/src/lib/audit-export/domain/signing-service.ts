/**
 * Signing Service Domain Service
 * Signs audit manifests with Ed25519
 */
import { createLogger } from "@/lib/logger";
import { AuditManifest, Ed25519Signature, SHA256Hash } from "./models";
import { signingProvider, type ISigningProvider } from "../infrastructure/crypto/signing-provider";
import { keyManager, type IKeyManager } from "../infrastructure/vault/key-manager";
import { hashProvider, type IHashProvider } from "../infrastructure/crypto/hash-provider";

const logger = createLogger("SigningService");

// ============================================
// INTERFACE
// ============================================

export interface ISigningService {
	/**
	 * Sign an audit manifest
	 * Returns signature with key ID for verification
	 */
	signManifest(
		organizationId: string,
		manifest: AuditManifest,
		manifestHash: SHA256Hash,
	): Promise<{
		signature: Ed25519Signature;
		signingKeyId: string;
		signedAt: Date;
	}>;

	/**
	 * Verify a manifest signature
	 */
	verifyManifestSignature(
		manifest: AuditManifest,
		manifestHash: SHA256Hash,
		signature: Ed25519Signature,
		publicKeyPem?: string,
	): Promise<boolean>;
}

// ============================================
// IMPLEMENTATION
// ============================================

export class SigningService implements ISigningService {
	constructor(
		private readonly signing: ISigningProvider = signingProvider,
		private readonly keys: IKeyManager = keyManager,
		private readonly hash: IHashProvider = hashProvider,
	) {}

	/**
	 * Sign manifest with organization's Ed25519 key
	 */
	async signManifest(
		organizationId: string,
		manifest: AuditManifest,
		manifestHash: SHA256Hash,
	): Promise<{
		signature: Ed25519Signature;
		signingKeyId: string;
		signedAt: Date;
	}> {
		logger.info(
			{
				organizationId,
				exportId: manifest.exportId,
				manifestHash: manifestHash.toString().substring(0, 16),
			},
			"Signing manifest",
		);

		// Get or create signing key
		const { keyId, publicKeyPem, fingerprint } = await this.keys.getOrCreateSigningKey(organizationId);

		// Get private key from Vault
		const privateKeyPem = await this.keys.getPrivateKey(organizationId);
		if (!privateKeyPem) {
			throw new Error("Private key not found in Vault");
		}

		// Build data to sign: manifestHash + merkleRoot
		// This binds the signature to both the manifest content and file integrity
		const dataToSign = Buffer.concat([
			Buffer.from(manifestHash.toString(), "hex"),
			Buffer.from(manifest.merkleRoot.toString(), "hex"),
		]);

		// Sign
		const signature = await this.signing.sign(dataToSign, privateKeyPem);
		const signedAt = new Date();

		logger.info(
			{
				organizationId,
				exportId: manifest.exportId,
				keyId,
				fingerprint,
			},
			"Manifest signed successfully",
		);

		return {
			signature,
			signingKeyId: keyId,
			signedAt,
		};
	}

	/**
	 * Verify manifest signature
	 */
	async verifyManifestSignature(
		manifest: AuditManifest,
		manifestHash: SHA256Hash,
		signature: Ed25519Signature,
		publicKeyPem?: string,
	): Promise<boolean> {
		logger.info({ exportId: manifest.exportId }, "Verifying manifest signature");

		// Use provided public key or extract from signature
		let keyToUse = publicKeyPem;
		if (!keyToUse) {
			// Convert base64 public key from signature to PEM
			const base64Key = signature.getPublicKey();
			keyToUse = this.base64ToPem(base64Key, "PUBLIC KEY");
		}

		// Rebuild data that was signed
		const dataToVerify = Buffer.concat([
			Buffer.from(manifestHash.toString(), "hex"),
			Buffer.from(manifest.merkleRoot.toString(), "hex"),
		]);

		// Create signature object with the PEM-formatted public key
		const signatureForVerification = new Ed25519Signature(
			signature.getSignature(),
			this.pemToBase64(keyToUse),
		);

		const isValid = await this.signing.verify(dataToVerify, signatureForVerification);

		logger.info(
			{
				exportId: manifest.exportId,
				isValid,
			},
			"Signature verification complete",
		);

		return isValid;
	}

	/**
	 * Recalculate manifest hash and verify
	 * Use this when you have the manifest object but not the original hash
	 */
	async verifyManifestWithRecalculatedHash(
		manifest: AuditManifest,
		signature: Ed25519Signature,
		publicKeyPem?: string,
	): Promise<{
		isValid: boolean;
		manifestHash: SHA256Hash;
	}> {
		const manifestHash = this.hash.hashString(manifest.toCanonicalJSON());
		const isValid = await this.verifyManifestSignature(
			manifest,
			manifestHash,
			signature,
			publicKeyPem,
		);

		return { isValid, manifestHash };
	}

	/**
	 * Helper: Convert base64 to PEM format
	 */
	private base64ToPem(base64: string, type: "PUBLIC KEY" | "PRIVATE KEY"): string {
		const lines = base64.match(/.{1,64}/g) || [];
		return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----\n`;
	}

	/**
	 * Helper: Convert PEM to base64 (strip headers)
	 */
	private pemToBase64(pem: string): string {
		return pem
			.replace(/-----BEGIN [A-Z ]+-----/, "")
			.replace(/-----END [A-Z ]+-----/, "")
			.replace(/\s/g, "");
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const signingService = new SigningService();
