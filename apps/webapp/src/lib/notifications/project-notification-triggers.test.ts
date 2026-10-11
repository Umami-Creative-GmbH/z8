import { Temporal } from "temporal-polyfill";
import { beforeEach, describe, expect, it, vi } from "vitest";

const projectFindManyMock = vi.fn();
const notificationStateFindFirstMock = vi.fn();
const loadOrganizationTimezoneMock = vi.fn();
const createNotificationMock = vi.fn();

vi.mock("@/db", () => {
	const managersQuery = {
		from: () => managersQuery,
		innerJoin: () => managersQuery,
		where: async () => [{ userId: "user-1", employeeId: "employee-1", name: "Manager" }],
	};
	const updateQuery = { set: () => updateQuery, where: async () => undefined };

	return {
		db: {
			query: {
				project: { findMany: projectFindManyMock },
				projectNotificationState: { findFirst: notificationStateFindFirstMock },
			},
			select: () => managersQuery,
			update: () => updateQuery,
		},
	};
});

vi.mock("@/db/auth-schema", () => ({ user: { id: "user.id", name: "user.name" } }));

vi.mock("@/db/schema", () => ({
	employee: { id: "employee.id", userId: "employee.userId" },
	project: { status: "project.status" },
	projectManager: {
		employeeId: "projectManager.employeeId",
		projectId: "projectManager.projectId",
	},
	projectNotificationState: { projectId: "projectNotificationState.projectId" },
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: loadOrganizationTimezoneMock,
}));

vi.mock("./notification-service", () => ({ createNotification: createNotificationMock }));

const organizationTimeZones: Record<string, string> = {
	"org-berlin": "Europe/Berlin",
	"org-new-york": "America/New_York",
};

function activeProject(id: string, organizationId: string) {
	return {
		id,
		name: id,
		organizationId,
		// The deadline day 10 May 2026, stored as its UTC midnight.
		deadline: new Date("2026-05-10T00:00:00.000Z"),
		status: "active",
	};
}

describe("checkAndSendDeadlineNotifications", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		notificationStateFindFirstMock.mockResolvedValue({
			projectId: "any",
			budgetThresholdsNotified: [],
			deadlineThresholdsNotified: [],
		});
		loadOrganizationTimezoneMock.mockImplementation(
			async (_db: unknown, organizationId: string) => organizationTimeZones[organizationId],
		);
		createNotificationMock.mockResolvedValue(undefined);
	});

	it("counts deadline days from each organization's calendar date", async () => {
		projectFindManyMock.mockResolvedValue([
			activeProject("berlin-1", "org-berlin"),
			activeProject("berlin-2", "org-berlin"),
			activeProject("new-york-1", "org-new-york"),
		]);
		const { checkAndSendDeadlineNotifications } = await import("./project-notification-triggers");

		// 01:30 on 10 May in Berlin, 19:30 on 9 May in New York.
		await checkAndSendDeadlineNotifications({
			nowInstant: () => Temporal.Instant.from("2026-05-09T23:30:00Z"),
		});

		const sent = createNotificationMock.mock.calls.map(([notification]) => ({
			organizationId: notification.organizationId,
			entityId: notification.entityId,
			type: notification.type,
			daysUntilDeadline: notification.metadata.daysUntilDeadline,
		}));
		expect(sent).toEqual(
			expect.arrayContaining([
				{
					organizationId: "org-berlin",
					entityId: "berlin-1",
					type: "project_deadline_warning_0d",
					daysUntilDeadline: 0,
				},
				{
					organizationId: "org-berlin",
					entityId: "berlin-2",
					type: "project_deadline_warning_0d",
					daysUntilDeadline: 0,
				},
				{
					organizationId: "org-new-york",
					entityId: "new-york-1",
					type: "project_deadline_warning_1d",
					daysUntilDeadline: 1,
				},
			]),
		);
		expect(sent).toHaveLength(3);
		// One timezone lookup per organization, not per project.
		expect(
			loadOrganizationTimezoneMock.mock.calls.map(([, organizationId]) => organizationId),
		).toEqual(["org-berlin", "org-new-york"]);
	});

	it("names the stored deadline day in the message whatever the server zone", async () => {
		projectFindManyMock.mockResolvedValue([activeProject("new-york-1", "org-new-york")]);
		const { checkAndSendDeadlineNotifications } = await import("./project-notification-triggers");
		const serverTimeZone = process.env.TZ;
		// West of UTC, the stored UTC midnight is still the previous local day.
		process.env.TZ = "America/Los_Angeles";

		try {
			await checkAndSendDeadlineNotifications({
				nowInstant: () => Temporal.Instant.from("2026-05-09T23:30:00Z"),
			});
		} finally {
			if (serverTimeZone === undefined) delete process.env.TZ;
			else process.env.TZ = serverTimeZone;
		}

		expect(createNotificationMock.mock.calls[0]?.[0].message).toContain("May 10, 2026");
	});
});
