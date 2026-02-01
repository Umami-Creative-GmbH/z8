/**
 * Ed25519 Signing Provider
 * Infrastructure layer implementation for cryptographic signing
 */
import crypto from "node:crypto";
import { promisify } from "node:util";
import { Ed25519Signature } from "../../domain/models";

const generateKeyPairAsync = promisify(crypto.generateKeyPair);

// ============================================
// INTERFACE
// ============================================

export interface ISigningProvider {
	/**
	 * Generate a new Ed25519 key pair
	 */
	generateKeyPair(): Promise<{
		privateKeyPem: string;
		publicKeyPem: string;
		fingerprint: string;
	}>;

	/**
	 * Sign data with a private key
	 */
	sign(data: Buffer, privateKeyPem: string): Promise<Ed25519Signature>;

	/**
	 * Verify a signature against data
	 */
	verify(data: Buffer, signature: Ed25519Signature): Promise<boolean>;

	/**
	 * Derive public key from private key
	 */
	derivePublicKey(privateKeyPem: string): string;

	/**
	 * Calculate fingerprint of a public key
	 */
	calculateFingerprint(publicKeyPem: string): string;
}

// ============================================
// IMPLEMENTATION
// ============================================

export class Ed25519SigningProvider implements ISigningProvider {
	/**
	 * Generate a new Ed25519 key pair
	 * Returns PEM-encoded keys and a fingerprint for identification
	 */
	async generateKeyPair(): Promise<{
		privateKeyPem: string;
		publicKeyPem: string;
		fingerprint: string;
	}> {
		const { privateKey, publicKey } = await generateKeyPairAsync("ed25519", {
			privateKeyEncoding: { type: "pkcs8", format: "pem" },
			publicKeyEncoding: { type: "spki", format: "pem" },
		});

		const fingerprint = this.calculateFingerprint(publicKey);

		return {
			privateKeyPem: privateKey,
			publicKeyPem: publicKey,
			fingerprint,
		};
	}

	/**
	 * Sign data with Ed25519 private key
	 */
	async sign(data: Buffer, privateKeyPem: string): Promise<Ed25519Signature> {
		const privateKey = crypto.createPrivateKey({
			key: privateKeyPem,
			format: "pem",
		});

		const signature = crypto.sign(null, data, privateKey);
		const signatureBase64 = signature.toString("base64");

		// Derive public key for inclusion in signature
		const publicKeyPem = this.derivePublicKey(privateKeyPem);
		const publicKeyBase64 = this.pemToBase64(publicKeyPem);

		return new Ed25519Signature(signatureBase64, publicKeyBase64);
	}

	/**
	 * Verify Ed25519 signature
	 */
	async verify(data: Buffer, signature: Ed25519Signature): Promise<boolean> {
		try {
			const publicKeyPem = this.base64ToPem(signature.getPublicKey(), "PUBLIC KEY");

			const publicKey = crypto.createPublicKey({
				key: publicKeyPem,
				format: "pem",
			});

			const signatureBuffer = Buffer.from(signature.getSignature(), "base64");

			return crypto.verify(null, data, publicKey, signatureBuffer);
		} catch {
			// Invalid key format or other crypto error
			return false;
		}
	}

	/**
	 * Derive public key from private key
	 */
	derivePublicKey(privateKeyPem: string): string {
		const privateKey = crypto.createPrivateKey({
			key: privateKeyPem,
			format: "pem",
		});

		const publicKey = crypto.createPublicKey(privateKey);

		return publicKey.export({ type: "spki", format: "pem" }) as string;
	}

	/**
	 * Calculate SHA-256 fingerprint of public key
	 * Format: hex string of first 16 bytes (32 hex chars)
	 */
	calculateFingerprint(publicKeyPem: string): string {
		// Extract the raw key bytes from PEM
		const base64 = this.pemToBase64(publicKeyPem);
		const keyBuffer = Buffer.from(base64, "base64");

		// Hash the DER-encoded key
		const hash = crypto.createHash("sha256").update(keyBuffer).digest("hex");

		// Return first 32 hex chars (16 bytes) as fingerprint
		return hash.substring(0, 32);
	}

	/**
	 * Convert PEM to base64 (strip headers and newlines)
	 */
	private pemToBase64(pem: string): string {
		return pem
			.replace(/-----BEGIN [A-Z ]+-----/, "")
			.replace(/-----END [A-Z ]+-----/, "")
			.replace(/\s/g, "");
	}

	/**
	 * Convert base64 back to PEM format
	 */
	private base64ToPem(base64: string, type: "PUBLIC KEY" | "PRIVATE KEY"): string {
		// Split base64 into 64-char lines
		const lines = base64.match(/.{1,64}/g) || [];
		return `-----BEGIN ${type}-----\n${lines.join("\n")}\n-----END ${type}-----\n`;
	}
}

// ============================================
// SINGLETON INSTANCE
// ============================================

export const signingProvider = new Ed25519SigningProvider();
