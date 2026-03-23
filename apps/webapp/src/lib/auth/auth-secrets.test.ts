import { describe, expect, it } from "vitest";
import { BUILD_TIME_AUTH_SECRET, resolveAuthSecrets } from "./auth-secrets";

describe("resolveAuthSecrets", () => {
	it("returns the primary auth secret when rotated secrets are absent", () => {
		expect(
			resolveAuthSecrets({
				primarySecret: "primary-secret-with-at-least-32-chars",
				rotatedSecrets: undefined,
				isBuildTime: false,
			}),
		).toEqual({
			secrets: [{ version: 1, value: "primary-secret-with-at-least-32-chars" }],
			usedBuildTimeFallback: false,
			hadInvalidRotatedSecrets: false,
		});
	});

	it("uses a build-only fallback secret when no runtime secret is available during build", () => {
		expect(
			resolveAuthSecrets({
				primarySecret: undefined,
				rotatedSecrets: undefined,
				isBuildTime: true,
			}),
		).toEqual({
			secrets: [{ version: 1, value: BUILD_TIME_AUTH_SECRET }],
			usedBuildTimeFallback: true,
			hadInvalidRotatedSecrets: false,
		});
	});

	it("falls back to the build-only secret when rotated secrets are invalid during build", () => {
		expect(
			resolveAuthSecrets({
				primarySecret: undefined,
				rotatedSecrets: "1:short,not-a-secret",
				isBuildTime: true,
			}),
		).toEqual({
			secrets: [{ version: 1, value: BUILD_TIME_AUTH_SECRET }],
			usedBuildTimeFallback: true,
			hadInvalidRotatedSecrets: true,
		});
	});

	it("parses valid rotated secrets and ignores invalid entries", () => {
		expect(
			resolveAuthSecrets({
				primarySecret: "primary-secret-with-at-least-32-chars",
				rotatedSecrets:
					"1:older-secret-with-at-least-32-chars, invalid, 2:newer-secret-with-at-least-32-characters",
				isBuildTime: false,
			}),
		).toEqual({
			secrets: [
				{ version: 1, value: "older-secret-with-at-least-32-chars" },
				{ version: 2, value: "newer-secret-with-at-least-32-characters" },
			],
			usedBuildTimeFallback: false,
			hadInvalidRotatedSecrets: false,
		});
	});
});
