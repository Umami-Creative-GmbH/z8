export interface TotpEnrollmentResponse {
	method: "totp";
	totpURI: string;
	backupCodes: string[];
}

export function parseTotpEnrollmentResponse(response: unknown): TotpEnrollmentResponse {
	if (typeof response !== "object" || response === null) {
		throw new Error("Expected TOTP enrollment response");
	}

	const { method, totpURI, backupCodes } = response as Record<string, unknown>;

	if (
		method !== "totp" ||
		typeof totpURI !== "string" ||
		totpURI.length === 0 ||
		!Array.isArray(backupCodes) ||
		!backupCodes.every(
			(code): code is string => typeof code === "string" && code.length > 0,
		)
	) {
		throw new Error("Expected TOTP enrollment response");
	}

	return { method, totpURI, backupCodes };
}
