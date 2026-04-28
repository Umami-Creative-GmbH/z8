import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const CREDENTIAL_SECRET_INFO = "z8/import-review/credential-secret/v1";
const MIN_SECRET_LENGTH = 32;

export interface EncryptedImportCredential {
	ciphertext: string;
	iv: string;
	authTag: string;
	expiresAt: Date;
}

function deriveKey(secret: string): Buffer {
	if (secret.length < MIN_SECRET_LENGTH) {
		throw new Error("Import credential secret must be at least 32 characters");
	}

	return Buffer.from(
		hkdfSync(
			"sha256",
			Buffer.from(secret, "utf8"),
			Buffer.alloc(0),
			Buffer.from(CREDENTIAL_SECRET_INFO, "utf8"),
			32,
		),
	);
}

function expiryAad(expiresAt: Date): Buffer {
	return Buffer.from(expiresAt.toISOString(), "utf8");
}

export function encryptImportCredential(
	plaintext: string,
	secret: string,
	expiresAt: Date = new Date(Date.now() + 24 * 60 * 60 * 1000),
): EncryptedImportCredential {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
	cipher.setAAD(expiryAad(expiresAt));
	const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const authTag = cipher.getAuthTag();

	return {
		ciphertext: ciphertext.toString("base64"),
		iv: iv.toString("base64"),
		authTag: authTag.toString("base64"),
		expiresAt,
	};
}

export function decryptImportCredential(
	credential: EncryptedImportCredential,
	secret: string,
	now: Date = new Date(),
): string {
	if (credential.expiresAt <= now) throw new Error("Import credential has expired");

	const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(credential.iv, "base64"));
	decipher.setAAD(expiryAad(credential.expiresAt));
	decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));

	return Buffer.concat([
		decipher.update(Buffer.from(credential.ciphertext, "base64")),
		decipher.final(),
	]).toString("utf8");
}
