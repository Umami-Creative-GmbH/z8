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

		const notification = createNotificationMock.mock.calls[0]?.[0];
		expect(notification.message).toContain("May 10, 2026");
		// Each channel formats the UTC calendar day in the recipient's language.
		expect(notification.metadata.i18n).toMatchObject({
			titleKey: "common:notifications.content.projectDeadlineWarning1d.title",
			messageKey: "common:notifications.content.projectDeadlineWarning1d.message",
			params: {
				projectName: "new-york-1",
				deadline: { kind: "plainDate", date: "2026-05-10", preset: "dateMedium" },
			},
		});
	});
});

describe("checkProjectBudgetWarnings", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		notificationStateFindFirstMock.mockResolvedValue({
			projectId: "project-1",
			budgetThresholdsNotified: [70],
			deadlineThresholdsNotified: [],
		});
		createNotificationMock.mockResolvedValue(undefined);
	});

	it("translates each newly crossed threshold with typed hours", async () => {
		const { checkProjectBudgetWarnings } = await import("./project-notification-triggers");

		await checkProjectBudgetWarnings({
			projectId: "project-1",
			projectName: "Website",
			organizationId: "org-1",
			budgetHours: 40,
			usedHours: 41.25,
		});

		const sent = createNotificationMock.mock.calls.map(([notification]) => notification);
		expect(sent.map((notification) => notification.type).sort()).toEqual([
			"project_budget_warning_100",
			"project_budget_warning_90",
		]);
		const exceeded = sent.find((notification) => notification.type === "project_budget_warning_100");
		expect(exceeded).toMatchObject({
			title: "Project budget exceeded",
			message:
				'"Website" has exceeded its budget (41 hours 15 minutes of 40 hours budgeted). Review and adjust as needed.',
			metadata: {
				i18n: {
					titleKey: "common:notifications.content.projectBudgetWarning100.title",
					messageKey: "common:notifications.content.projectBudgetWarning100.message",
					params: {
						projectName: "Website",
						percent: 103,
						used: { kind: "duration", minutes: 2475 },
						budget: { kind: "duration", minutes: 2400 },
					},
				},
			},
		});
		const near = sent.find((notification) => notification.type === "project_budget_warning_90");
		expect(near?.message).toBe(
			'"Website" has used 103% of its budget (41 hours 15 minutes of 40 hours). Consider reviewing time allocations.',
		);
	});
});
