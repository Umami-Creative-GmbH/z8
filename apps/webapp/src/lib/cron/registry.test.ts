import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_JOBS } from "./registry";

const {
	calculateTelemetryMetrics,
	getOrCreateTelemetryIdentity,
	mockEnv,
	runBillingSeatReconciliation,
	runSCIMMaintenance,
	sendTelemetryReport,
} = vi.hoisted(() => ({
	calculateTelemetryMetrics: vi.fn(),
	getOrCreateTelemetryIdentity: vi.fn(),
	mockEnv: { TELEMETRY_ENABLED: "true" },
	runBillingSeatReconciliation: vi.fn(async () => ({
		success: true,
		billingEnabled: true,
		processed: 0,
		synced: 0,
		skipped: 0,
		errors: [],
	})),
	runSCIMMaintenance: vi.fn(async () => ({
		outbox: {
			claimed: 0,
			completed: 0,
			deferred: 0,
			exhausted: 0,
			persistenceFailures: 0,
		},
		exhausted: 0,
		persistenceFailures: 0,
		projectionRecovery: { attempted: 0, recovered: 0, failed: 0 },
	})),
	sendTelemetryReport: vi.fn(),
}));

vi.mock("@/lib/jobs/billing-seat-reconciliation", () => ({
	runBillingSeatReconciliation,
}));

vi.mock("@/lib/jobs/scim-maintenance", () => ({
	runSCIMMaintenance,
	SCIMMaintenanceDegradedError: class SCIMMaintenanceDegradedError extends Error {
		constructor() {
			super("SCIM maintenance degraded");
		}
	},
}));

vi.mock("@/env", () => ({ env: mockEnv }));

vi.mock("@/lib/telemetry", () => ({
	calculateTelemetryMetrics,
	getOrCreateTelemetryIdentity,
	sendTelemetryReport,
}));

beforeEach(() => {
	vi.clearAllMocks();
	mockEnv.TELEMETRY_ENABLED = "true";
});

describe("CRON_JOBS execution cleanup", () => {
	it("registers the daily execution cleanup cron with tracking metadata", () => {
		expect(CRON_JOBS["cron:execution-cleanup"]).toMatchObject({
			schedule: "30 2 * * *",
			description:
				"Delete cron execution records past the configured retention period",
			defaultJobOptions: { attempts: 2, priority: 9 },
		});
	});
});

describe("CRON_JOBS billing seat reconciliation", () => {
	it("registers the hourly billing seat reconciliation cron", async () => {
		expect(CRON_JOBS["cron:billing-seat-reconciliation"]).toMatchObject({
			schedule: "0 * * * *",
			defaultJobOptions: { attempts: 2, priority: 8 },
		});
		expect(CRON_JOBS["cron:billing-seat-reconciliation"].description).toContain(
			"billing seat reconciliation",
		);

		await CRON_JOBS["cron:billing-seat-reconciliation"].processor({
			triggeredAt: "2026-06-01T00:00:00.000Z",
		});

		expect(runBillingSeatReconciliation).toHaveBeenCalledOnce();
	});
});

describe("CRON_JOBS SCIM maintenance", () => {
	it("registers durable SCIM maintenance every minute without BullMQ retries", async () => {
		expect(CRON_JOBS["cron:scim-maintenance"]).toMatchObject({
			schedule: "* * * * *",
			defaultJobOptions: { attempts: 1, priority: 8 },
		});

		await CRON_JOBS["cron:scim-maintenance"].processor({
			triggeredAt: "2026-08-25T00:00:00.000Z",
		});

		expect(runSCIMMaintenance).toHaveBeenCalledOnce();
	});

	it("rejects terminal SCIM delivery outcomes so worker reliability records a failed run", async () => {
		runSCIMMaintenance.mockResolvedValueOnce({
			outbox: {
				claimed: 1,
				completed: 0,
				deferred: 0,
				exhausted: 1,
				persistenceFailures: 0,
			},
			exhausted: 1,
			persistenceFailures: 0,
			projectionRecovery: { attempted: 0, recovered: 0, failed: 0 },
		});

		await expect(
			CRON_JOBS["cron:scim-maintenance"].processor({
				triggeredAt: "2026-08-25T00:00:00.000Z",
			}),
		).rejects.toThrow("SCIM maintenance degraded");
	});
});

describe("CRON_JOBS telemetry", () => {
	const deploymentId = "123e4567-e89b-42d3-a456-426614174000";
	const metrics = {
		activeUsers24h: 18,
		totalOrganizations: 2,
		totalEmployees: 156,
		sessionsCreated24h: 42,
		licenseType: "community" as const,
	};

	it("registers signed telemetry daily at UTC midnight without BullMQ retries", () => {
		expect(CRON_JOBS["cron:telemetry"]).toMatchObject({
			schedule: "0 0 * * *",
			description: "Collect and export telemetry data",
			defaultJobOptions: { attempts: 1, priority: 9 },
		});
	});

	it("defaults to enabled and sends telemetry", async () => {
		getOrCreateTelemetryIdentity.mockResolvedValue({ deploymentId });
		calculateTelemetryMetrics.mockResolvedValue(metrics);
		sendTelemetryReport.mockResolvedValue(true);

		const result = await CRON_JOBS["cron:telemetry"].processor({
			triggeredAt: "2026-06-01T00:00:00.000Z",
		});

		expect(getOrCreateTelemetryIdentity).toHaveBeenCalledExactlyOnceWith();
		expect(calculateTelemetryMetrics).toHaveBeenCalledExactlyOnceWith();
		expect(
			getOrCreateTelemetryIdentity.mock.invocationCallOrder[0],
		).toBeLessThan(calculateTelemetryMetrics.mock.invocationCallOrder[0] ?? 0);
		expect(sendTelemetryReport).toHaveBeenCalledExactlyOnceWith(
			deploymentId,
			metrics,
		);
		expect(result).toEqual({ success: true, message: "Telemetry sent" });
	});

	it("throws when the sender reports failure", async () => {
		getOrCreateTelemetryIdentity.mockResolvedValue({ deploymentId });
		calculateTelemetryMetrics.mockResolvedValue(metrics);
		sendTelemetryReport.mockResolvedValue(false);

		await expect(
			CRON_JOBS["cron:telemetry"].processor({
				triggeredAt: "2026-06-01T00:00:00.000Z",
			}),
		).rejects.toThrow(new Error("Telemetry send failed"));

		expect(getOrCreateTelemetryIdentity).toHaveBeenCalledExactlyOnceWith();
		expect(calculateTelemetryMetrics).toHaveBeenCalledExactlyOnceWith();
		expect(sendTelemetryReport).toHaveBeenCalledExactlyOnceWith(
			deploymentId,
			metrics,
		);
		expect(CRON_JOBS["cron:telemetry"].defaultJobOptions).toEqual({
			attempts: 1,
			priority: 9,
		});
	});

	it("completes without telemetry work when disabled", async () => {
		mockEnv.TELEMETRY_ENABLED = "false";

		const result = await CRON_JOBS["cron:telemetry"].processor({
			triggeredAt: "2026-06-01T00:00:00.000Z",
		});

		expect(result).toEqual({ success: true, message: "Telemetry disabled" });
		expect(getOrCreateTelemetryIdentity).not.toHaveBeenCalled();
		expect(calculateTelemetryMetrics).not.toHaveBeenCalled();
		expect(sendTelemetryReport).not.toHaveBeenCalled();
	});
});
