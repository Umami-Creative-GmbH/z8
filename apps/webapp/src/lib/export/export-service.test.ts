import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	findFirst: vi.fn(),
	getPresignedUrl: vi.fn(),
	logger: {
		info: vi.fn(),
	},
}));

vi.mock("@/db", () => ({
	dataExport: {
		id: "dataExport.id",
		organizationId: "dataExport.organizationId",
		status: "dataExport.status",
		createdAt: "dataExport.createdAt",
	},
	db: {
		query: {
			dataExport: {
				findFirst: mockState.findFirst,
			},
		},
	},
}));

vi.mock("@/lib/storage/export-s3-client", () => ({
	deleteExport: vi.fn(),
	generateExportKey: vi.fn(),
	getPresignedUrl: mockState.getPresignedUrl,
	isExportS3Configured: vi.fn(),
	uploadExport: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => mockState.logger,
}));

const { regeneratePresignedUrl } = await import("./export-service");

describe("regeneratePresignedUrl", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.getPresignedUrl.mockResolvedValue("https://download.example/export.zip");
	});

	it("rejects exports that do not belong to the authorized organization", async () => {
		mockState.findFirst.mockResolvedValue({
			id: "export-1",
			organizationId: "org-victim",
			status: "completed",
			s3Key: "exports/org-victim/export-1.zip",
		});

		await expect(regeneratePresignedUrl("export-1", "org-attacker")).rejects.toThrow(
			"Export does not belong to this organization",
		);
		expect(mockState.getPresignedUrl).not.toHaveBeenCalled();
	});
});
