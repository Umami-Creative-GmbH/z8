import { describe, expect, expectTypeOf, it } from "vitest";
import {
	resolveDigestScheduleTimezone,
	resolveOrganizationTimezone,
	resolvePersonalTimezone,
} from "./resolve-timezone";

it("exposes only possible source literals from each resolver", () => {
	expectTypeOf(resolvePersonalTimezone({}).source).toEqualTypeOf<
		"user" | "organization" | "default"
	>();
	expectTypeOf(resolveOrganizationTimezone().source).toEqualTypeOf<"organization" | "default">();
	expectTypeOf(resolveDigestScheduleTimezone({}).source).toEqualTypeOf<
		"digest_schedule" | "organization" | "default"
	>();
});

describe("personal timezone resolution", () => {
	it("prefers a valid user timezone over the organization timezone", () => {
		expect(
			resolvePersonalTimezone({
				userTimezone: "Asia/Kathmandu",
				organizationTimezone: "Europe/Berlin",
			}),
		).toEqual({
			timezone: "Asia/Kathmandu",
			source: "user",
			invalidCandidates: [],
		});
	});

	it("treats stored UTC as an intentional user choice", () => {
		expect(
			resolvePersonalTimezone({
				userTimezone: "UTC",
				organizationTimezone: "Europe/Berlin",
			}),
		).toEqual({ timezone: "UTC", source: "user", invalidCandidates: [] });
	});

	it("falls through an absent user settings row without marking it invalid", () => {
		expect(
			resolvePersonalTimezone({
				userTimezone: undefined,
				organizationTimezone: "Europe/Berlin",
			}),
		).toEqual({ timezone: "Europe/Berlin", source: "organization", invalidCandidates: [] });
	});

	it.each([
		null,
		"Invalid/User_Zone",
	])("records persisted invalid user value %j and falls through", (userTimezone) => {
		expect(
			resolvePersonalTimezone({
				userTimezone,
				organizationTimezone: "America/New_York",
			}),
		).toEqual({
			timezone: "America/New_York",
			source: "organization",
			invalidCandidates: [{ source: "user", value: userTimezone }],
		});
	});

	it("records invalid user and organization candidates before using UTC", () => {
		expect(resolvePersonalTimezone({ userTimezone: "", organizationTimezone: null })).toEqual({
			timezone: "UTC",
			source: "default",
			invalidCandidates: [
				{ source: "user", value: "" },
				{ source: "organization", value: null },
			],
		});
	});
});

describe("organization timezone resolution", () => {
	it.each(["UTC", "Europe/Berlin"])("uses valid organization timezone %s", (value) => {
		expect(resolveOrganizationTimezone(value)).toEqual({
			timezone: value,
			source: "organization",
			invalidCandidates: [],
		});
	});

	it("uses the default without recording an absent organization value", () => {
		expect(resolveOrganizationTimezone(undefined)).toEqual({
			timezone: "UTC",
			source: "default",
			invalidCandidates: [],
		});
	});

	it.each([
		null,
		"Invalid/Organization_Zone",
	])("records persisted invalid organization value %j before using UTC", (value) => {
		expect(resolveOrganizationTimezone(value)).toEqual({
			timezone: "UTC",
			source: "default",
			invalidCandidates: [{ source: "organization", value }],
		});
	});
});

describe("digest schedule timezone resolution", () => {
	it("prefers the digest schedule timezone over the organization timezone", () => {
		expect(
			resolveDigestScheduleTimezone({
				digestTimezone: "America/New_York",
				organizationTimezone: "Europe/Berlin",
			}),
		).toEqual({
			timezone: "America/New_York",
			source: "digest_schedule",
			invalidCandidates: [],
		});
	});

	it("treats stored UTC as an intentional digest schedule choice", () => {
		expect(
			resolveDigestScheduleTimezone({
				digestTimezone: "UTC",
				organizationTimezone: "Europe/Berlin",
			}),
		).toEqual({ timezone: "UTC", source: "digest_schedule", invalidCandidates: [] });
	});

	it("falls through an absent digest timezone without marking it invalid", () => {
		expect(
			resolveDigestScheduleTimezone({
				digestTimezone: undefined,
				organizationTimezone: "Europe/Berlin",
			}),
		).toEqual({ timezone: "Europe/Berlin", source: "organization", invalidCandidates: [] });
	});

	it("records an invalid digest candidate before using the organization timezone", () => {
		expect(
			resolveDigestScheduleTimezone({
				digestTimezone: null,
				organizationTimezone: "Europe/Berlin",
			}),
		).toEqual({
			timezone: "Europe/Berlin",
			source: "organization",
			invalidCandidates: [{ source: "digest_schedule", value: null }],
		});
	});

	it("records invalid persisted candidates in precedence order before using UTC", () => {
		expect(
			resolveDigestScheduleTimezone({
				digestTimezone: "Invalid/Digest_Zone",
				organizationTimezone: "",
			}),
		).toEqual({
			timezone: "UTC",
			source: "default",
			invalidCandidates: [
				{ source: "digest_schedule", value: "Invalid/Digest_Zone" },
				{ source: "organization", value: "" },
			],
		});
	});
});
