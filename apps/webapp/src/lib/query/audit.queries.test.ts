import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
	select: vi.fn(),
	countFrom: vi.fn(),
	countWhere: vi.fn(),
	logsFrom: vi.fn(),
	leftJoin: vi.fn(),
	logsWhere: vi.fn(),
	orderBy: vi.fn(),
	limit: vi.fn(),
	offset: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		select: dbMock.select,
	},
}));

import { getAuditLogs } from "./audit.queries";

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") {
		return [];
	}

	const objectValue = value as { config?: { name?: unknown }; queryChunks?: unknown[] };
	const ownName = typeof objectValue.config?.name === "string" ? [objectValue.config.name] : [];
	const chunkNames = Array.isArray(objectValue.queryChunks)
		? objectValue.queryChunks.flatMap(collectColumnNames)
		: [];

	return [...ownName, ...chunkNames];
}

describe("audit queries", () => {
	beforeEach(() => {
		vi.clearAllMocks();

		dbMock.countWhere.mockResolvedValue([{ count: 0 }]);
		dbMock.countFrom.mockReturnValue({ where: dbMock.countWhere });

		dbMock.offset.mockResolvedValue([]);
		dbMock.limit.mockReturnValue({ offset: dbMock.offset });
		dbMock.orderBy.mockReturnValue({ limit: dbMock.limit });
		dbMock.logsWhere.mockReturnValue({ orderBy: dbMock.orderBy });
		dbMock.leftJoin.mockReturnValue({ where: dbMock.logsWhere });
		dbMock.logsFrom.mockReturnValue({ leftJoin: dbMock.leftJoin });

		dbMock.select
			.mockReturnValueOnce({ from: dbMock.countFrom })
			.mockReturnValueOnce({ from: dbMock.logsFrom });
	});

	it("filters audit logs by the dedicated organization column", async () => {
		await getAuditLogs({ organizationId: "org_1" });

		const countWhereClause = dbMock.countWhere.mock.calls[0]?.[0];
		const logsWhereClause = dbMock.logsWhere.mock.calls[0]?.[0];

		expect(collectColumnNames(countWhereClause)).toContain("organization_id");
		expect(collectColumnNames(logsWhereClause)).toContain("organization_id");
		expect(collectColumnNames(countWhereClause)).not.toContain("metadata");
		expect(collectColumnNames(logsWhereClause)).not.toContain("metadata");
	});
});
