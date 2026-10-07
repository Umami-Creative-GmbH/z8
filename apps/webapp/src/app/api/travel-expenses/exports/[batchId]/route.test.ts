import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	loadFinanceActor: vi.fn(),
	loadFile: vi.fn(),
	readObject: vi.fn(),
	logAudit: vi.fn(async () => {}),
}));

vi.mock("next/server", async (original) => ({
	...(await original<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/lib/audit-logger", () => ({
	AuditAction: { TRAVEL_EXPENSE_EXPORT_DOWNLOADED: "travel_expense_export_downloaded" },
	logAudit: mocks.logAudit,
}));
vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/lib/storage/export-s3-client", () => ({ readPrivateObject: mocks.readObject }));
vi.mock("@/lib/travel-expenses/export-store", () => ({
	loadCompletedTravelExpenseExportFile: mocks.loadFile,
}));
vi.mock("@/lib/travel-expenses/finance-access", () => ({
	loadFinanceActor: mocks.loadFinanceActor,
}));

import { GET } from "./route";

const batchId = "6f9a3c1e-2b4d-4e8f-9a1b-3c5d7e9f1a2b";
const zip = Buffer.from("PK zip bytes");

function download() {
	return GET(
		new Request(
			`http://localhost/api/travel-expenses/exports/${batchId}`,
		) as unknown as NextRequest,
		{ params: Promise.resolve({ batchId }) },
	);
}

function actor(access: { canRead: boolean; canExport: boolean }) {
	return {
		organizationId: "org-1",
		employeeId: "employee-1",
		userId: "user-1",
		canSettle: false,
		...access,
	};
}

describe("travel expense export download route (#613)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.loadFile.mockResolvedValue({
			fileName: "export.zip",
			bucket: "bucket",
			key: "travel-expense-exports/org-1/batch/attempt-1/export.zip",
			versionId: null,
			sizeBytes: zip.byteLength,
			checksumSha256: createHash("sha256").update(zip).digest("hex"),
			revisionCount: 1,
		});
		mocks.readObject.mockResolvedValue(zip);
	});

	it("refuses the export permission without finance read: the ZIP holds org-wide receipts", async () => {
		mocks.loadFinanceActor.mockResolvedValue(actor({ canRead: false, canExport: true }));
		expect((await download()).status).toBe(404);
		expect(mocks.loadFile).not.toHaveBeenCalled();
		expect(mocks.readObject).not.toHaveBeenCalled();
	});

	it("refuses finance read without the export permission", async () => {
		mocks.loadFinanceActor.mockResolvedValue(actor({ canRead: true, canExport: false }));
		expect((await download()).status).toBe(404);
		expect(mocks.loadFile).not.toHaveBeenCalled();
	});

	it("streams the verified file with export and finance read, scoped to the active organization", async () => {
		mocks.loadFinanceActor.mockResolvedValue(actor({ canRead: true, canExport: true }));
		const response = await download();
		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer()).equals(zip)).toBe(true);
		expect(mocks.loadFile).toHaveBeenCalledWith({}, { organizationId: "org-1", batchId });
	});

	it("answers 401 without a signed-in employee", async () => {
		mocks.loadFinanceActor.mockResolvedValue(null);
		expect((await download()).status).toBe(401);
	});
});
