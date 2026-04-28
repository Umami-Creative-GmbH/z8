import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export interface EncryptedImportCredential {
	ciphertext: string;
	iv: string;
	authTag: string;
	expiresAt: Date;
}

function deriveKey(secret: string): Buffer {
	return createHash("sha256").update(secret).digest();
}

export function encryptImportCredential(
	plaintext: string,
	secret: string,
	expiresAt: Date = new Date(Date.now() + 24 * 60 * 60 * 1000),
): EncryptedImportCredential {
	const iv = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
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
	decipher.setAuthTag(Buffer.from(credential.authTag, "base64"));

	return Buffer.concat([
		decipher.update(Buffer.from(credential.ciphertext, "base64")),
		decipher.final(),
	]).toString("utf8");
}
