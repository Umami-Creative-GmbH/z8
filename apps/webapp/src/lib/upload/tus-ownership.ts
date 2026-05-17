const TUS_KEY_PREFIX = "tus";

function encodeOwnerId(userId: string): string {
	return Buffer.from(userId, "utf8").toString("base64url");
}

export function createOwnedTusFileKey(userId: string, entropy = crypto.randomUUID()): string {
	return `${TUS_KEY_PREFIX}-${encodeOwnerId(userId)}-${entropy}`;
}

export function isTusFileKeyOwnedByUser(key: string, userId: string): boolean {
	return key.startsWith(`${TUS_KEY_PREFIX}-${encodeOwnerId(userId)}-`);
}

export function sanitizeTusFileKey(key: string, userId: string): string | null {
	if (!key || key.includes("..") || key.includes("/") || key.includes("\\")) {
		return null;
	}

	return isTusFileKeyOwnedByUser(key, userId) ? key : null;
}
