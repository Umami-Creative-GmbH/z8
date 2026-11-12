import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	organizationFindFirst: vi.fn(),
	getAuditLogs: vi.fn(),
	getAuditLogStats: vi.fn(),
	exportAuditLogs: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(
		organizationActionStubLayer(() => mocks.caller, {
			db: { query: { organization: { findFirst: mocks.organizationFindFirst } } },
		}),
	);
});

vi.mock("@/lib/query/audit.queries", () => ({
	getAuditLogs: mocks.getAuditLogs,
	getAuditLogStats: mocks.getAuditLogStats,
	exportAuditLogs: mocks.exportAuditLogs,
}));

const { exportAuditLogsAction, getAuditLogsAction, getAuditStatsAction } = await import(
	"./actions"
);

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: null,
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "employee-1", role: "manager", former: false },
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "error").mockImplementation(() => {});
	mocks.caller = orgAdmin;
	mocks.organizationFindFirst.mockResolvedValue({ timezone: "Europe/Berlin" });
	mocks.getAuditLogs.mockResolvedValue({ logs: [], total: 0, hasMore: false });
	mocks.getAuditLogStats.mockResolvedValue({ totalEvents: 0 });
	mocks.exportAuditLogs.mockResolvedValue([]);
});

const range = { startDate: "2026-11-01", endDate: "2026-11-30" };

describe("audit log actions", () => {
	it.each([
		["logs", () => getAuditLogsAction({})],
		["stats", () => getAuditStatsAction(range)],
		["export", () => exportAuditLogsAction(range)],
	])("refuses the %s to a scoped manager", async (_name, run) => {
		mocks.caller = scopedManager;

		expect(await run()).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.getAuditLogs).not.toHaveBeenCalled();
		expect(mocks.getAuditLogStats).not.toHaveBeenCalled();
		expect(mocks.exportAuditLogs).not.toHaveBeenCalled();
	});

	it("reads the active organization's logs with the organization's day boundaries", async () => {
		const result = await getAuditLogsAction({ ...range, search: "login", limit: 10 });

		expect(result).toEqual({ success: true, data: { logs: [], total: 0, hasMore: false } });
		expect(mocks.getAuditLogs).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				search: "login",
				limit: 10,
				offset: 0,
				startDate: new Date("2026-10-31T23:00:00Z"),
				endDateExclusive: new Date("2026-11-30T23:00:00Z"),
			}),
		);
	});

	it("exports the active organization's logs", async () => {
		const result = await exportAuditLogsAction(range);

		expect(result).toEqual({ success: true, data: [] });
		expect(mocks.exportAuditLogs).toHaveBeenCalledWith(
			"org-1",
			new Date("2026-10-31T23:00:00Z"),
			new Date("2026-11-30T23:00:00Z"),
		);
	});

	it("reports a one-sided date filter as a failed fetch", async () => {
		const result = await getAuditLogsAction({ startDate: "2026-11-01" });

		expect(result).toMatchObject({ success: false, error: "Failed to fetch audit logs" });
		expect(mocks.getAuditLogs).not.toHaveBeenCalled();
	});
});
