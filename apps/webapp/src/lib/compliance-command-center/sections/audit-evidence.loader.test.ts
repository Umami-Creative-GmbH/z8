import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const failedFindMany = vi.fn();
	const successFindFirst = vi.fn();
	const invalidLimit = vi.fn();
	const invalidOrderBy = vi.fn(() => ({ limit: invalidLimit }));
	const invalidWhere = vi.fn(() => ({ orderBy: invalidOrderBy }));
	const invalidInnerJoin = vi.fn(() => ({ where: invalidWhere }));
	const invalidFrom = vi.fn(() => ({ innerJoin: invalidInnerJoin }));

	return {
		getConfig: vi.fn(),
		failedFindMany,
		successFindFirst,
		select: vi.fn(() => ({ from: invalidFrom })),
		invalidLimit,
	};
});

vi.mock("drizzle-orm", () => ({
	and: vi.fn((...args: unknown[]) => ({ and: args })),
	desc: vi.fn((value: unknown) => ({ desc: value })),
	eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	gte: vi.fn((left: unknown, right: unknown) => ({ gte: [left, right] })),
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			auditPackRequest: {
				findMany: mockState.failedFindMany,
				findFirst: mockState.successFindFirst,
			},
		},
		select: mockState.select,
	},
}));

vi.mock("@/db/schema", () => ({
	auditExportPackage: { id: "auditExportPackage.id", organizationId: "auditExportPackage.organizationId" },
	auditPackRequest: {
		id: "auditPackRequest.id",
		organizationId: "auditPackRequest.organizationId",
		status: "auditPackRequest.status",
		completedAt: "auditPackRequest.completedAt",
	},
	auditVerificationLog: {
		id: "auditVerificationLog.id",
		packageId: "auditVerificationLog.packageId",
		isValid: "auditVerificationLog.isValid",
		verifiedAt: "auditVerificationLog.verifiedAt",
	},
}));

vi.mock("@/lib/audit-export", () => ({
	configurationService: {
		getConfig: mockState.getConfig,
	},
}));

const { getAuditEvidenceSection } = await import("./audit-evidence");

describe("getAuditEvidenceSection", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("uses bounded recent failures and the actual latest successful audit pack", async () => {
		mockState.getConfig.mockResolvedValue({ signingKeyFingerprint: "fp_123" });
		mockState.failedFindMany.mockResolvedValue([]);
		mockState.successFindFirst.mockResolvedValue({
			completedAt: new Date("2026-03-01T12:00:00.000Z"),
		});
		mockState.invalidLimit.mockResolvedValue([]);

		const result = await getAuditEvidenceSection("org-1");
		const [failedQuery] = mockState.failedFindMany.mock.calls[0] ?? [];
		const [successQuery] = mockState.successFindFirst.mock.calls[0] ?? [];

		expect(failedQuery.columns).toEqual({ id: true });
		expect(failedQuery.where.and).toEqual(
			expect.arrayContaining([
				{ eq: ["auditPackRequest.organizationId", "org-1"] },
				{ eq: ["auditPackRequest.status", "failed"] },
				expect.objectContaining({ gte: ["auditPackRequest.completedAt", expect.any(Date)] }),
			]),
		);
		expect(successQuery.columns).toEqual({ completedAt: true });
		expect(successQuery.where.and).toEqual(
			expect.arrayContaining([
				{ eq: ["auditPackRequest.organizationId", "org-1"] },
				{ eq: ["auditPackRequest.status", "completed"] },
			]),
		);
		expect(successQuery.orderBy).toEqual([{ desc: "auditPackRequest.completedAt" }]);
		expect(result.card.status).toBe("healthy");
		expect(result.card.facts).toContain(
			"Last successful audit pack: 2026-03-01T12:00:00.000Z",
		);
	});
});
