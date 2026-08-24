const ACCOUNT_ISSUERS = new Map<string, string>([
	["credential", "local:credential"],
	["google", "https://accounts.google.com"],
	["apple", "https://appleid.apple.com"],
	["github", "local:oauth:github"],
	["linkedin", "local:oauth:linkedin"],
]);

export function getAccountIssuer(providerId: string): string {
	const issuer = ACCOUNT_ISSUERS.get(providerId);
	if (!issuer) {
		throw new Error(`Unknown account provider: ${providerId}`);
	}

	return issuer;
}
