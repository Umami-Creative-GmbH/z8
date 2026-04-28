import { beforeEach, describe, expect, it, vi } from "vitest";
import { encryptImportCredential } from "./credential-secret";

const mocks = vi.hoisted(() => ({
	getImportJobSecret: vi.fn(),
	insertImportIssues: vi.fn(),
	insertStagedRows: vi.fn(),
	searchAbsences: vi.fn(),
	searchWorkdays: vi.fn(),
	clientConstructor: vi.fn(),
}));

vi.mock("@/env", () => ({
	env: { BETTER_AUTH_SECRET: "test-secret-that-is-long-enough-for-clockin" },
}));

vi.mock("@/lib/clockin/client", () => ({
	ClockinClient: class {
		constructor(token: string) {
			mocks.clientConstructor(token);
		}

		searchWorkdays = mocks.searchWorkdays;
		searchAbsences = mocks.searchAbsences;
	},
}));

vi.mock("./repository", () => ({
	getImportJobSecret: mocks.getImportJobSecret,
	insertImportIssues: mocks.insertImportIssues,
	insertStagedRows: mocks.insertStagedRows,
}));

const { scanClockinImportPartition } = await import("./clockin-adapter");

const secret = "test-secret-that-is-long-enough-for-clockin";

function scanJob(overrides: Record<string, unknown> = {}) {
	return {
		type: "import-review-scan",
		batchId: "batch_1",
		jobId: "job_1",
		organizationId: "org_1",
		provider: "clockin",
		entityType: "work_period",
		dateRange: { startDate: "2026-01-01", endDate: "2026-01-31" },
		employeeIds: ["100", "not-a-number", "200.5", "101"],
		secretId: "secret_1",
		...overrides,
	} as Parameters<typeof scanClockinImportPartition>[0];
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.getImportJobSecret.mockResolvedValue({
		id: "secret_1",
		organizationId: "org_1",
		...encryptImportCredential("clockin-token-value", secret, new Date("2099-01-01T00:00:00.000Z")),
	});
	mocks.insertStagedRows.mockImplementation(async ({ rows }) =>
		rows.map((row: unknown, index: number) => ({ id: `row_${index + 1}`, row })),
	);
	mocks.insertImportIssues.mockResolvedValue([]);
	mocks.searchWorkdays.mockResolvedValue([]);
	mocks.searchAbsences.mockResolvedValue([]);
});

describe("scanClockinImportPartition", () => {
	it("loads the organization-scoped credential, fetches workdays with numeric employee IDs, and stages normalized review rows", async () => {
		mocks.searchWorkdays.mockResolvedValue([
			{
				id: 9001,
				employee_id: 100,
				date: "2026-01-03",
				starts_at: "2026-01-03T08:00:00.000Z",
				ends_at: "2026-01-04T02:30:00.000Z",
				break_seconds: 1800,
				work_seconds: 66600,
				target_seconds: 28800,
				activities: [],
				events: [],
			},
		]);

		const result = await scanClockinImportPartition(scanJob());

		expect(result).toEqual({ stagedRows: 1, issues: 2 });
		expect(mocks.getImportJobSecret).toHaveBeenCalledWith({
			secretId: "secret_1",
			organizationId: "org_1",
		});
		expect(mocks.clientConstructor).toHaveBeenCalledWith("clockin-token-value");
		expect(mocks.searchWorkdays).toHaveBeenCalledWith({
			employeeIds: [100, 101],
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		});
		expect(mocks.searchWorkdays.mock.calls[0][0].employeeIds).not.toContain(Number.NaN);
		expect(mocks.insertStagedRows).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			rows: [
				expect.objectContaining({
					entityType: "work_period",
					providerSourceId: "clockin:workday:9001",
					rowStatus: "needs_mapping",
					issueSeverity: "blocking",
					normalizedPayload: {
						employeeId: null,
						startsAt: "2026-01-03T08:00:00.000Z",
						endsAt: "2026-01-04T02:30:00.000Z",
						suspiciousFlags: ["long_shift", "crosses_day_boundary"],
					},
				}),
			],
		});
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0].sourcePayloadHash).toBeUndefined();
		expect(mocks.insertImportIssues).toHaveBeenCalledWith({
			batchId: "batch_1",
			organizationId: "org_1",
			issues: [
				expect.objectContaining({ issueType: "unmatched_employee", severity: "blocking" }),
				expect.objectContaining({
					issueType: "suspicious_gap",
					severity: "warning",
					details: expect.objectContaining({
						providerSourceId: "clockin:workday:9001",
						suspiciousFlags: ["long_shift", "crosses_day_boundary"],
					}),
				}),
			],
		});
	});

	it("fetches absences and stages normalized absence rows", async () => {
		mocks.searchAbsences.mockResolvedValue([
			{
				id: 7001,
				employee_id: 101,
				absencecategory_name: "Vacation",
				approval: "approved",
				duration: 1,
				note: "annual leave",
				starts_at: "2026-01-10T08:00:00.000Z",
				ends_at: "2026-01-10T16:00:00.000Z",
				created_at: "2025-12-01T00:00:00.000Z",
				updated_at: "2025-12-02T00:00:00.000Z",
			},
		]);

		const result = await scanClockinImportPartition(scanJob({ entityType: "absence", employeeIds: ["101"] }));

		expect(result).toEqual({ stagedRows: 1, issues: 1 });
		expect(mocks.searchAbsences).toHaveBeenCalledWith({
			employeeIds: [101],
			startDate: "2026-01-01",
			endDate: "2026-01-31",
		});
		expect(mocks.insertStagedRows.mock.calls[0][0].rows).toEqual([
			expect.objectContaining({
				entityType: "absence",
				providerSourceId: "clockin:absence:7001",
				normalizedPayload: expect.objectContaining({
					employeeId: null,
					startsAt: "2026-01-10T08:00:00.000Z",
					endsAt: "2026-01-10T16:00:00.000Z",
					suspiciousFlags: [],
					absenceCategoryName: "Vacation",
				}),
			}),
		]);
	});

	it("does not flag valid multi-day absences as suspicious shift windows", async () => {
		mocks.searchAbsences.mockResolvedValue([
			{
				id: 7002,
				employee_id: 101,
				absencecategory_name: "Sick leave",
				approval: "approved",
				duration: 3,
				note: null,
				starts_at: "2026-01-10",
				ends_at: "2026-01-12",
				created_at: "2025-12-01T00:00:00.000Z",
				updated_at: "2025-12-02T00:00:00.000Z",
			},
		]);

		const result = await scanClockinImportPartition(scanJob({ entityType: "absence", employeeIds: ["101"] }));

		expect(result).toEqual({ stagedRows: 1, issues: 1 });
		expect(mocks.insertStagedRows.mock.calls[0][0].rows[0].normalizedPayload).toEqual(
			expect.objectContaining({
				startsAt: "2026-01-10",
				endsAt: "2026-01-12",
				suspiciousFlags: [],
			}),
		);
		expect(mocks.insertImportIssues.mock.calls[0][0].issues).toEqual([
			expect.objectContaining({ issueType: "unmatched_employee", severity: "blocking" }),
		]);
	});

	it("returns zero without calling Clockin when no valid numeric employee IDs are provided", async () => {
		const result = await scanClockinImportPartition(scanJob({ employeeIds: ["abc", "", "12.3"] }));

		expect(result).toEqual({ stagedRows: 0, issues: 0 });
		expect(mocks.searchWorkdays).not.toHaveBeenCalled();
		expect(mocks.insertStagedRows).not.toHaveBeenCalled();
		expect(mocks.insertImportIssues).not.toHaveBeenCalled();
	});

	it("rejects unsupported entity types without fetching provider data", async () => {
		await expect(scanClockinImportPartition(scanJob({ entityType: "employee" }))).rejects.toThrow(
			"Unsupported Clockin import review entity type: employee",
		);

		expect(mocks.searchWorkdays).not.toHaveBeenCalled();
		expect(mocks.searchAbsences).not.toHaveBeenCalled();
	});

	it("fails clearly when the scoped credential is missing", async () => {
		mocks.getImportJobSecret.mockResolvedValue(null);

		await expect(scanClockinImportPartition(scanJob())).rejects.toThrow("Import credential was not found");
		expect(mocks.clientConstructor).not.toHaveBeenCalled();
	});
});
