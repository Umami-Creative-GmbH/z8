import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_JOBS } from "./registry";

const {
	calculateTelemetryMetrics,
	getOrCreateDeploymentId,
	runBillingSeatReconciliation,
	sendTelemetryReport,
} = vi.hoisted(() => ({
	calculateTelemetryMetrics: vi.fn(),
	getOrCreateDeploymentId: vi.fn(),
	runBillingSeatReconciliation: vi.fn(async () => ({
		success: true,
		billingEnabled: true,
		processed: 0,
		synced: 0,
		skipped: 0,
		errors: [],
	})),
	sendTelemetryReport: vi.fn(),
}));

vi.mock("@/lib/jobs/billing-seat-reconciliation", () => ({
	runBillingSeatReconciliation,
}));

vi.mock("@/lib/telemetry", () => ({
	calculateTelemetryMetrics,
	getOrCreateDeploymentId,
	sendTelemetryReport,
}));

beforeEach(() => {
	vi.clearAllMocks();
});

describe("CRON_JOBS execution cleanup", () => {
	it("registers the daily execution cleanup cron with tracking metadata", () => {
		expect(CRON_JOBS["cron:execution-cleanup"]).toMatchObject({
			schedule: "30 2 * * *",
			description: "Delete cron execution records older than 90 days",
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

	it("obtains the deployment ID, calculates metrics, and sends telemetry", async () => {
		getOrCreateDeploymentId.mockResolvedValue(deploymentId);
		calculateTelemetryMetrics.mockResolvedValue(metrics);
		sendTelemetryReport.mockResolvedValue(true);

		const result = await CRON_JOBS["cron:telemetry"].processor({
			triggeredAt: "2026-06-01T00:00:00.000Z",
		});

		expect(getOrCreateDeploymentId).toHaveBeenCalledExactlyOnceWith();
		expect(calculateTelemetryMetrics).toHaveBeenCalledExactlyOnceWith();
		expect(sendTelemetryReport).toHaveBeenCalledExactlyOnceWith(
			deploymentId,
			metrics,
		);
		expect(result).toEqual({ success: true, message: "Telemetry sent" });
	});

	it("returns a failed result when the sender reports failure", async () => {
		getOrCreateDeploymentId.mockResolvedValue(deploymentId);
		calculateTelemetryMetrics.mockResolvedValue(metrics);
		sendTelemetryReport.mockResolvedValue(false);

		const result = await CRON_JOBS["cron:telemetry"].processor({
			triggeredAt: "2026-06-01T00:00:00.000Z",
		});

		expect(getOrCreateDeploymentId).toHaveBeenCalledExactlyOnceWith();
		expect(calculateTelemetryMetrics).toHaveBeenCalledExactlyOnceWith();
		expect(sendTelemetryReport).toHaveBeenCalledExactlyOnceWith(
			deploymentId,
			metrics,
		);
		expect(result).toEqual({
			success: false,
			message: "Telemetry send failed",
		});
	});
});
