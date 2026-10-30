import { beforeEach, expect, it, vi } from "vitest";
const boundary = vi.hoisted(() => ({ reader: vi.fn(), connection: vi.fn() }));
vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	getTimeClockStatus: boundary.reader,
}));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: boundary.connection,
}));
import { GET } from "./route";
const OUT = {
	hasEmployee: false,
	employeeId: null,
	isClockedIn: false,
	activeWorkPeriod: null,
};
beforeEach(() => {
	vi.clearAllMocks();
	boundary.connection.mockResolvedValue(undefined);
});
it("keeps the existing reader empty visibility tuple as200 rather than importing desktop401 policy", async () => {
	boundary.reader.mockResolvedValueOnce(OUT);
	const response = await GET();
	expect(response.status).toBe(200);
	expect(await response.json()).toEqual(OUT);
	expect(response.headers.get("cache-control")).toBe("private, no-store");
	expect(boundary.reader).toHaveBeenCalledExactlyOnceWith();
});
it("uses each fresh reader result and cannot substitute a client-supplied employee or organization", async () => {
	boundary.reader
		.mockResolvedValueOnce({
			...OUT,
			hasEmployee: true,
			employeeId: "org-a-employee",
		})
		.mockResolvedValueOnce({
			...OUT,
			hasEmployee: true,
			employeeId: "org-b-employee",
		});
	const malicious = new Request(
		"https://synthetic.invalid/api/time-clock/status?organizationId=foreign&employeeId=foreign",
	);
	const first = await Reflect.apply(GET, null, [malicious]),
		second = await GET();
	expect((await first.json()).employeeId).toBe("org-a-employee");
	expect((await second.json()).employeeId).toBe("org-b-employee");
	expect(boundary.reader).toHaveBeenCalledTimes(2);
	expect(boundary.reader.mock.calls).toEqual([[], []]);
	expect(boundary.connection).toHaveBeenCalledTimes(2);
});
it("preserves full task and open-break fields from the reader through the HTTP boundary", async () => {
	const task = {
		id: "task",
		name: "Task",
		state: "open",
		projectId: "project",
	};
	boundary.reader.mockResolvedValue({
		hasEmployee: true,
		employeeId: "employee",
		isClockedIn: true,
		activeWorkPeriod: {
			id: "period",
			startTime: new Date("2026-10-28T08:00:00.000Z"),
			currentTask: task,
			breakStartedAt: new Date("2026-10-28T10:00:00.000Z"),
			breakStartedZone: "Europe/Berlin",
		},
	});
	const response = await GET();
	expect(response.status).toBe(200);
	expect((await response.json()).activeWorkPeriod).toEqual({
		id: "period",
		startTime: "2026-10-28T08:00:00.000Z",
		currentTask: task,
		breakStartedAt: "2026-10-28T10:00:00.000Z",
		breakStartedZone: "Europe/Berlin",
	});
});
it("read/serialization/connection failures have the same private no-store generic500 contract", async () => {
	for (const stage of ["read", "serialize", "connection"]) {
		boundary.connection.mockResolvedValue(undefined);
		if (stage === "connection")
			boundary.connection.mockRejectedValueOnce(Error("PRIVATE_CONNECTION"));
		if (stage === "read")
			boundary.reader.mockRejectedValueOnce(Error("PRIVATE_SQL_TOKEN"));
		else boundary.reader.mockResolvedValueOnce({ bad: "PRIVATE_BAD_STATUS" });
		const response = await GET();
		expect(response.status).toBe(500);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(await response.json()).toEqual({
			error: "Clock status is unavailable.",
		});
		boundary.reader.mockReset();
	}
});
