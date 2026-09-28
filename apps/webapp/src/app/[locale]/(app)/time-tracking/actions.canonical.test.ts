import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee, timeEntry, workPeriod } from "@/db/schema";

vi.mock("@/env", () => ({
	env: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

const mockState = vi.hoisted(() => {
	const headers = vi.fn();
	const dbInsert = vi.fn();

	return {
		headers,
		dbInsert,
	};
});

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("@/db", () => ({
	db: {
		insert: mockState.dbInsert,
	},
}));

const actions = await import("./actions");
const canonicalActions = await import("./actions.canonical");

describe("time-tracking canonical action routing", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.headers.mockResolvedValue({
			get: (name: string) => {
				if (name === "x-forwarded-for") return "203.0.113.10";
				if (name === "user-agent") return "vitest-agent";
				return null;
			},
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	// #327: the unauthenticated raw entry writer exported from the actions module
	// had no caller; correction entries are written by their owners only.
	it("exposes no raw time entry writer as a server action", () => {
		expect(actions).not.toHaveProperty("createTimeEntry");
	});

	it("delegates a correction with its work period through the real service", async () => {
		const period = {
			id: "period-1",
			employeeId: "emp-1",
			organizationId: "org-1",
			clockInId: "entry-old",
			clockOutId: "entry-out",
			startTime: new Date("2026-01-01T08:00:00.000Z"),
			endTime: new Date("2026-01-01T17:00:00.000Z"),
			canonicalRecordId: null,
		};
		const original = {
			id: "entry-old",
			employeeId: "emp-1",
			organizationId: "org-1",
			isSuperseded: false,
		};
		const created = { id: "entry-corr" };
		const select = vi.fn(() => ({
			from: vi.fn((table: unknown) => ({
				where: vi.fn(() => {
					const rows =
						table === employee
							? [
									{
										id: "emp-1",
										userId: "user-1",
										organizationId: "org-1",
										isActive: true,
										role: "employee",
									},
								]
							: table === member
								? [{ id: "member-1" }]
								: table === workPeriod
									? [period]
									: table === timeEntry
										? [original]
										: [];
					return {
						for: vi.fn().mockResolvedValue(rows),
						orderBy: vi.fn(() => ({
							for: vi.fn().mockResolvedValue(rows),
							limit: vi
								.fn()
								.mockResolvedValue([{ id: "entry-previous", hash: "hash" }]),
						})),
					};
				}),
			})),
		}));
		const update = vi.fn((table: unknown) => ({
			set: vi.fn(() => ({
				where: vi.fn(() =>
					table === timeEntry || table === workPeriod
						? { returning: vi.fn().mockResolvedValue([{ id: "updated" }]) }
						: Promise.resolve(),
				),
			})),
		}));
		const transaction = {
			insert: vi.fn(() => ({
				values: vi.fn(() => ({
					returning: vi.fn().mockResolvedValue([created]),
				})),
			})),
			query: {
				approvalRequest: { findFirst: vi.fn().mockResolvedValue(null) },
				approvalWorkflow: { findFirst: vi.fn().mockResolvedValue(null) },
			},
			select,
			update,
		};

		await expect(
			canonicalActions.canonicalTimeEntryClient.createCorrectionEntry(
				{
					employeeId: "emp-1",
					organizationId: "org-1",
					timestamp: new Date("2026-01-01T08:30:00.000Z"),
					createdBy: "user-1",
					notes: "",
					replacesEntryId: "entry-old",
					workPeriodId: "period-1",
					utcOffsetMinutes: 0,
					timezone: "UTC",
					timezoneSource: "user_setting",
				},
				transaction as never,
			),
		).resolves.toEqual(created);
		expect(select).toHaveBeenCalled();
		expect(update).toHaveBeenCalledWith(workPeriod);
	});
});
