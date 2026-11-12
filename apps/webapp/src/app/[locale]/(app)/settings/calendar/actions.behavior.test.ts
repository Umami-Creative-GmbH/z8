import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	upsert: vi.fn(),
}));

function connection(id: string, employeeId: string, provider = "google") {
	return {
		id,
		employeeId,
		organizationId: "org-1",
		provider,
		providerAccountId: `${id}@example.com`,
		calendarId: "primary",
		pushEnabled: true,
		conflictDetectionEnabled: true,
		lastSyncAt: null,
		lastSyncError: null,
		isActive: true,
		createdAt: new Date("2026-02-01T12:00:00.000Z"),
		employee: { id: employeeId, user: null },
	};
}

const db = vi.hoisted(() => ({
	query: {
		teamPermissions: {
			findMany: async () => [{ teamId: "team-managed", canManageTeamSettings: true }],
		},
		locationEmployee: {
			findMany: async (query: { columns: Record<string, boolean> }) =>
				query.columns.locationId
					? [{ locationId: "location-managed" }]
					: [{ employeeId: "employee-location" }],
		},
		subareaEmployee: {
			findMany: async (query: { columns: Record<string, boolean> }) =>
				query.columns.subareaId
					? [{ subareaId: "subarea-managed" }]
					: [{ employeeId: "employee-subarea" }],
		},
		projectManager: { findMany: async () => [{ projectId: "project-managed" }] },
		project: { findMany: async () => [{ id: "project-managed" }] },
		projectAssignment: {
			findMany: async () => [
				{ assignmentType: "employee", employeeId: "employee-project", teamId: null },
				{ assignmentType: "team", employeeId: null, teamId: "team-project" },
			],
		},
		employee: {
			findMany: async () => [{ id: "employee-team" }, { id: "employee-project-team" }],
		},
		calendarConnection: { findMany: async () => [] as unknown[] },
		organizationCalendarSettings: {
			findFirst: async () => ({
				googleEnabled: true,
				microsoft365Enabled: false,
				icsFeedsEnabled: true,
				teamIcsFeedsEnabled: false,
				autoSyncOnApproval: true,
				conflictDetectionRequired: true,
				eventTitleTemplate: "Out of Office - {categoryName}",
				eventDescriptionTemplate: "Managed by Z8",
			}),
		},
	},
	insert: () => ({
		values: (values: unknown) => ({
			onConflictDoUpdate: async () => {
				mocks.upsert(values);
			},
		}),
	}),
}));

vi.mock("@/lib/calendar-sync/providers", () => ({
	getSupportedProviders: vi.fn(() => [
		{ provider: "google", displayName: "Google Calendar", enabled: true },
		{ provider: "microsoft365", displayName: "Microsoft 365", enabled: true },
	]),
	isProviderSupported: vi.fn(
		(provider: string) => provider === "google" || provider === "microsoft365",
	),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db }));
});

const {
	getCalendarSettings,
	getManagerCalendarReadView,
	getProviderStatus,
	updateCalendarSettings,
} = await import("./actions");

const owner: StubCaller = {
	userId: "user-owner",
	activeOrganizationId: "org-1",
	membershipRole: "owner",
	employee: null,
};
const manager: StubCaller = {
	userId: "user-manager",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "employee-manager", role: "manager", former: false },
};
const orgMember: StubCaller = {
	...manager,
	employee: { id: "employee-member", role: "employee", former: false },
};

const settingsInput = {
	googleEnabled: true,
	microsoft365Enabled: true,
	icsFeedsEnabled: true,
	teamIcsFeedsEnabled: true,
	autoSyncOnApproval: true,
	conflictDetectionRequired: false,
	eventTitleTemplate: "Out of Office - {categoryName}",
	eventDescriptionTemplate: null,
};

const refused = { success: false, code: "AuthorizationError" };

describe("calendar settings actions", () => {
	beforeEach(() => {
		mocks.caller = manager;
		mocks.upsert.mockClear();
		db.query.calendarConnection.findMany = async () => [
			connection("conn-team", "employee-team"),
			connection("conn-location", "employee-location"),
			connection("conn-subarea", "employee-subarea", "microsoft365"),
			connection("conn-project", "employee-project"),
			connection("conn-project-team", "employee-project-team", "microsoft365"),
			connection("conn-outsider", "employee-outsider"),
		];
	});

	it("returns only manager-scoped calendar integrations for read access", async () => {
		const result = await getManagerCalendarReadView();

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.relevantConnections.map((item) => item.id).sort()).toEqual([
			"conn-location",
			"conn-project",
			"conn-project-team",
			"conn-subarea",
			"conn-team",
		]);
	});

	it("refuses an org member the manager read view", async () => {
		mocks.caller = orgMember;

		await expect(getManagerCalendarReadView()).resolves.toMatchObject(refused);
	});

	it("keeps owner and admin parity with full organization calendar settings access", async () => {
		mocks.caller = owner;

		const result = await getCalendarSettings();

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.googleEnabled).toBe(true);
		expect(result.data.microsoft365Enabled).toBe(false);
		expect(result.data.eventTitleTemplate).toBe("Out of Office - {categoryName}");
		expect(result.data.relevantConnections.map((item) => item.id).sort()).toEqual([
			"conn-location",
			"conn-outsider",
			"conn-project",
			"conn-project-team",
			"conn-subarea",
			"conn-team",
		]);
	});

	it("refuses a scoped manager the org-wide calendar settings", async () => {
		await expect(getCalendarSettings()).resolves.toMatchObject(refused);
	});

	it("refuses a scoped manager changing the calendar settings", async () => {
		await expect(updateCalendarSettings(settingsInput)).resolves.toMatchObject(refused);
		expect(mocks.upsert).not.toHaveBeenCalled();
	});

	it("saves the calendar settings of the session's organization for an org admin", async () => {
		mocks.caller = owner;

		const result = await updateCalendarSettings(settingsInput);

		expect(result.success).toBe(true);
		expect(mocks.upsert).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-1", googleEnabled: true }),
		);
	});

	it("rejects an empty event title template", async () => {
		mocks.caller = owner;

		const result = await updateCalendarSettings({ ...settingsInput, eventTitleTemplate: "" });

		expect(result).toMatchObject({ success: false, code: "ValidationError" });
		expect(mocks.upsert).not.toHaveBeenCalled();
	});

	it("lists the providers for an org member", async () => {
		mocks.caller = orgMember;

		const result = await getProviderStatus();

		expect(result).toMatchObject({ success: true });
	});

	it("refuses the provider status to a pending membership", async () => {
		mocks.caller = { ...orgMember, membershipRole: null };

		await expect(getProviderStatus()).resolves.toMatchObject(refused);
	});
});
