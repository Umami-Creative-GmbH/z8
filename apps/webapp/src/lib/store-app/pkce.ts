/** PKCE (RFC 7636, S256) for the store app's system-browser sign-in. */

function base64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

/** 32 random bytes as base64url: 43 characters, the RFC's recommended verifier. */
export function createPkceVerifier(): string {
	return base64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function challengeForVerifier(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	return base64Url(new Uint8Array(digest));
}
