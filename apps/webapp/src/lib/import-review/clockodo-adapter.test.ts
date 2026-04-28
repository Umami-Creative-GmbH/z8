import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptImportCredential } from "./credential-secret";

const mocks = vi.hoisted(() => ({
	clientConstructor: vi.fn(),
	getAbsences: vi.fn(),
	getEntries: vi.fn(),
	getHolidayQuotas: vi.fn(),
	getImportJobSecret: vi.fn(),
	getNonBusinessDays: vi.fn(),
	getServices: vi.fn(),
	getSurcharges: vi.fn(),
	getTargetHours: vi.fn(),
	getTeams: vi.fn(),
	getUsers: vi.fn(),
	insertImportIssues: vi.fn(),
	insertStagedRows: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-clockodo" },
}));

vi.mock("@/lib/clockodo/client", () => ({
	ClockodoClient: class {
		constructor(email: string, apiKey: string) {
			mocks.clientConstructor(email, apiKey);
		}

		getAbsences = mocks.getAbsences;
		getEntries = mocks.getEntries;
		getHolidayQuotas = mocks.getHolidayQuotas;
		getNonBusinessDays = mocks.getNonBusinessDays;
		getServices = mocks.getServices;
		getSurcharges = mocks.getSurcharges;
		getTargetHours = mocks.getTargetHours;
		getTeams = mocks.getTeams;
		getUsers = mocks.getUsers;
	},
}));

vi.mock("./repository", () => ({
	getImportJobSecret: mocks.getImportJobSecret,
	insertImportIssues: mocks.insertImportIssues,
	insertStagedRows: mocks.insertStagedRows,
}));

const { scanClockodoImportPartition } = await import("./clockodo-adapter");

const secret = "test-secret-that-is-long-enough-for-clockodo";

function scanJob(overrides: Record<string, unknown> = {}) {
	return {
		type: "import-review-scan",
		batchId: "batch_1",
		jobId: "job_1",
		organizationId: "org_1",
		provider: "clockodo",
		entityType: "employee",
		dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
		employeeIds: [],
		secretId: "secret_1",
		...overrides,
	} as Parameters<typeof scanClockodoImportPartition>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getImportJobSecret.mockResolvedValue({
		id: "secret_1",
		organizationId: "org_1",
		...encryptImportCredential(
			JSON.stringify({ email: "admin@example.com", apiKey: "clockodo-api-key" }),
			secret,
			new Date("2099-01-01T00:00:00.000Z"),
		),
	});
	mocks.insertStagedRows.mockImplementation(async ({ rows }) =>
		rows.map((row: unknown, index: number) => ({ id: `row_${index + 1}`, row })),
	);
	mocks.insertImportIssues.mockResolvedValue([]);
	mocks.getAbsences.mockResolvedValue([]);
	mocks.getEntries.mockResolvedValue([]);
	mocks.getHolidayQuotas.mockResolvedValue([]);
	mocks.getNonBusinessDays.mockResolvedValue([]);
	mocks.getServices.mockResolvedValue([]);
	mocks.getSurcharges.mockResolvedValue([]);
	mocks.getTargetHours.mockResolvedValue([]);
	mocks.getTeams.mockResolvedValue([]);
	mocks.getUsers.mockResolvedValue([]);
});

describe("scanClockodoImportPartition", () => {
	it("loads the organization-scoped credential and stages Clockodo users as employee rows", async () => {
		mocks.getUsers.mockResolvedValue([
			{
				id: 1,
				name: "Ada Lovelace",
				number: "A-1",
				email: "ada@example.com",
				role: "user",
				active: true,
				teams_id: 2,
				timezone: "Europe/Berlin",
				wage_type: 1,
				language: "en",
			},
		]);

		const result = await scanClockodoImportPartition(scanJob());

		expect(result).toEqual({ stagedRows: 1, issues: 0 });
		expect(mocks.getImportJobSecret).toHaveBeenCalledWith({
			secretId: "secret_1",
			organizationId: "org_1",
		});
		expect(mocks.clientConstructor).toHaveBeenCalledWith("admin@example.com", "clockodo-api-key");
		expect(mocks.insertStagedRows).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			rows: [
				expect.objectContaining({
					entityType: "employee",
					providerSourceId: "clockodo:user:1",
					rowStatus: "staged",
					issueSeverity: "none",
					normalizedPayload: expect.objectContaining({
						clockodoUserId: 1,
						email: "ada@example.com",
						name: "Ada Lovelace",
					}),
				}),
			],
		});
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0].sourcePayloadHash).toBeUndefined();
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0].sourcePayload.hash).toBeUndefined();
	});

	it("stages work periods with missing employee mapping as blocking review rows", async () => {
		mocks.getEntries.mockResolvedValue([
			{
				id: 4,
				users_id: 1,
				services_id: 3,
				time_since: "2026-01-05T08:00:00Z",
				time_until: "2026-01-05T16:00:00Z",
				duration: 28800,
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "work_period" }));

		expect(result).toEqual({ stagedRows: 1, issues: 1 });
		expect(mocks.getEntries).toHaveBeenCalledWith("2026-01-01T00:00:00Z", "2026-01-31T23:59:59Z");
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({
				entityType: "work_period",
				providerSourceId: "clockodo:entry:4",
				rowStatus: "needs_mapping",
				issueSeverity: "blocking",
				matchTarget: { providerEmployeeId: 1, providerServiceId: 3 },
				normalizedPayload: expect.objectContaining({
					employeeId: null,
					startsAt: "2026-01-05T08:00:00Z",
					endsAt: "2026-01-05T16:00:00Z",
					suspiciousFlags: [],
				}),
			}),
		]);
		expect(mocks.insertImportIssues.mock.calls[0][0].issues).toEqual([
			expect.objectContaining({ issueType: "unmatched_employee", severity: "blocking" }),
		]);
	});

	it("stages valid multi-day absences without shift-window warnings", async () => {
		mocks.getAbsences.mockResolvedValue([
			{
				id: 5,
				users_id: 1,
				date_since: "2026-01-10",
				date_until: "2026-01-12",
				status: 1,
				type: 1,
				note: null,
				count_days: 3,
				count_hours: null,
			},
		]);

		const result = await scanClockodoImportPartition(scanJob({ entityType: "absence" }));

		expect(result).toEqual({ stagedRows: 1, issues: 1 });
		expect(mocks.getAbsences).toHaveBeenCalledWith(2026);
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0]).toEqual(
			expect.objectContaining({
				entityType: "absence",
				providerSourceId: "clockodo:absence:5",
				issueSeverity: "blocking",
				rowStatus: "needs_mapping",
				normalizedPayload: expect.objectContaining({
					employeeId: null,
					startsAt: "2026-01-10",
					endsAt: "2026-01-12",
					suspiciousFlags: [],
				}),
			}),
		);
		expect(mocks.insertImportIssues.mock.calls[0][0].issues).toEqual([
			expect.objectContaining({ issueType: "unmatched_employee", severity: "blocking" }),
		]);
	});

	it("rejects unsupported entity types without fetching provider data", async () => {
		await expect(scanClockodoImportPartition(scanJob({ entityType: "time_entry" }))).rejects.toThrow(
			"Unsupported Clockodo import review entity type: time_entry",
		);

		expect(mocks.clientConstructor).not.toHaveBeenCalled();
		expect(mocks.getUsers).not.toHaveBeenCalled();
		expect(mocks.insertStagedRows).not.toHaveBeenCalled();
		expect(mocks.insertImportIssues).not.toHaveBeenCalled();
	});
});
