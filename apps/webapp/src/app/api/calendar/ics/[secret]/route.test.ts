import { beforeEach, describe, expect, it, vi } from "vitest";

type Predicate = {
	op: string;
	args?: Predicate[];
	left?: string;
	right?: unknown;
};

const mockState = vi.hoisted(() => ({
	connection: vi.fn(),
	icsFeedFindFirst: vi.fn(),
	employeeFindFirst: vi.fn(),
	employeeFindMany: vi.fn(),
	teamFindFirst: vi.fn(),
	update: vi.fn(),
	select: vi.fn(),
	updateWherePredicates: [] as Predicate[],
	selectWherePredicates: [] as Predicate[],
	mapAbsencesToICSEvents: vi.fn(() => []),
	generateICS: vi.fn(() => "BEGIN:VCALENDAR\nEND:VCALENDAR"),
}));

vi.mock("next/server", async () => {
	const actual = await vi.importActual<typeof import("next/server")>("next/server");
	return {
		...actual,
		connection: mockState.connection,
	};
});

vi.mock("drizzle-orm", () => ({
	and: (...args: Predicate[]) => ({ op: "and", args }),
	eq: (left: string, right: unknown) => ({ op: "eq", left, right }),
	gte: (left: string, right: unknown) => ({ op: "gte", left, right }),
	inArray: (left: string, right: unknown) => ({ op: "inArray", left, right }),
	lte: (left: string, right: unknown) => ({ op: "lte", left, right }),
	or: (...args: Predicate[]) => ({ op: "or", args }),
}));

vi.mock("@/db/schema", () => ({
	absenceCategory: {
		id: "absenceCategory.id",
		organizationId: "absenceCategory.organizationId",
		name: "absenceCategory.name",
		type: "absenceCategory.type",
		color: "absenceCategory.color",
		countsAgainstVacation: "absenceCategory.countsAgainstVacation",
	},
	absenceEntry: {
		id: "absenceEntry.id",
		organizationId: "absenceEntry.organizationId",
		employeeId: "absenceEntry.employeeId",
		categoryId: "absenceEntry.categoryId",
		status: "absenceEntry.status",
		startDate: "absenceEntry.startDate",
		startPeriod: "absenceEntry.startPeriod",
		endDate: "absenceEntry.endDate",
		endPeriod: "absenceEntry.endPeriod",
		notes: "absenceEntry.notes",
		sickDetail: "absenceEntry.sickDetail",
		approvedBy: "absenceEntry.approvedBy",
		approvedAt: "absenceEntry.approvedAt",
		rejectionReason: "absenceEntry.rejectionReason",
		createdAt: "absenceEntry.createdAt",
	},
	icsFeed: {
		id: "icsFeed.id",
		organizationId: "icsFeed.organizationId",
		secret: "icsFeed.secret",
		isActive: "icsFeed.isActive",
		lastAccessedAt: "icsFeed.lastAccessedAt",
	},
}));

vi.mock("@/db/schema/organization", () => ({
	employee: {
		id: "employee.id",
		organizationId: "employee.organizationId",
		teamId: "employee.teamId",
		userId: "employee.userId",
	},
	team: {
		id: "team.id",
		organizationId: "team.organizationId",
		name: "team.name",
	},
}));

vi.mock("@/db/auth-schema", () => ({
	user: {
		id: "user.id",
		name: "user.name",
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			icsFeed: { findFirst: mockState.icsFeedFindFirst },
			employee: {
				findFirst: mockState.employeeFindFirst,
				findMany: mockState.employeeFindMany,
			},
			team: { findFirst: mockState.teamFindFirst },
		},
		update: mockState.update,
		select: mockState.select,
	},
}));

vi.mock("@/lib/calendar-sync/domain", () => ({
	generateICS: mockState.generateICS,
	mapAbsencesToICSEvents: mockState.mapAbsencesToICSEvents,
}));

const { GET } = await import("./route");

function makeFeed(overrides: Record<string, unknown>) {
	return {
		id: "feed-1",
		organizationId: "org-feed",
		includeApproved: true,
		includePending: true,
		employeeId: null,
		teamId: null,
		...overrides,
	};
}

function hasEq(predicate: Predicate | undefined, left: string, right: unknown): boolean {
	if (!predicate) return false;
	if (predicate.op === "eq" && predicate.left === left && predicate.right === right) {
		return true;
	}
	return predicate.args?.some((arg) => hasEq(arg, left, right)) ?? false;
}

function expectEq(predicate: Predicate | undefined, left: string, right: unknown) {
	expect(hasEq(predicate, left, right), `${left} = ${String(right)}`).toBe(true);
}

function buildSelectQuery() {
	return {
		from: vi.fn().mockReturnThis(),
		innerJoin: vi.fn().mockReturnThis(),
		where: vi.fn((predicate: Predicate) => {
			mockState.selectWherePredicates.push(predicate);
			return Promise.resolve([]);
		}),
	};
}

describe("GET /api/calendar/ics/[secret]", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.updateWherePredicates.length = 0;
		mockState.selectWherePredicates.length = 0;
		mockState.connection.mockResolvedValue(undefined);
		mockState.update.mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn((predicate: Predicate) => {
					mockState.updateWherePredicates.push(predicate);
					return {
						catch: vi.fn(),
					};
				}),
			}),
		});
		mockState.select.mockImplementation(buildSelectQuery);
	});

	it("scopes the last-accessed update to the feed organization", async () => {
		mockState.icsFeedFindFirst.mockResolvedValue(
			makeFeed({
				organizationId: "org-1",
				includeApproved: false,
				includePending: false,
				feedType: "user",
				employeeId: "employee-feed",
			}),
		);

		const response = await GET(
			new Request("https://app.example.com/api/calendar/ics/secret") as never,
			{
				params: Promise.resolve({ secret: "secret" }),
			},
		);

		expect(response.status).toBe(200);
		const updateWhere = mockState.updateWherePredicates[0];
		expectEq(updateWhere, "icsFeed.id", "feed-1");
		expectEq(updateWhere, "icsFeed.organizationId", "org-1");
	});

	it("scopes a user feed's employee, absence, and category queries to the feed organization", async () => {
		mockState.icsFeedFindFirst.mockResolvedValue(
			makeFeed({ feedType: "user", employeeId: "employee-feed" }),
		);
		mockState.employeeFindFirst.mockResolvedValue({ user: { name: "Ada" } });

		const response = await GET(
			new Request("https://app.example.com/api/calendar/ics/secret") as never,
			{
				params: Promise.resolve({ secret: "secret" }),
			},
		);

		expect(response.status).toBe(200);
		const employeeWhere = mockState.employeeFindFirst.mock.calls[0]?.[0]?.where as Predicate;
		expectEq(employeeWhere, "employee.id", "employee-feed");
		expectEq(employeeWhere, "employee.organizationId", "org-feed");
		const absenceWhere = mockState.selectWherePredicates[0];
		expectEq(absenceWhere, "absenceEntry.employeeId", "employee-feed");
		expectEq(absenceWhere, "absenceEntry.organizationId", "org-feed");
		expectEq(absenceWhere, "employee.organizationId", "org-feed");
		expectEq(absenceWhere, "absenceCategory.organizationId", "org-feed");
	});

	it("scopes a team feed's team, team-employee, absence, and category queries to the feed organization", async () => {
		mockState.icsFeedFindFirst.mockResolvedValue(
			makeFeed({ feedType: "team", teamId: "team-feed" }),
		);
		mockState.teamFindFirst.mockResolvedValue({ name: "Ops" });
		mockState.employeeFindMany.mockResolvedValue([{ id: "employee-feed" }]);

		const response = await GET(
			new Request("https://app.example.com/api/calendar/ics/secret") as never,
			{
				params: Promise.resolve({ secret: "secret" }),
			},
		);

		expect(response.status).toBe(200);
		const teamWhere = mockState.teamFindFirst.mock.calls[0]?.[0]?.where as Predicate;
		expectEq(teamWhere, "team.id", "team-feed");
		expectEq(teamWhere, "team.organizationId", "org-feed");
		const teamEmployeesWhere = mockState.employeeFindMany.mock.calls[0]?.[0]?.where as Predicate;
		expectEq(teamEmployeesWhere, "employee.teamId", "team-feed");
		expectEq(teamEmployeesWhere, "employee.organizationId", "org-feed");
		const absenceWhere = mockState.selectWherePredicates[0];
		expectEq(absenceWhere, "absenceEntry.organizationId", "org-feed");
		expectEq(absenceWhere, "employee.organizationId", "org-feed");
		expectEq(absenceWhere, "absenceCategory.organizationId", "org-feed");
	});
});
