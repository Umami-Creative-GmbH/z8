import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	organizationTimezone: null as string | null,
	settingsTimezone: null as string | null,
	organizationFindFirst: vi.fn(),
	userSettingsFindFirst: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	eq: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: { findFirst: mocks.organizationFindFirst },
			userSettings: { findFirst: mocks.userSettingsFindFirst },
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({
	organization: { id: "organization.id" },
}));

vi.mock("@/db/schema", () => ({
	userSettings: { userId: "user_settings.user_id" },
}));

import {
	getEffectiveTimezone,
	getEffectiveTimezoneWithContext,
	resolveEffectiveTimezone,
} from "./effective-timezone";

describe("effective timezone", () => {
	beforeEach(() => {
		vi.spyOn(console, "warn").mockImplementation(() => undefined);
		mocks.settingsTimezone = null;
		mocks.organizationTimezone = null;
		mocks.userSettingsFindFirst.mockImplementation(async () =>
			mocks.settingsTimezone === null ? undefined : { timezone: mocks.settingsTimezone },
		);
		mocks.organizationFindFirst.mockImplementation(async () =>
			mocks.organizationTimezone === null ? undefined : { timezone: mocks.organizationTimezone },
		);
		mocks.userSettingsFindFirst.mockClear();
		mocks.organizationFindFirst.mockClear();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("treats a saved UTC user timezone as authoritative", async () => {
		mocks.settingsTimezone = "UTC";
		mocks.organizationTimezone = "Europe/Berlin";

		expect(resolveEffectiveTimezone("UTC", "Europe/Berlin")).toBe("UTC");
		expect(await getEffectiveTimezone("user-1", "organization-1")).toBe("UTC");
		expect(mocks.organizationFindFirst).not.toHaveBeenCalled();
	});

	it("uses the organization timezone when the user has no preference", async () => {
		mocks.organizationTimezone = "Europe/Berlin";

		expect(await getEffectiveTimezoneWithContext("user-1", "organization-1")).toEqual({
			effectiveTimezone: "Europe/Berlin",
			userTimezone: null,
			orgTimezone: "Europe/Berlin",
			source: "organization",
		});
	});

	it("falls through invalid user and organization values with default source context", async () => {
		mocks.settingsTimezone = "Invalid/User_Zone";
		mocks.organizationTimezone = "Invalid/Organization_Zone";

		expect(await getEffectiveTimezoneWithContext("user-1", "organization-1")).toEqual({
			effectiveTimezone: "UTC",
			userTimezone: "Invalid/User_Zone",
			orgTimezone: "Invalid/Organization_Zone",
			source: "default",
		});
		expect(console.warn).toHaveBeenCalledWith("Invalid persisted timezone candidates", {
			invalidCandidates: [
				{ source: "user", value: "Invalid/User_Zone" },
				{ source: "organization", value: "Invalid/Organization_Zone" },
			],
		});
	});

	it("warns from the server helper but keeps pure resolution side-effect free", async () => {
		mocks.settingsTimezone = "Invalid/User_Zone";
		mocks.organizationTimezone = "Europe/Berlin";

		expect(resolveEffectiveTimezone("Invalid/User_Zone", "Europe/Berlin")).toBe("Europe/Berlin");
		expect(console.warn).not.toHaveBeenCalled();
		expect(await getEffectiveTimezone("user-1", "organization-1")).toBe("Europe/Berlin");
		expect(console.warn).toHaveBeenCalledWith("Invalid persisted timezone candidates", {
			invalidCandidates: [{ source: "user", value: "Invalid/User_Zone" }],
		});
	});
});
