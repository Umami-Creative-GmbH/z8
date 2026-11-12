import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StubCaller } from "@/test/organization-action";

const EMPLOYEE_ID = "00000000-0000-4000-8000-000000000001";
const CATEGORY_ID = "00000000-0000-4000-8000-000000000002";
const OPERATION_ID = "00000000-0000-4000-8000-000000000003";

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	reviewPreviouslyTakenVacation: vi.fn(),
	previewVacationReconciliation: vi.fn(),
	withReviewedVacationReconciliation: vi.fn(),
	saveEmployeeSickNoteUpload: vi.fn(),
	findBatch: vi.fn(),
	revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/effect/runtime", async () => {
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	const db = {
		transaction: (callback: (tx: unknown) => unknown) => callback({ name: "tx" }),
		query: { importBatch: { findFirst: mocks.findBatch } },
	};
	return runtimeModuleOver(organizationActionStubLayer(() => mocks.caller, { db }));
});
vi.mock("@/lib/absences/historical-vacation", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/absences/historical-vacation")>()),
	reviewPreviouslyTakenVacation: mocks.reviewPreviouslyTakenVacation,
}));
vi.mock("@/lib/absences/vacation-reconciliation", () => ({
	previewVacationReconciliation: mocks.previewVacationReconciliation,
	withReviewedVacationReconciliation: mocks.withReviewedVacationReconciliation,
}));
vi.mock("@/lib/absences/absence-settings", () => ({
	saveEmployeeSickNoteUpload: mocks.saveEmployeeSickNoteUpload,
}));

const { commitPreviouslyTakenVacation, previewPreviouslyTakenVacation } = await import(
	"./historical-usage-actions"
);
const {
	commitHistoricalVacationImport,
	getHistoricalImportReviewContext,
	previewHistoricalVacationReconciliation,
} = await import("./reconciliation-actions");
const { saveEmployeeSickNoteUploadAction } = await import("./sick-note-setting-actions");

const orgAdmin: StubCaller = {
	userId: "user-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "admin-employee", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	...orgAdmin,
	membershipRole: "member",
	employee: { id: "manager-employee", role: "manager", former: false },
};
const pending: StubCaller = { ...orgAdmin, membershipRole: null };

const usage = {
	employeeId: EMPLOYEE_ID,
	year: 2025,
	days: 2.5,
	reason: "Taken before Z8",
};

const manualReconciliation = {
	kind: "manual" as const,
	reason: "Correct the balance",
	decisions: [],
	absence: {
		employeeId: EMPLOYEE_ID,
		categoryId: CATEGORY_ID,
		startDate: "2025-12-01",
		endDate: "2025-12-02",
		startPeriod: "full_day" as const,
		endPeriod: "full_day" as const,
	},
};

const proof = { operationId: OPERATION_ID, fingerprint: "a".repeat(64) };

beforeEach(() => {
	vi.clearAllMocks();
	mocks.caller = orgAdmin;
	mocks.reviewPreviouslyTakenVacation.mockResolvedValue({ fingerprint: "b".repeat(64) });
	mocks.previewVacationReconciliation.mockResolvedValue({ operationId: OPERATION_ID });
});

describe("previously taken vacation", () => {
	it("reviews it for the session's active organization", async () => {
		await expect(previewPreviouslyTakenVacation(usage)).resolves.toMatchObject({ success: true });
		expect(mocks.reviewPreviouslyTakenVacation).toHaveBeenCalledWith(
			{ name: "tx" },
			expect.objectContaining({ ...usage, organizationId: "org-1" }),
			"user-1",
			undefined,
		);
	});

	it("records only a reviewed total", async () => {
		await expect(commitPreviouslyTakenVacation(usage)).resolves.toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Review the historical usage before saving.",
		});

		const fingerprint = "c".repeat(64);
		await expect(commitPreviouslyTakenVacation({ ...usage, fingerprint })).resolves.toMatchObject({
			success: true,
		});
		expect(mocks.reviewPreviouslyTakenVacation).toHaveBeenLastCalledWith(
			{ name: "tx" },
			expect.objectContaining({ organizationId: "org-1" }),
			"user-1",
			fingerprint,
		);
	});

	it("explains a malformed review", async () => {
		await expect(previewPreviouslyTakenVacation({ ...usage, days: -1 })).resolves.toMatchObject({
			success: false,
			error: "Choose an employee, year, nonnegative half-day amount and a review reason.",
		});
	});

	it.each([
		["preview", () => previewPreviouslyTakenVacation(usage)],
		["commit", () => commitPreviouslyTakenVacation({ ...usage, fingerprint: "c".repeat(64) })],
	])("refuses the %s to a scoped manager", async (_name, call) => {
		mocks.caller = scopedManager;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.reviewPreviouslyTakenVacation).not.toHaveBeenCalled();
	});
});

describe("historical vacation reconciliation", () => {
	it("lets a member ask for a review of the active organization; recording authority is the review's", async () => {
		mocks.caller = { ...orgAdmin, membershipRole: "member", employee: null };

		await expect(previewHistoricalVacationReconciliation(manualReconciliation)).resolves.toEqual({
			success: true,
			data: { operationId: OPERATION_ID },
		});
		expect(mocks.previewVacationReconciliation).toHaveBeenCalledWith(
			{ name: "tx" },
			"org-1",
			"user-1",
			expect.objectContaining({ kind: "manual", reason: "Correct the balance" }),
		);
	});

	it.each([
		["preview", () => previewHistoricalVacationReconciliation(manualReconciliation)],
		["import commit", () => commitHistoricalVacationImport(proof)],
	])("refuses the %s to a pending membership", async (_name, call) => {
		mocks.caller = pending;

		await expect(call()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(mocks.previewVacationReconciliation).not.toHaveBeenCalled();
		expect(mocks.withReviewedVacationReconciliation).not.toHaveBeenCalled();
	});

	it("refuses the import review context to a scoped manager instead of redirecting", async () => {
		mocks.caller = scopedManager;

		await expect(getHistoricalImportReviewContext("batch-1")).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.findBatch).not.toHaveBeenCalled();
	});

	it("reads another organization's import as not found", async () => {
		mocks.findBatch.mockResolvedValue(undefined);

		await expect(getHistoricalImportReviewContext("batch-1")).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
			error: "Absence import not found.",
		});
	});
});

describe("employee sick note setting", () => {
	it("saves the setting for the active organization", async () => {
		mocks.saveEmployeeSickNoteUpload.mockResolvedValue({ kind: "saved", employeeSickNoteUpload: true });

		await expect(saveEmployeeSickNoteUploadAction({ enabled: true })).resolves.toEqual({
			success: true,
			data: { employeeSickNoteUpload: true },
		});
		expect(mocks.saveEmployeeSickNoteUpload).toHaveBeenCalledWith(expect.anything(), {
			organizationId: "org-1",
			enabled: true,
			actorUserId: "user-1",
		});
	});

	it("refuses to turn it on while personnel files are off", async () => {
		mocks.saveEmployeeSickNoteUpload.mockResolvedValue({ kind: "personnel_files_disabled" });

		await expect(saveEmployeeSickNoteUploadAction({ enabled: true })).resolves.toMatchObject({
			success: false,
			refusal: "personnel_files_disabled",
			error: "Turn on personnel files first: sick notes are stored there.",
		});
	});

	it("refuses a scoped manager", async () => {
		mocks.caller = scopedManager;

		await expect(saveEmployeeSickNoteUploadAction({ enabled: true })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(mocks.saveEmployeeSickNoteUpload).not.toHaveBeenCalled();
	});

	it("validates the setting", async () => {
		await expect(
			saveEmployeeSickNoteUploadAction({ enabled: "yes" as unknown as boolean }),
		).resolves.toMatchObject({ success: false, code: "ValidationError", error: "Invalid setting" });
	});
});
