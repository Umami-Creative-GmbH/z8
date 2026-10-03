import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/db", () => ({
	db: { query: { userSettings: { findFirst: state.findFirst } } },
}));
vi.mock("@/db/schema", () => ({
	userSettings: { userId: "userSettings.userId" },
}));
vi.mock("drizzle-orm", () => ({
	eq: (column: unknown, value: unknown) => ({ column, value }),
}));

import { readUserPreferences } from "./render-snapshot";

const defaults = {
	locale: null,
	weekStartDay: "sunday",
	timeFormat: "24h",
	timezone: "UTC",
	helpImproveProduct: true,
};

describe("readUserPreferences", () => {
	beforeEach(() => vi.resetAllMocks());

	it.each([
		undefined,
		{},
		{
			locale: null,
			weekStartDay: null,
			timeFormat: null,
			timezone: null,
			helpImproveProduct: null,
		},
	])("retains all defaults for absent or partial settings %j", async (row) => {
		state.findFirst.mockResolvedValue(row);
		expect(await readUserPreferences("user-1")).toEqual(defaults);
	});

	it("selects only the five presentation preferences for the authorized user", async () => {
		await readUserPreferences("user-1");
		expect(state.findFirst).toHaveBeenCalledExactlyOnceWith({
			where: { column: "userSettings.userId", value: "user-1" },
			columns: {
				locale: true,
				weekStartDay: true,
				timeFormat: true,
				timezone: true,
				helpImproveProduct: true,
			},
		});
	});

	it.each(["en", "de", "fr", "es", "it", "pt", "el", "pl", "tr", "gsw"])(
		"preserves supported saved locale %s",
		async (locale) => {
			state.findFirst.mockResolvedValue({ locale });
			expect(await readUserPreferences("user-1")).toEqual({
				...defaults,
				locale,
			});
		},
	);

	it.each(["", "unsupported", "EN"])(
		"leaves invalid locale %j unset",
		async (locale) => {
			state.findFirst.mockResolvedValue({ locale });
			expect((await readUserPreferences("user-1")).locale).toBeNull();
		},
	);

	it("normalizes invalid presentation settings and empty timezone", async () => {
		state.findFirst.mockResolvedValue({
			weekStartDay: "invalid",
			timeFormat: "invalid",
			timezone: "",
		});
		expect(await readUserPreferences("user-1")).toEqual(defaults);
	});

	it("preserves nondefault settings and explicit false analytics consent", async () => {
		state.findFirst.mockResolvedValue({
			locale: "de",
			weekStartDay: "monday",
			timeFormat: "12h",
			timezone: "Europe/Berlin",
			helpImproveProduct: false,
		});
		expect(await readUserPreferences("user-1")).toEqual({
			locale: "de",
			weekStartDay: "monday",
			timeFormat: "12h",
			timezone: "Europe/Berlin",
			helpImproveProduct: false,
		});
	});

	it("reads again after a preference write and keeps another user's settings separate", async () => {
		const rows = new Map<string, Record<string, unknown>>();
		state.findFirst.mockImplementation(
			({ where }: { where: { value: string } }) => rows.get(where.value),
		);
		expect(await readUserPreferences("user-1")).toEqual(defaults);
		rows.set("user-1", { locale: "de", helpImproveProduct: false });
		expect(await readUserPreferences("user-1")).toEqual({
			...defaults,
			locale: "de",
			helpImproveProduct: false,
		});
		rows.set("user-2", { helpImproveProduct: false });
		expect((await readUserPreferences("user-2")).helpImproveProduct).toBe(
			false,
		);
		expect(state.findFirst).toHaveBeenCalledTimes(3);
	});
});
