import { describe, expect, it } from "vitest";
import { isValidCronAuthorization } from "./auth";

describe("isValidCronAuthorization", () => {
	it("accepts the exact bearer secret", () => {
		expect(isValidCronAuthorization("Bearer cron-secret", "cron-secret")).toBe(true);
	});

	it("rejects a wrong secret of the same length", () => {
		expect(isValidCronAuthorization("Bearer cron-secreX", "cron-secret")).toBe(false);
	});

	it("rejects a secret of a different length", () => {
		expect(isValidCronAuthorization("Bearer cron", "cron-secret")).toBe(false);
		expect(isValidCronAuthorization("Bearer cron-secret-extra", "cron-secret")).toBe(false);
	});

	it("rejects the secret without the Bearer scheme", () => {
		expect(isValidCronAuthorization("cron-secret", "cron-secret")).toBe(false);
	});

	it("rejects a missing header", () => {
		expect(isValidCronAuthorization(null, "cron-secret")).toBe(false);
		expect(isValidCronAuthorization(undefined, "cron-secret")).toBe(false);
		expect(isValidCronAuthorization("", "cron-secret")).toBe(false);
	});

	it("fails closed when no secret is configured", () => {
		expect(isValidCronAuthorization("Bearer ", undefined)).toBe(false);
		expect(isValidCronAuthorization("Bearer ", "")).toBe(false);
		expect(isValidCronAuthorization("Bearer undefined", undefined)).toBe(false);
	});
});
