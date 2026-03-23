export const BUILD_TIME_AUTH_SECRET = "build-time-auth-secret-for-prerender-only-2026";

type ResolvedAuthSecrets = {
	secrets: Array<{ version: number; value: string }>;
	usedBuildTimeFallback: boolean;
	hadInvalidRotatedSecrets: boolean;
};

type ResolveAuthSecretsOptions = {
	primarySecret?: string;
	rotatedSecrets?: string;
	isBuildTime?: boolean;
};

export function isBuildTimeAuthFallbackAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
	return env.NEXT_PHASE === "phase-production-build" || env.npm_lifecycle_event === "build";
}

export function resolveAuthSecrets({
	primarySecret,
	rotatedSecrets,
	isBuildTime = isBuildTimeAuthFallbackAllowed(),
}: ResolveAuthSecretsOptions): ResolvedAuthSecrets {
	const fallbackSecret = primarySecret ?? (isBuildTime ? BUILD_TIME_AUTH_SECRET : "");
	const fallback = [{ version: 1, value: fallbackSecret }];
	const usedBuildTimeFallback = !primarySecret && isBuildTime;

	if (!rotatedSecrets) {
		return {
			secrets: fallback,
			usedBuildTimeFallback,
			hadInvalidRotatedSecrets: false,
		};
	}

	const parsed = rotatedSecrets
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => {
			const [versionRaw, ...valueParts] = entry.split(":");
			const version = Number(versionRaw);
			const value = valueParts.join(":").trim();

			if (!Number.isInteger(version) || version <= 0 || value.length < 32) {
				return null;
			}

			return { version, value };
		})
		.filter((value): value is { version: number; value: string } => value !== null);

	if (parsed.length === 0) {
		return {
			secrets: fallback,
			usedBuildTimeFallback,
			hadInvalidRotatedSecrets: true,
		};
	}

	return {
		secrets: parsed,
		usedBuildTimeFallback: false,
		hadInvalidRotatedSecrets: false,
	};
}
