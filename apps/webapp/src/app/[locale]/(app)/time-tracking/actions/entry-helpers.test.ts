import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	calculateHash: vi.fn(() => "entry-hash"),
	getRequestMetadata: vi.fn(async () => ({ ipAddress: "127.0.0.1", userAgent: "test-agent" })),
}));

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/time-tracking/blockchain", () => ({ calculateHash: mocks.calculateHash }));
vi.mock("./auth", () => ({ getRequestMetadata: mocks.getRequestMetadata }));

const { createTimeEntry } = await import("./entry-helpers");

describe("createTimeEntry", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("stores the previous entry ID with the previous hash", async () => {
		const previousEntry = { id: "entry-previous", hash: "previous-hash" };
		const limit = vi.fn().mockResolvedValue([previousEntry]);
		const orderBy = vi.fn(() => ({ limit }));
		const where = vi.fn(() => ({ orderBy }));
		const from = vi.fn(() => ({ where }));
		const select = vi.fn(() => ({ from }));
		const returning = vi.fn().mockResolvedValue([{ id: "entry-new" }]);
		const values = vi.fn(() => ({ returning }));
		const insert = vi.fn(() => ({ values }));

		await createTimeEntry(
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "correction",
				timestamp: new Date("2026-07-01T08:15:00.000Z"),
				createdBy: "user-1",
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
			},
			{ select, insert } as never,
		);

		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				previousHash: "previous-hash",
				previousEntryId: "entry-previous",
			}),
		);
	});

	it("uses an explicit chain predecessor without querying for it again", async () => {
		const select = vi.fn();
		const returning = vi.fn().mockResolvedValue([{ id: "entry-new" }]);
		const values = vi.fn(() => ({ returning }));
		const insert = vi.fn(() => ({ values }));

		await createTimeEntry(
			{
				employeeId: "employee-1",
				organizationId: "org-1",
				type: "correction",
				timestamp: new Date("2026-07-01T08:15:00.000Z"),
				createdBy: "user-1",
				utcOffsetMinutes: 120,
				timezone: "Europe/Berlin",
				timezoneSource: "user_setting",
				chainAfter: {
					id: "entry-first",
					hash: "first-hash",
					employeeId: "employee-1",
					organizationId: "org-1",
				},
			},
			{ select, insert } as never,
		);

		expect(select).not.toHaveBeenCalled();
		expect(values).toHaveBeenCalledWith(
			expect.objectContaining({
				previousHash: "first-hash",
				previousEntryId: "entry-first",
			}),
		);
	});

	it("rejects a chain predecessor from another employee or organization", async () => {
		await expect(
			createTimeEntry(
				{
					employeeId: "employee-1",
					organizationId: "org-1",
					type: "correction",
					timestamp: new Date("2026-07-01T08:15:00.000Z"),
					createdBy: "user-1",
					utcOffsetMinutes: 120,
					timezone: "Europe/Berlin",
					timezoneSource: "user_setting",
					chainAfter: {
						id: "entry-other",
						hash: "other-hash",
						employeeId: "employee-2",
						organizationId: "org-1",
					},
				},
				{ select: vi.fn(), insert: vi.fn() } as never,
			),
		).rejects.toThrow("same employee and organization");
	});
});
