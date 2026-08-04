import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	timeEntryFindMany: vi.fn(),
	workPeriodFindMany: vi.fn(),
	auditLogFindMany: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: { EXPORT_FETCH_BATCH_SIZE: "2" },
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			timeEntry: { findMany: mocks.timeEntryFindMany },
			workPeriod: { findMany: mocks.workPeriodFindMany },
			auditLog: { findMany: mocks.auditLogFindMany },
		},
	},
	timeEntry: {
		organizationId: "timeEntry.organizationId",
		employeeId: "timeEntry.employeeId",
		timestamp: "timeEntry.timestamp",
	},
	workPeriod: {
		organizationId: "workPeriod.organizationId",
		employeeId: "workPeriod.employeeId",
		startTime: "workPeriod.startTime",
	},
}));

vi.mock("@/lib/auth/derived-user-name", () => ({
	buildAuthUserDisplayName: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn() }),
}));

import {
	streamAuditLogs,
	streamTimeEntries,
	streamWorkPeriods,
} from "./data-fetchers";

beforeEach(() => {
	vi.clearAllMocks();
});

function expectConfiguredPagination(findMany: ReturnType<typeof vi.fn>) {
	expect(findMany).toHaveBeenNthCalledWith(
		1,
		expect.objectContaining({ limit: 2, offset: 0 }),
	);
	expect(findMany).toHaveBeenNthCalledWith(
		2,
		expect.objectContaining({ limit: 2, offset: 2 }),
	);
}

test("streams time entries with the configured batch limit and offset", async () => {
	const row = (id: string) => ({
		id,
		employeeId: "employee-1",
		employee: null,
		type: "clock_in",
		timestamp: new Date("2026-01-01T00:00:00.000Z"),
		location: null,
		notes: null,
	});
	mocks.timeEntryFindMany
		.mockResolvedValueOnce([row("entry-1"), row("entry-2")])
		.mockResolvedValueOnce([row("entry-3")]);

	const batches = [];
	for await (const batch of streamTimeEntries("org-1", [])) batches.push(batch);

	expect(batches.map((batch) => batch.map(({ id }) => id))).toEqual([
		["entry-1", "entry-2"],
		["entry-3"],
	]);
	expectConfiguredPagination(mocks.timeEntryFindMany);
});

test("streams work periods with the configured batch limit and offset", async () => {
	const row = (id: string) => ({
		id,
		employeeId: "employee-1",
		employee: null,
		startTime: new Date("2026-01-01T00:00:00.000Z"),
		endTime: null,
		durationMinutes: null,
		isActive: true,
	});
	mocks.workPeriodFindMany
		.mockResolvedValueOnce([row("period-1"), row("period-2")])
		.mockResolvedValueOnce([row("period-3")]);

	const batches = [];
	for await (const batch of streamWorkPeriods("org-1", [])) batches.push(batch);

	expect(batches.map((batch) => batch.map(({ id }) => id))).toEqual([
		["period-1", "period-2"],
		["period-3"],
	]);
	expectConfiguredPagination(mocks.workPeriodFindMany);
});

test("streams audit logs with the configured batch limit and offset", async () => {
	const row = (id: string) => ({
		id,
		entityType: "organization",
		entityId: "org-1",
		action: "updated",
		performedBy: null,
		changes: null,
		metadata: null,
		timestamp: new Date("2026-01-01T00:00:00.000Z"),
	});
	mocks.auditLogFindMany
		.mockResolvedValueOnce([row("audit-1"), row("audit-2")])
		.mockResolvedValueOnce([row("audit-3")]);

	const batches = [];
	for await (const batch of streamAuditLogs(
		"org-1",
		new Set(),
		new Set(),
		new Set(),
	))
		batches.push(batch);

	expect(batches.map((batch) => batch.map(({ id }) => id))).toEqual([
		["audit-1", "audit-2"],
		["audit-3"],
	]);
	expectConfiguredPagination(mocks.auditLogFindMany);
});
