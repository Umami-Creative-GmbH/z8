import { describe, expect, it } from "vitest";
import {
	createOwnedTusFileKey,
	isTusFileKeyOwnedByUser,
	sanitizeTusFileKey,
} from "./tus-ownership";

describe("TUS upload ownership", () => {
	it("creates temporary keys that are bound to the uploader", () => {
		const key = createOwnedTusFileKey("user-1", "random-key");

		expect(key).toBe(".tmp/tus/dXNlci0x-random-key");
		expect(isTusFileKeyOwnedByUser(key, "user-1")).toBe(true);
		expect(isTusFileKeyOwnedByUser(key, "user-2")).toBe(false);
	});

	it("rejects traversal and unowned temporary keys", () => {
		expect(sanitizeTusFileKey("../victim", "user-1")).toBeNull();
		expect(sanitizeTusFileKey(".tmp/tus/../victim", "user-1")).toBeNull();
		expect(sanitizeTusFileKey(".tmp/tus/dXNlci0y-random-key", "user-1")).toBeNull();
		expect(sanitizeTusFileKey("tus-dXNlci0x-random-key", "user-1")).toBeNull();
	});

	it("accepts only owned temporary keys under the temp TUS prefix", () => {
		expect(sanitizeTusFileKey(".tmp/tus/dXNlci0x-random-key", "user-1")).toBe(
			".tmp/tus/dXNlci0x-random-key",
		);
		expect(sanitizeTusFileKey(".tmp/other/dXNlci0x-random-key", "user-1")).toBeNull();
	});
});
