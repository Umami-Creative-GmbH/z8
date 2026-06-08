import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPendingCorrectionReview } from "./time-correction.handler";

const source = readFileSync("src/lib/approvals/handlers/time-correction.handler.ts", "utf8");

function handlerSection() {
	const start = source.indexOf("getDetail: (entityId");
	const end = source.indexOf("\n\tapprove:", start);

	expect(start).toBeGreaterThanOrEqual(0);
	expect(end).toBeGreaterThan(start);

	return source.slice(start, end);
}

describe("TimeCorrectionHandler detail loading", () => {
	it("binds approval detail to the selected approval request within the organization", () => {
		const body = handlerSection();

		expect(body).toContain("context?.approvalId");
		expect(body).toContain("eq(approvalRequest.id, context.approvalId)");
		expect(body).toContain("eq(approvalRequest.organizationId, organizationId)");
		expect(body).toContain('eq(approvalRequest.entityType, "time_entry")');
		expect(body).toContain("eq(approvalRequest.entityId, entityId)");
	});

	it("loads correction entries referenced by approval metadata for review details", () => {
		const body = handlerSection();

		expect(source).toContain("timeEntry");
		expect(body).toContain("correctionMetadataFromRequest(request)");
		expect(body).toContain("clockInCorrectionId");
		expect(body).toContain("pendingCorrection");
		expect(source).toContain("replacesEntryId === period.clockIn.id");
		expect(source).toContain("isOrphaned");
	});
});

describe("buildPendingCorrectionReview", () => {
	const period = {
		id: "period-1",
		startTime: new Date("2026-05-22T14:00:00.000Z"),
		endTime: new Date("2026-05-22T18:00:00.000Z"),
		durationMinutes: 240,
		employee: {
			id: "emp-1",
			userId: "user-1",
			teamId: null,
			organizationId: "org-1",
			user: { id: "user-1", name: "Kai Hentschel", email: "kai@example.com", image: null },
		},
		clockIn: { id: "clock-in-original", timestamp: new Date("2026-05-22T14:00:00.000Z") },
		clockOut: { id: "clock-out-original", timestamp: new Date("2026-05-22T18:00:00.000Z") },
	};

	it("treats legacy requests without resolvable correction entries as orphaned", () => {
		const review = buildPendingCorrectionReview(period, { metadata: null }, []);

		expect(review).toMatchObject({
			clockIn: { requested: null },
			clockOut: { requested: null },
			isOrphaned: true,
		});
	});

	it("resolves a legacy request when exactly one matching correction entry exists", () => {
		const correction = {
			id: "clock-in-correction",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: false,
		};

		const review = buildPendingCorrectionReview(period, { metadata: null }, [correction]);

		expect(review).toMatchObject({
			clockIn: { requested: correction.timestamp },
			clockOut: { requested: null },
			isOrphaned: false,
		});
	});

	it("ignores superseded correction entries when resolving legacy requests", () => {
		const rejectedCorrection = {
			id: "clock-in-rejected-correction",
			timestamp: new Date("2026-05-22T13:45:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: true,
		};
		const activeCorrection = {
			id: "clock-in-active-correction",
			timestamp: new Date("2026-05-22T14:15:00.000Z"),
			replacesEntryId: "clock-in-original",
			isSuperseded: false,
		};

		const review = buildPendingCorrectionReview(period, { metadata: null }, [
			rejectedCorrection,
			activeCorrection,
		]);

		expect(review).toMatchObject({
			clockIn: { requested: activeCorrection.timestamp },
			isOrphaned: false,
		});
	});
});
