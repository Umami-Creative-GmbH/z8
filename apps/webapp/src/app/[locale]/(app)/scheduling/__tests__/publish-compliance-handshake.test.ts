import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));
vi.mock("@/db/schema", () => ({ employee: {}, location: {} }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/lib/effect/runtime", () => ({ AppLayer: {} }));
vi.mock("@/lib/effect/result", () => ({ runServerActionSafe: vi.fn() }));
vi.mock("@/lib/effect/services/auth.service", () => ({ AuthService: {} }));
vi.mock("@/lib/effect/services/database.service", () => ({ DatabaseService: {} }));
vi.mock("@/lib/effect/services/shift.service", () => ({ ShiftService: {} }));
vi.mock("@/lib/effect/services/shift-request.service", () => ({ ShiftRequestService: {} }));
vi.mock("@/lib/effect/services/coverage.service", () => ({ CoverageService: {} }));
vi.mock("@/lib/effect/services/schedule-compliance.service", () => ({
	ScheduleComplianceService: {},
	ScheduleComplianceServiceLive: {},
}));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("@/lib/timezone/effective-timezone", () => ({ getEffectiveTimezone: vi.fn() }));

const { buildPublishDecision } = await import("@/app/[locale]/(app)/scheduling/publish-decision");

describe("buildPublishDecision", () => {
	const complianceSummary = {
		totalFindings: 3,
		byType: {
			restTime: 1,
			maxHours: 1,
			overtime: 1,
		},
	};

	it("requires acknowledgment when findings exist and acknowledgment is missing", () => {
		const decision = buildPublishDecision({
			count: 12,
			compliance: {
				summary: complianceSummary,
				fingerprint: "fp-123",
			},
			acknowledgment: null,
		});

		expect(decision.requiresAcknowledgment).toBe(true);
		expect(decision.published).toBe(false);
		if (!decision.published) {
			expect(decision.evaluationFingerprint).toBe("fp-123");
			expect(decision.complianceSummary.totalFindings).toBe(3);
		}
	});

	it("requires acknowledgment when findings exist and fingerprint is invalid", () => {
		const decision = buildPublishDecision({
			count: 12,
			compliance: {
				summary: complianceSummary,
				fingerprint: "fp-123",
			},
			acknowledgment: {
				evaluationFingerprint: "fp-invalid",
			},
		});

		expect(decision.requiresAcknowledgment).toBe(true);
		expect(decision.published).toBe(false);
	});

	it("publishes when findings exist and fingerprint is acknowledged", () => {
		const decision = buildPublishDecision({
			count: 12,
			compliance: {
				summary: complianceSummary,
				fingerprint: "fp-123",
			},
			acknowledgment: {
				evaluationFingerprint: "fp-123",
			},
		});

		expect(decision.requiresAcknowledgment).toBe(false);
		expect(decision.published).toBe(true);
		expect(decision.count).toBe(12);
	});

	it("publishes directly when there are no findings", () => {
		const decision = buildPublishDecision({
			count: 8,
			compliance: {
				summary: {
					totalFindings: 0,
					byType: {
						restTime: 0,
						maxHours: 0,
						overtime: 0,
					},
				},
				fingerprint: "fp-000",
			},
			acknowledgment: null,
		});

		expect(decision.requiresAcknowledgment).toBe(false);
		expect(decision.published).toBe(true);
		expect(decision.count).toBe(8);
	});
});
