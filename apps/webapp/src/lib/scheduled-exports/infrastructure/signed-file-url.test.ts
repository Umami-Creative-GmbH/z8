import { describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";

const getPresignedUrl = vi.hoisted(() => vi.fn(async () => "https://s3.example/file?sig"));

vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl,
	getDefaultPresignedUrlTtlSeconds: () => 900,
}));

const { signFileUrl } = await import("./signed-file-url");

const clock = { nowInstant: () => parseInstant("2026-10-10T12:00:00.750Z") };

describe("signFileUrl", () => {
	it("signs with the private storage default and expires that long after signing", async () => {
		const link = await signFileUrl(
			"org-1",
			"payroll-exports/org-1/job-1/export.csv",
			undefined,
			clock,
		);

		expect(getPresignedUrl).toHaveBeenCalledWith(
			"org-1",
			"payroll-exports/org-1/job-1/export.csv",
			900,
		);
		expect(link.url).toBe("https://s3.example/file?sig");
		expect(link.lifetimeSeconds).toBe(900);
		// Floored to the second, so never later than the URL's own expiry.
		expect(link.expiresAt.toString()).toBe("2026-10-10T12:15:00Z");
	});

	it("signs and dates a given lifetime", async () => {
		const link = await signFileUrl("org-1", "exports/org-1/export-1.zip", 604800, clock);

		expect(getPresignedUrl).toHaveBeenLastCalledWith("org-1", "exports/org-1/export-1.zip", 604800);
		expect(link.expiresAt.toString()).toBe("2026-10-17T12:00:00Z");
	});
});
