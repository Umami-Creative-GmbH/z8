import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defineAbilityFor, type PrincipalContext } from "@/lib/authorization";

const mockState = vi.hoisted(() => ({
	resolvedHeaders: new Headers(),
	headers: vi.fn(async () => mockState.resolvedHeaders),
	getSession: vi.fn(),
	getAbility: vi.fn(),
	loadWorksCouncilSettings: vi.fn(),
	buildWorksCouncilPortalModel: vi.fn(),
	findOrganization: vi.fn(),
	insert: vi.fn(),
	insertValues: vi.fn(async () => undefined),
}));

vi.mock("next/headers", () => ({
	headers: mockState.headers,
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: mockState.getSession,
		},
	},
}));

vi.mock("@/lib/auth-helpers", () => ({
	getAbility: mockState.getAbility,
}));

vi.mock("@/lib/works-council/settings", () => ({
	loadWorksCouncilSettings: mockState.loadWorksCouncilSettings,
}));

vi.mock("@/lib/works-council/review-data", () => ({
	buildWorksCouncilPortalModel: mockState.buildWorksCouncilPortalModel,
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			organization: {
				findFirst: mockState.findOrganization,
			},
		},
		insert: mockState.insert,
	},
}));

vi.mock("@/db/auth-schema", () => ({
	organization: {
		id: "organization.id",
	},
}));

vi.mock("@/db/schema", () => ({
	worksCouncilAccessAudit: "worksCouncilAccessAudit",
	worksCouncilReviewExport: "worksCouncilReviewExport",
}));

const { POST } = await import("./route");

const enabledSettings = {
	enabled: true,
	identityVisibility: "pseudonymized",
	absenceVisibility: "grouped",
	exportEnabled: true,
	minimumAggregationThreshold: 5,
	visibleTeamIds: ["team-1"],
	visibleLocationIds: ["location-1"],
};

function createPrincipal(role: "owner" | "admin" | "member"): PrincipalContext {
	return {
		userId: "user-1",
		isPlatformAdmin: false,
		activeOrganizationId: "org-1",
		orgMembership: {
			organizationId: "org-1",
			role,
			status: "active",
		},
		employee: null,
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: [],
		customRoles: [],
	};
}

function createRequest(): NextRequest {
	return new Request(
		"https://app.example.com/de/works-council/export?from=2026-05-01&to=2026-05-24",
		{ method: "POST" },
	) as NextRequest;
}

function setupAuthenticatedRequest() {
	mockState.getSession.mockResolvedValue({
		user: { id: "user-1" },
		session: { activeOrganizationId: "org-1" },
	});
	mockState.getAbility.mockResolvedValue(defineAbilityFor(createPrincipal("admin")));
}

describe("POST /works-council/export", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.resolvedHeaders = new Headers();
		mockState.findOrganization.mockResolvedValue({ worksCouncilEnabled: true });
		mockState.insert.mockReturnValue({ values: mockState.insertValues });
		mockState.insertValues.mockResolvedValue(undefined);
	});

	it("returns 403 before loading settings when the organization Works Council feature is disabled", async () => {
		setupAuthenticatedRequest();
		mockState.findOrganization.mockResolvedValue({ worksCouncilEnabled: false });

		const response = await POST(createRequest());

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "Forbidden" });
		expect(mockState.loadWorksCouncilSettings).not.toHaveBeenCalled();
		expect(mockState.buildWorksCouncilPortalModel).not.toHaveBeenCalled();
	});

	it("allows export when org feature and exports are enabled even if settings enabled is false", async () => {
		setupAuthenticatedRequest();
		mockState.loadWorksCouncilSettings.mockResolvedValue({
			...enabledSettings,
			enabled: false,
			exportEnabled: true,
		});
		mockState.buildWorksCouncilPortalModel.mockResolvedValue({
			state: "ready",
			dashboard: {
				overtimeMinutes: 0,
				breakRestRiskCount: 0,
				schedulePublicationCount: 0,
				scheduleChangeCount: 0,
				complianceFindingCount: 0,
				absenceCoveragePressureCount: 0,
				policyChangeCount: 0,
			},
			changeLog: [],
			scheduleReview: [],
		});

		const response = await POST(createRequest());

		expect(response.status).toBe(200);
	});

	it("returns 403 when Works Council exports are disabled", async () => {
		setupAuthenticatedRequest();
		mockState.loadWorksCouncilSettings.mockResolvedValue({
			...enabledSettings,
			exportEnabled: false,
		});

		const response = await POST(createRequest());

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: "Works Council exports are disabled",
		});
		expect(mockState.buildWorksCouncilPortalModel).not.toHaveBeenCalled();
	});

	it("returns a works council review CSV attachment", async () => {
		setupAuthenticatedRequest();
		mockState.loadWorksCouncilSettings.mockResolvedValue(enabledSettings);
		mockState.buildWorksCouncilPortalModel.mockResolvedValue({
			state: "ready",
			dashboard: {
				overtimeMinutes: 120,
				breakRestRiskCount: 1,
				schedulePublicationCount: 2,
				scheduleChangeCount: 3,
				complianceFindingCount: 4,
				absenceCoveragePressureCount: 5,
				policyChangeCount: 6,
			},
			changeLog: [
				{
					id: "change-1",
					timestamp: "2026-05-02T10:00:00.000Z",
					eventType: "schedule.published",
					actorLabel: "Authorized user",
					summary: "Schedule published",
				},
			],
			scheduleReview: [],
		});

		const response = await POST(createRequest());

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("text/csv");
		expect(response.headers.get("content-disposition")).toContain("works-council-review");
		const body = await response.text();
		expect(body).toContain("Works Council Review Export");
		expect(body).toContain('"Identity visibility","pseudonymized"');
		expect(body).toContain('"Absence visibility","grouped"');
		expect(body).toContain('"Minimum aggregation threshold","5"');
		expect(body).toContain('"Visible team IDs","team-1"');
		expect(body).toContain('"Visible location IDs","location-1"');
	});

	it("allows an organization owner to export with the real Works Council ability", async () => {
		setupAuthenticatedRequest();
		mockState.getAbility.mockResolvedValue(defineAbilityFor(createPrincipal("owner")));
		mockState.loadWorksCouncilSettings.mockResolvedValue(enabledSettings);
		mockState.buildWorksCouncilPortalModel.mockResolvedValue({
			state: "ready",
			dashboard: {
				overtimeMinutes: 0,
				breakRestRiskCount: 0,
				schedulePublicationCount: 0,
				scheduleChangeCount: 0,
				complianceFindingCount: 0,
				absenceCoveragePressureCount: 0,
				policyChangeCount: 0,
			},
			changeLog: [],
			scheduleReview: [],
		});

		const response = await POST(createRequest());

		expect(response.status).toBe(200);
	});

	it("denies an organization member export with the real Works Council ability", async () => {
		setupAuthenticatedRequest();
		mockState.getAbility.mockResolvedValue(defineAbilityFor(createPrincipal("member")));

		const response = await POST(createRequest());

		expect(response.status).toBe(403);
		expect(mockState.loadWorksCouncilSettings).not.toHaveBeenCalled();
	});

	it("audits successful exports with the export record and access audit", async () => {
		setupAuthenticatedRequest();
		mockState.loadWorksCouncilSettings.mockResolvedValue(enabledSettings);
		mockState.buildWorksCouncilPortalModel.mockResolvedValue({
			state: "ready",
			dashboard: {
				overtimeMinutes: 0,
				breakRestRiskCount: 0,
				schedulePublicationCount: 0,
				scheduleChangeCount: 0,
				complianceFindingCount: 0,
				absenceCoveragePressureCount: 0,
				policyChangeCount: 0,
			},
			changeLog: [],
			scheduleReview: [],
		});

		await POST(createRequest());

		expect(mockState.insert).toHaveBeenCalledWith("worksCouncilReviewExport");
		expect(mockState.insert).toHaveBeenCalledWith("worksCouncilAccessAudit");
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				requestedByUserId: "user-1",
				status: "completed",
				visibilitySnapshot: {
					identityVisibility: "pseudonymized",
					absenceVisibility: "grouped",
					minimumAggregationThreshold: 5,
					visibleTeamIds: ["team-1"],
					visibleLocationIds: ["location-1"],
				},
			}),
		);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				actorUserId: "user-1",
				eventType: "export_requested",
			}),
		);
	});

	it("audits failed export construction after authentication", async () => {
		setupAuthenticatedRequest();
		mockState.loadWorksCouncilSettings.mockResolvedValue(enabledSettings);
		mockState.buildWorksCouncilPortalModel.mockRejectedValue(new Error("export failed"));

		const response = await POST(createRequest());

		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Failed to generate Works Council export" });
		expect(mockState.insert).toHaveBeenCalledWith("worksCouncilAccessAudit");
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				organizationId: "org-1",
				actorUserId: "user-1",
				eventType: "export_failed",
				metadata: {
					errorCode: "export_generation_failed",
					errorType: "Error",
				},
			}),
		);
		expect(mockState.insertValues).not.toHaveBeenCalledWith(
			expect.objectContaining({
				metadata: expect.objectContaining({ error: "export failed" }),
			}),
		);
	});
});
