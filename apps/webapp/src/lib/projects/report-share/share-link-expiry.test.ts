import { Temporal } from "temporal-polyfill";
import { describe, expect, it } from "vitest";
import { shareLinkExpiry } from "./share-link-expiry";

const createdAt = Temporal.Instant.from("2026-10-11T09:30:00Z");

describe("report share link expiry", () => {
	it("expires 30 days after creation when the creator picks no expiry", () => {
		expect(shareLinkExpiry({ createdAt })).toEqual({
			ok: true,
			expiresAt: Temporal.Instant.from("2026-11-10T09:30:00Z"),
		});
	});

	it("allows up to 90 days", () => {
		expect(shareLinkExpiry({ createdAt, expiresInDays: 90 })).toEqual({
			ok: true,
			expiresAt: Temporal.Instant.from("2027-01-09T09:30:00Z"),
		});
		expect(shareLinkExpiry({ createdAt, expiresInDays: 1 })).toEqual({
			ok: true,
			expiresAt: Temporal.Instant.from("2026-10-12T09:30:00Z"),
		});
	});

	it("refuses more than 90 days", () => {
		expect(shareLinkExpiry({ createdAt, expiresInDays: 91 })).toEqual({
			ok: false,
			reason: "too_long",
		});
	});

	it("refuses a link without expiry", () => {
		expect(shareLinkExpiry({ createdAt, expiresInDays: null })).toEqual({
			ok: false,
			reason: "no_expiry",
		});
		expect(shareLinkExpiry({ createdAt, expiresInDays: Number.POSITIVE_INFINITY })).toEqual({
			ok: false,
			reason: "no_expiry",
		});
	});

	it.each([0, -5, 1.5, Number.NaN])("refuses %s days", (expiresInDays) => {
		expect(shareLinkExpiry({ createdAt, expiresInDays })).toEqual({
			ok: false,
			reason: "invalid",
		});
	});
});
