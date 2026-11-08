import { beforeEach, describe, expect, it, vi } from "vitest";

const { createNotification } = vi.hoisted(() => ({ createNotification: vi.fn() }));
vi.mock("./notification-service", () => ({ createNotification }));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: () => {}, warn: () => {}, info: () => {}, debug: () => {} }),
}));

const { notifyFormerEmployeeReportsWithoutManager } = await import(
	"./former-employee-reports-without-manager"
);

const notice = {
	organizationId: "org-1",
	reports: [{ employeeId: "report-1", name: "Rhea Report" }],
	recipientUserIds: ["admin-1", "admin-2"],
};

describe("notifyFormerEmployeeReportsWithoutManager", () => {
	beforeEach(() => {
		createNotification.mockReset();
	});

	it("never throws by default", async () => {
		createNotification.mockRejectedValue(new Error("store down"));

		await expect(notifyFormerEmployeeReportsWithoutManager(notice)).resolves.toBeUndefined();
		expect(createNotification).toHaveBeenCalledTimes(2);
	});

	it("with throwOnError, still tries every admin, then throws so the caller retries", async () => {
		createNotification
			.mockRejectedValueOnce(new Error("store down"))
			.mockResolvedValueOnce({ id: "notification" });

		await expect(
			notifyFormerEmployeeReportsWithoutManager(notice, { throwOnError: true }),
		).rejects.toThrow("store down");
		expect(createNotification.mock.calls.map(([params, options]) => [params.userId, options])).toEqual(
			[
				["admin-1", { throwOnError: true }],
				["admin-2", { throwOnError: true }],
			],
		);
		// Keyed per admin and list, so a retry sends nothing new to whoever already has it.
		expect(createNotification.mock.calls[1]?.[0].idempotencyKey).toMatch(
			/^former-reports-without-manager:[0-9a-f]{16}:admin-2$/,
		);
	});
});
