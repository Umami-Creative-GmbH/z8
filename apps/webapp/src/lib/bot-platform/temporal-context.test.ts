import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import { formatInstant } from "@/lib/datetime/temporal-format";
import { assertPrimitiveDateTimePayload } from "@/lib/datetime/temporal-wire";

const mocks = vi.hoisted(() => ({
	findEmployee: vi.fn(),
	findOrganization: vi.fn(),
	findUserSettings: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({ and: vi.fn(), eq: vi.fn() }));

vi.mock("@/db", () => ({
	db: {
		query: {
			employee: { findFirst: mocks.findEmployee },
			organization: { findFirst: mocks.findOrganization },
			userSettings: { findFirst: mocks.findUserSettings },
		},
	},
}));

vi.mock("@/db/auth-schema", () => ({ organization: { id: "organization.id" } }));
vi.mock("@/db/schema", () => ({
	employee: {
		id: "employee.id",
		userId: "employee.userId",
		organizationId: "employee.organizationId",
	},
	userSettings: { userId: "userSettings.userId" },
}));

import { resolveBotTemporalContext, serializeBotTemporalContext } from "./temporal-context";

describe("resolveBotTemporalContext", () => {
	beforeEach(() => {
		mocks.findEmployee.mockReset();
		mocks.findOrganization.mockReset();
		mocks.findUserSettings.mockReset();
		vi.unstubAllEnvs();
	});

	it("keeps a saved UTC preference instead of falling back to the organization", async () => {
		mocks.findEmployee.mockResolvedValue({ id: "employee-1" });
		mocks.findOrganization.mockResolvedValue({ timezone: "Europe/Berlin" });
		mocks.findUserSettings.mockResolvedValue({
			timezone: "UTC",
			locale: "de",
			timeFormat: "12h",
		});

		await expect(
			resolveBotTemporalContext({
				userId: "user-1",
				employeeId: "employee-1",
				organizationId: "organization-1",
			}),
		).resolves.toMatchObject({
			effectiveTimezone: "UTC",
			organizationTimezone: "Europe/Berlin",
			locale: "de",
			timeFormat: "12h",
		});
	});

	it("falls back to the valid organization timezone when the persisted user timezone is invalid", async () => {
		mocks.findEmployee.mockResolvedValue({ id: "employee-1" });
		mocks.findOrganization.mockResolvedValue({ timezone: "America/New_York" });
		mocks.findUserSettings.mockResolvedValue({
			timezone: "Invalid/Zone",
			locale: null,
			timeFormat: null,
		});

		await expect(
			resolveBotTemporalContext({
				userId: "user-1",
				employeeId: "employee-1",
				organizationId: "organization-1",
			}),
		).resolves.toMatchObject({
			effectiveTimezone: "America/New_York",
			organizationTimezone: "America/New_York",
			locale: "en",
			timeFormat: "24h",
		});
	});

	it("rejects a user without an employee membership in the active organization", async () => {
		mocks.findEmployee.mockResolvedValue(undefined);

		await expect(
			resolveBotTemporalContext({
				userId: "user-1",
				employeeId: "employee-from-another-organization",
				organizationId: "organization-1",
			}),
		).resolves.toBeNull();
		expect(mocks.findOrganization).not.toHaveBeenCalled();
		expect(mocks.findUserSettings).not.toHaveBeenCalled();
	});

	it("projects context for external payloads without Temporal objects", async () => {
		mocks.findEmployee.mockResolvedValue({ id: "employee-1" });
		mocks.findOrganization.mockResolvedValue({ timezone: "Europe/Berlin" });
		mocks.findUserSettings.mockResolvedValue({ timezone: "UTC", locale: "en", timeFormat: "24h" });
		const context = await resolveBotTemporalContext({
			userId: "user-1",
			employeeId: "employee-1",
			organizationId: "organization-1",
			clock: { nowInstant: () => parseInstant("2026-07-10T12:30:00.000Z") },
		});

		expect(context).not.toBeNull();
		const payload = serializeBotTemporalContext(context!);
		expect(payload.now).toBe("2026-07-10T12:30:00.000Z");
		assertPrimitiveDateTimePayload(payload);
	});

	it("formats an explicit context identically regardless of the host timezone", async () => {
		mocks.findEmployee.mockResolvedValue({ id: "employee-1" });
		mocks.findOrganization.mockResolvedValue({ timezone: "Europe/Berlin" });
		mocks.findUserSettings.mockResolvedValue({
			timezone: "UTC",
			locale: "en-GB",
			timeFormat: "24h",
		});
		const context = await resolveBotTemporalContext({
			userId: "user-1",
			employeeId: "employee-1",
			organizationId: "organization-1",
		});

		expect(context).not.toBeNull();
		const instant = parseInstant("2026-07-10T12:30:00Z");
		const utcHost = formatInstant(instant, context!, "time");
		vi.stubEnv("TZ", "Pacific/Honolulu");
		const honoluluHost = formatInstant(instant, context!, "time");

		expect(honoluluHost).toBe(utcHost);
	});
});
