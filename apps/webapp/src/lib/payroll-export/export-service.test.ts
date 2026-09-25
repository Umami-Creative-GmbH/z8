import { DateTime } from "luxon";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findFirst: vi.fn(),
	findEmployee: vi.fn(),
	updates: [] as Array<{ set?: unknown; where?: unknown }>,
	inserts: [] as Array<{ table: unknown; values: unknown }>,
	collectionActive: vi.fn(),
	collectPayrollWork: vi.fn(),
	insertInput: vi.fn(),
	readInput: vi.fn(),
	transform: vi.fn(),
}));

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...conditions: unknown[]) => ({ operator: "and", conditions })),
	eq: vi.fn((column: unknown, value: unknown) => ({ operator: "eq", column, value })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			payrollExportJob: {
				findFirst: mockState.findFirst,
			},
			employee: {
				findFirst: mockState.findEmployee,
			},
		},
		transaction: vi.fn(async (run: (tx: unknown) => Promise<unknown>) =>
			run({
				insert: vi.fn((table: unknown) => ({
					values: vi.fn((values: unknown) => {
						mockState.inserts.push({ table, values });
						return { returning: async () => [{ id: "job-new", ...(values as object) }] };
					}),
				})),
			}),
		),
		update: vi.fn(() => {
			const update: { set?: unknown; where?: unknown } = {};
			mockState.updates.push(update);
			return {
				set: vi.fn((values: unknown) => {
					update.set = values;
					return {
						where: vi.fn(async (predicate: unknown) => {
							update.where = predicate;
						}),
					};
				}),
			};
		}),
	},
	payrollExportJob: {
		id: "payroll_export_job.id",
		organizationId: "payroll_export_job.organization_id",
	},
	payrollExportSyncRecord: {},
	employee: { id: "employee.id", organizationId: "employee.organization_id" },
}));

vi.mock("@/lib/payroll-collection/payroll-work-collection-reader", () => ({
	isPayrollWorkCollectionActive: mockState.collectionActive,
	collectPayrollWork: mockState.collectPayrollWork,
}));

vi.mock("@/lib/payroll-collection/payroll-export-work-input", () => ({
	insertPayrollExportWorkInput: mockState.insertInput,
	readPayrollExportWorkInput: mockState.readInput,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	})),
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	getPresignedUrl: vi.fn(),
	uploadExport: vi.fn(),
}));

vi.mock("./connectors/personio-connector", () => ({ personioConnector: {} }));
vi.mock("./connectors/successfactors-connector", () => ({ successFactorsConnector: {} }));
vi.mock("./exporters/workday/workday-connector", () => ({ workdayConnector: {} }));
vi.mock("./exporters/successfactors/successfactors-formatter", () => ({
	successFactorsFormatter: { formatId: "successfactors" },
}));
vi.mock("./connectors/registry", () => ({
	PayrollConnectorRegistry: class {
		register() {}
		get() {}
		has() {
			return false;
		}
		list() {
			return [];
		}
	},
}));

vi.mock("./formatters/datev-lohn-formatter", () => ({
	DatevLohnFormatter: class {
		formatId = "datev_lohn";
		getSyncThreshold() {
			return 1;
		}
		transform(...args: unknown[]) {
			return mockState.transform(...args);
		}
	},
}));
vi.mock("./formatters/lexware-lohn-formatter", () => ({
	LexwareLohnFormatter: class {
		formatId = "lexware_lohn";
	},
}));
vi.mock("./formatters/sage-lohn-formatter", () => ({
	SageLohnFormatter: class {
		formatId = "sage_lohn";
	},
}));

vi.mock("./data-fetcher", () => ({
	countWorkPeriods: vi.fn(),
	fetchAbsencesForExport: vi.fn(),
	fetchWorkPeriodsForExport: vi.fn(),
	getPayrollExportConfig: vi.fn(),
	getWageTypeMappings: vi.fn(),
}));

const { createExportJob, markPayrollExportJobFailed, processExportJob } = await import(
	"./export-service"
);
const dataFetcher = await import("./data-fetcher");
const { PayrollWorkCollectionBlockedError } = await import(
	"@/lib/payroll-collection/payroll-work-collection-blocked-error"
);

const scopedPredicate = (jobId: string, organizationId: string) => ({
	operator: "and",
	conditions: [
		{ operator: "eq", column: "payroll_export_job.id", value: jobId },
		{
			operator: "eq",
			column: "payroll_export_job.organization_id",
			value: organizationId,
		},
	],
});

describe("payroll export job transitions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.updates.length = 0;
		mockState.findFirst.mockResolvedValue(undefined);
	});

	it("scopes processExportJob processing, lookup, and failure transitions by job and organization", async () => {
		const jobId = "job-1";
		const organizationId = "org-1";

		await expect(processExportJob({ jobId, organizationId })).rejects.toThrow(
			`Job not found: ${jobId}`,
		);

		expect(mockState.updates).toHaveLength(2);
		expect(mockState.updates[0]?.where).toEqual(scopedPredicate(jobId, organizationId));
		expect(mockState.findFirst).toHaveBeenCalledWith(
			expect.objectContaining({ where: scopedPredicate(jobId, organizationId) }),
		);
		expect(mockState.updates[1]?.where).toEqual(scopedPredicate(jobId, organizationId));
	});

	it("marks a payroll export job failed with a generic message and tenant scope", async () => {
		const before = Date.now();

		await markPayrollExportJobFailed({
			jobId: "job-2",
			organizationId: "org-2",
			errorMessage: "Payroll export processing failed",
		});

		expect(mockState.updates).toHaveLength(1);
		const failedUpdate = mockState.updates.at(0);
		if (!failedUpdate) {
			throw new Error("Expected a failed payroll export job update");
		}
		expect(failedUpdate.set).toEqual({
			status: "failed",
			errorMessage: "Payroll export processing failed",
			completedAt: expect.any(Date),
		});
		expect(
			(failedUpdate.set as { completedAt: Date }).completedAt.getTime(),
		).toBeGreaterThanOrEqual(before);
		expect(failedUpdate.where).toEqual(scopedPredicate("job-2", "org-2"));
	});
});

describe("payroll export under scoped work collection (#322)", () => {
	const filters = {
		dateRange: {
			start: DateTime.fromISO("2026-07-01", { zone: "utc" }),
			end: DateTime.fromISO("2026-07-31", { zone: "utc" }),
		},
		employeeIds: ["employee-1"],
	};
	const collectedInput = {
		version: 1,
		organizationId: "org-1",
		scope: {
			employeeIds: ["employee-1"],
			startDate: "2026-07-01",
			endDate: "2026-07-31",
			teamIds: null,
			projectIds: null,
		},
		work: [
			{
				recordId: "record-1",
				employeeId: "employee-1",
				person: { employeeNumber: "E-1", firstName: "Ada", lastName: "L", email: null },
				startAt: "2026-07-10T07:00:00Z",
				endExclusive: "2026-07-10T09:00:40Z",
				minutes: 120,
				workCategory: null,
				project: null,
				source: { recordUpdatedAt: "2026-07-10T09:01:00Z", workPeriodId: null, graphRevision: null },
			},
		],
		excluded: [],
		digest: "digest-1",
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockState.inserts.length = 0;
		mockState.updates.length = 0;
		vi.mocked(dataFetcher.getPayrollExportConfig).mockResolvedValue({
			config: { id: "config-1" },
			format: {},
		} as never);
		mockState.findEmployee.mockResolvedValue({ userId: "user-1" });
		mockState.collectionActive.mockResolvedValue(true);
	});

	it("collects before the job exists and stores the input with it", async () => {
		mockState.collectPayrollWork.mockResolvedValue({
			collection: { input: collectedInput, blockers: [], employeeTimezones: {} },
			repair: { status: "not_authorized" },
		});

		const result = await createExportJob({
			organizationId: "org-1",
			formatId: "datev_lohn",
			requestedById: "employee-requester",
			filters,
		});

		expect(mockState.collectPayrollWork).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			filters: {
				startDate: "2026-07-01",
				endDate: "2026-07-31",
				employeeIds: ["employee-1"],
				teamIds: undefined,
				projectIds: undefined,
			},
			repairActorUserId: "user-1",
		});
		expect(dataFetcher.countWorkPeriods).not.toHaveBeenCalled();
		expect(mockState.inserts).toHaveLength(1);
		expect(mockState.insertInput).toHaveBeenCalledWith(expect.anything(), "job-new", collectedInput);
		// One collected line against a threshold of one: processed inline.
		expect(result).toEqual({ jobId: "job-new", isAsync: false });
	});

	it("refuses the whole export when the scope is uncertain and creates no job", async () => {
		mockState.collectPayrollWork.mockResolvedValue({
			collection: {
				input: collectedInput,
				blockers: [
					{
						kind: "pending_work_approval",
						sourceId: "record-2",
						employeeId: "employee-1",
						at: "2026-07-11T07:00:00Z",
						reason: null,
					},
				],
				employeeTimezones: {},
			},
			repair: { status: "nothing_eligible" },
		});

		const refusal = createExportJob({
			organizationId: "org-1",
			formatId: "datev_lohn",
			requestedById: "employee-requester",
			filters,
		});

		await expect(refusal).rejects.toBeInstanceOf(PayrollWorkCollectionBlockedError);
		await expect(refusal).rejects.toMatchObject({
			blockers: [expect.objectContaining({ kind: "pending_work_approval" })],
		});
		expect(mockState.inserts).toHaveLength(0);
		expect(mockState.insertInput).not.toHaveBeenCalled();
	});

	it("keeps the legacy read for organizations without the control", async () => {
		mockState.collectionActive.mockResolvedValue(false);
		vi.mocked(dataFetcher.countWorkPeriods).mockResolvedValue(5);

		const result = await createExportJob({
			organizationId: "org-1",
			formatId: "datev_lohn",
			requestedById: "employee-requester",
			filters,
		});

		expect(mockState.collectPayrollWork).not.toHaveBeenCalled();
		expect(mockState.insertInput).not.toHaveBeenCalled();
		expect(result.isAsync).toBe(true);
	});

	it("formats the stored input on processing and recovery without rereading work", async () => {
		mockState.findFirst.mockResolvedValue({
			id: "job-1",
			organizationId: "org-1",
			configId: "config-1",
			isAsync: false,
			filters: {
				dateRange: { start: "2026-07-01", end: "2026-07-31" },
				employeeIds: ["employee-1"],
			},
			config: { formatId: "datev_lohn", config: {} },
		});
		mockState.readInput.mockResolvedValue(collectedInput);
		vi.mocked(dataFetcher.fetchAbsencesForExport).mockResolvedValue([]);
		vi.mocked(dataFetcher.getWageTypeMappings).mockResolvedValue([]);
		mockState.transform.mockReturnValue({
			fileName: "export.csv",
			content: "csv",
			encoding: "utf-8",
			mimeType: "text/csv",
			metadata: { workPeriodCount: 1, employeeCount: 1 },
		});

		// A first delivery and its recovery both format the same stored lines.
		await processExportJob({ jobId: "job-1", organizationId: "org-1" });
		await processExportJob({ jobId: "job-1", organizationId: "org-1" });

		expect(dataFetcher.fetchWorkPeriodsForExport).not.toHaveBeenCalled();
		expect(mockState.readInput).toHaveBeenCalledWith(expect.anything(), "org-1", "job-1");
		expect(dataFetcher.fetchAbsencesForExport).toHaveBeenCalledWith(
			"org-1",
			expect.anything(),
			{ canonicalReadiness: "absences" },
		);
		const [firstLines, secondLines] = mockState.transform.mock.calls.map(([lines]) => lines);
		expect(secondLines).toEqual(firstLines);
		expect(firstLines).toEqual([
			expect.objectContaining({
				id: "record-1",
				employeeId: "employee-1",
				durationMinutes: 120,
				employeeNumber: "E-1",
			}),
		]);
		expect(firstLines[0].startTime.toISO()).toBe("2026-07-10T07:00:00.000Z");
		expect(firstLines[0].endTime.toISO()).toBe("2026-07-10T09:00:40.000Z");
	});
});
