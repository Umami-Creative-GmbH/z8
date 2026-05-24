import { describe, expect, it } from "vitest";
import { getTusFileKeyFromUploadUrl } from "./tus-url";

describe("TUS upload URL parsing", () => {
	it("extracts nested TUS file keys from API upload URLs", () => {
		expect(
			getTusFileKeyFromUploadUrl("https://app.example.com/api/tus/.tmp/tus/dXNlci0x-random-key"),
		).toBe(".tmp/tus/dXNlci0x-random-key");
	});

	it("decodes URL-encoded path segments", () => {
		expect(getTusFileKeyFromUploadUrl("/api/tus/.tmp%2Ftus%2FdXNlci0x-random-key")).toBe(
			".tmp/tus/dXNlci0x-random-key",
		);
	});

	it("returns null when the upload URL does not contain a TUS key", () => {
		expect(getTusFileKeyFromUploadUrl(undefined)).toBeNull();
		expect(getTusFileKeyFromUploadUrl("/api/tus")).toBeNull();
		expect(getTusFileKeyFromUploadUrl("/api/other/.tmp/tus/dXNlci0x-random-key")).toBeNull();
	});
});
