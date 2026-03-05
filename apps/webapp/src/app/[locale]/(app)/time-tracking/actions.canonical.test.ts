import { beforeEach, describe, expect, it, vi } from "vitest";

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

	it("routes standard time entry writes through canonical client", async () => {
		const createTimeEntrySpy = vi
			.spyOn(actions.canonicalTimeEntryClient, "createTimeEntry")
			.mockResolvedValue({ id: "entry-1" } as never);
		const createCorrectionSpy = vi
			.spyOn(actions.canonicalTimeEntryClient, "createCorrectionEntry")
			.mockResolvedValue({ id: "entry-corr" } as never);

		const result = await actions.createTimeEntry({
			employeeId: "emp-1",
			organizationId: "org-1",
			type: "clock_in",
			timestamp: new Date("2026-01-01T08:00:00.000Z"),
			createdBy: "user-1",
			notes: "start",
		});

		expect(result).toEqual({ id: "entry-1" });
		expect(createTimeEntrySpy).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "emp-1",
				organizationId: "org-1",
				type: "clock_in",
				createdBy: "user-1",
				ipAddress: "203.0.113.10",
				deviceInfo: "vitest-agent",
			}),
		);
		expect(createCorrectionSpy).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});

	it("routes correction writes through canonical correction client", async () => {
		const createTimeEntrySpy = vi
			.spyOn(actions.canonicalTimeEntryClient, "createTimeEntry")
			.mockResolvedValue({ id: "entry-1" } as never);
		const createCorrectionSpy = vi
			.spyOn(actions.canonicalTimeEntryClient, "createCorrectionEntry")
			.mockResolvedValue({ id: "entry-corr" } as never);

		const result = await actions.createTimeEntry({
			employeeId: "emp-1",
			organizationId: "org-1",
			type: "correction",
			timestamp: new Date("2026-01-01T08:30:00.000Z"),
			createdBy: "user-1",
			replacesEntryId: "entry-old",
		});

		expect(result).toEqual({ id: "entry-corr" });
		expect(createCorrectionSpy).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "emp-1",
				organizationId: "org-1",
				replacesEntryId: "entry-old",
				notes: "",
				ipAddress: "203.0.113.10",
				deviceInfo: "vitest-agent",
			}),
		);
		expect(createTimeEntrySpy).not.toHaveBeenCalled();
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});
});
