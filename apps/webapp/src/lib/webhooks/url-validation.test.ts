import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("node:dns", () => ({
	promises: { lookup: lookupMock },
}));

import { isPrivateIP, resolveAndValidateUrl } from "./url-validation";

beforeEach(() => {
	lookupMock.mockReset();
});

describe("webhook URL validation", () => {
	it.each([
		"::ffff:7f00:1",
		"[::ffff:7f00:1]",
		"::ffff:127.0.0.1",
		"::ffff:a9fe:a9fe",
	])("blocks private IPv4-mapped IPv6 address %s", (address) => {
		expect(isPrivateIP(address)).toBe(true);
	});

	it.each([
		"100.64.0.1",
		"100.100.100.200",
		"192.0.0.1",
		"198.18.0.1",
		"224.0.0.1",
		"240.0.0.1",
		"ff02::1",
		"fec0::1",
	])("blocks non-global address %s", (address) => {
		expect(isPrivateIP(address)).toBe(true);
	});

	it.each([
		"2606:4700:4700::1111",
		"::ffff:0808:0808",
		"8.8.8.8",
		"93.184.216.34",
	])("allows public IPv6 address %s", (address) => {
		expect(isPrivateIP(address)).toBe(false);
	});

	it("returns every validated DNS address for connection pinning", async () => {
		lookupMock.mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
		]);

		await expect(resolveAndValidateUrl("https://example.com/webhook")).resolves.toEqual({
			valid: true,
			addresses: [
				{ address: "93.184.216.34", family: 4 },
				{ address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
			],
		});
		expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
	});

	it("rejects a hostname when any DNS answer is private", async () => {
		lookupMock.mockResolvedValue([
			{ address: "93.184.216.34", family: 4 },
			{ address: "127.0.0.1", family: 4 },
		]);

		await expect(resolveAndValidateUrl("https://example.com/webhook")).resolves.toEqual({
			valid: false,
			reason: "Webhook URL resolves to a private IP address",
		});
	});
});
