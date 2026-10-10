import { beforeEach, describe, expect, it, vi } from "vitest";

const forwarded = vi.hoisted(() => vi.fn());
vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	forwardAuditToExternalService: forwarded,
}));

const { AuditAction } = await import("@/lib/audit-logger");
const { withAuditTrail } = await import("./audit-trail");

/** A stand-in transaction: rows are kept only when the body completes, as a commit does. */
function fakeDatabase() {
	const committed: Record<string, unknown>[] = [];
	return {
		committed,
		async transaction<T>(body: (tx: { insert: () => unknown }) => Promise<T>): Promise<T> {
			const pending: Record<string, unknown>[] = [];
			const tx = {
				insert: () => ({
					values: async (row: Record<string, unknown>) => {
						pending.push(row);
					},
				}),
			};
			const result = await body(tx);
			committed.push(...pending);
			return result;
		},
	};
}

const record = {
	organizationId: "org-1",
	action: AuditAction.KIOSK_REVOKED,
	actorUserId: "user-admin",
	targetType: "kiosk" as const,
	targetId: "kiosk-1",
	changes: { from: { revoked: false }, to: { revoked: true } },
};

describe("audit entries written in a transaction (#761)", () => {
	beforeEach(() => forwarded.mockReset());

	it("are forwarded to the external audit service once the transaction committed", async () => {
		const db = fakeDatabase();

		await withAuditTrail((audit) =>
			db.transaction(async (tx) => {
				await audit.record(tx as never, record);
				expect(forwarded).not.toHaveBeenCalled();
			}),
		);

		expect(db.committed).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "kiosk",
				entityId: "kiosk-1",
				action: "kiosk.revoked",
				performedBy: "user-admin",
				changes: JSON.stringify(record.changes),
			}),
		]);
		expect(forwarded).toHaveBeenCalledOnce();
		expect(forwarded).toHaveBeenCalledWith(
			expect.objectContaining({
				action: "kiosk.revoked",
				actorId: "user-admin",
				targetType: "kiosk",
				targetId: "kiosk-1",
				organizationId: "org-1",
				changes: record.changes,
				timestamp: expect.any(Date),
			}),
		);
	});

	it("are never forwarded when the transaction rolls back", async () => {
		const db = fakeDatabase();

		await expect(
			withAuditTrail((audit) =>
				db.transaction(async (tx) => {
					await audit.record(tx as never, record);
					throw new Error("conflict after the audit row");
				}),
			),
		).rejects.toThrow("conflict after the audit row");

		expect(db.committed).toEqual([]);
		expect(forwarded).not.toHaveBeenCalled();
	});
});
