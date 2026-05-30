export type ScalewayKey = {
	id?: string;
	state?: string;
	usage?: {
		symmetric_encryption?: string;
	};
	tags?: string[];
};

export function isEnabledScalewayKey(key: unknown): key is ScalewayKey & { id: string } {
	if (typeof key !== "object" || key === null) {
		return false;
	}

	const scalewayKey = key as ScalewayKey;
	return (
		typeof scalewayKey.id === "string" &&
		scalewayKey.id.length > 0 &&
		scalewayKey.state === "enabled"
	);
}

export function isCompatibleScalewayKey(
	key: unknown,
	organizationId: string,
): key is ScalewayKey & { id: string } {
	const scalewayKey = key as ScalewayKey;
	return (
		isEnabledScalewayKey(key) &&
		scalewayKey.usage?.symmetric_encryption === "aes_256_gcm" &&
		Array.isArray(scalewayKey.tags) &&
		scalewayKey.tags.includes("z8-customer-secrets") &&
		scalewayKey.tags.includes(`z8-org:${organizationId}`)
	);
}

export function isCompatibleScalewayPlatformKey(key: unknown): key is ScalewayKey & { id: string } {
	const scalewayKey = key as ScalewayKey;
	return (
		isEnabledScalewayKey(key) &&
		scalewayKey.usage?.symmetric_encryption === "aes_256_gcm" &&
		Array.isArray(scalewayKey.tags) &&
		scalewayKey.tags.includes("z8-platform-secrets")
	);
}
