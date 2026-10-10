import { beforeEach, describe, expect, it, vi } from "vitest";
import { CRON_JOBS } from "./registry";

const autoClockOut = vi.hoisted(() => ({
	imported: vi.fn(),
	run: vi.fn(async () => ({ closed: 1 })),
}));
vi.mock("@/lib/jobs/auto-clock-out", () => {
	autoClockOut.imported();
	return { runAutoClockOutMaintenance: autoClockOut.run };
});
const cleanup = vi.hoisted(() => ({
	imported: vi.fn(),
	run: vi.fn(async () => ({ deletedCount: 4 })),
}));
vi.mock("@/lib/cleanup", () => {
	cleanup.imported();
	return { runCleanup: cleanup.run };
});
const positionStampPurge = vi.hoisted(() => ({
	imported: vi.fn(),
	run: vi.fn(async () => ({ success: true as const, deletedCount: 3 })),
}));
vi.mock("@/lib/jobs/position-stamp-purge", () => {
	positionStampPurge.imported();
	return { runPositionStampPurge: positionStampPurge.run };
});
const clockingReminders = vi.hoisted(() => ({
	imported: vi.fn(),
	run: vi.fn(async () => ({ sent: 2 })),
}));
vi.mock("@/lib/jobs/clocking-reminders", () => {
	clockingReminders.imported();
	return { runClockingReminders: clockingReminders.run };
});
const absenceDeputyReminders = vi.hoisted(() => ({
	imported: vi.fn(),
	run: vi.fn(async () => ({ candidates: 3, sent: 1 })),
}));
vi.mock("@/lib/jobs/absence-deputy-reminders", () => {
	absenceDeputyReminders.imported();
	return { runAbsenceDeputyRemindersJob: absenceDeputyReminders.run };
});
const deputyCoverSummaries = vi.hoisted(() => ({
	imported: vi.fn(),
	run: vi.fn(async () => ({
		coverStart: { candidates: 2, sent: 1 },
		returnSummary: { candidates: 1, sent: 1 },
		failed: 0,
	})),
}));
vi.mock("@/lib/jobs/deputy-cover-summaries", () => {
	deputyCoverSummaries.imported();
	return { runDeputyCoverSummariesJob: deputyCoverSummaries.run };
});
const {
	calculateTelemetryMetrics,
	getOrCreateTelemetryIdentity,
	mockEnv,
	runBillingSeatReconciliation,
	runEmployeeDepartureMaintenance,
	runSCIMMaintenance,
	sendTelemetryReport,
} = vi.hoisted(() => ({
	runEmployeeDepartureMaintenance: vi.fn(async () => ({
		released: false,
		departures: { processed: 0, effective: 0, blocked: 0, obsolete: 0, notDue: 0, failed: 0 },
		tasks: { claimed: 0, completed: 0, deferred: 0, failed: 0 },
		errors: [],
	})),
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

vi.mock("@/lib/jobs/employee-departures", () => ({
	runEmployeeDepartureMaintenance,
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

describe("CRON_JOBS retention cleanup", () => {
	it.each([
		["cron:notification-cleanup", "old_notifications"],
		["cron:audit-log-cleanup", "old_audit_logs"],
	] as const)("loads %s lazily and runs the %s cleanup daily at 2:30 AM", async (jobName, task) => {
		expect(cleanup.imported).not.toHaveBeenCalled();
		expect(CRON_JOBS[jobName]).toMatchObject({
			schedule: "30 2 * * *",
			defaultJobOptions: { attempts: 2, priority: 9 },
		});

		const result = await CRON_JOBS[jobName].processor({ triggeredAt: "2026-10-09T02:30:00.000Z" });

		expect(result).toEqual({ task, deletedCount: 4 });
		expect(cleanup.run).toHaveBeenCalledExactlyOnceWith({ type: "cleanup", task });
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

describe("CRON_JOBS employee departures", () => {
	it("materializes due departures and delivers follow-up work every minute", async () => {
		expect(CRON_JOBS["cron:employee-departures"]).toMatchObject({
			schedule: "* * * * *",
			defaultJobOptions: { attempts: 1 },
		});

		await CRON_JOBS["cron:employee-departures"].processor({
			triggeredAt: "2026-09-15T00:00:00.000Z",
		});

		expect(runEmployeeDepartureMaintenance).toHaveBeenCalledOnce();
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

describe("position stamp purge cron", () => {
	it("loads the purge lazily and runs it daily at 1 AM", async () => {
		expect(positionStampPurge.imported).not.toHaveBeenCalled();
		expect(CRON_JOBS["cron:position-stamp-purge"]).toMatchObject({
			schedule: "0 1 * * *",
			defaultJobOptions: { attempts: 2, priority: 9 },
		});

		expect(
			await CRON_JOBS["cron:position-stamp-purge"].processor({
				triggeredAt: "2026-10-09T01:00:00Z",
			}),
		).toEqual({ success: true, deletedCount: 3 });
		expect(positionStampPurge.run).toHaveBeenCalledOnce();
	});
});

describe("automatic clock-out cron", () => {
	it("loads maintenance lazily and observes overdue work every five minutes", async () => {
		expect(autoClockOut.imported).not.toHaveBeenCalled();
		expect(CRON_JOBS["cron:auto-clock-out"].schedule).toBe("*/5 * * * *");
		expect(
			await CRON_JOBS["cron:auto-clock-out"].processor({ triggeredAt: "2026-10-25T06:00:00Z" }),
		).toEqual({ closed: 1 });
		expect(autoClockOut.run).toHaveBeenCalledOnce();
	});
});

describe("clocking reminders cron", () => {
	it("loads the reminder job lazily and checks every five minutes", async () => {
		expect(clockingReminders.imported).not.toHaveBeenCalled();
		expect(CRON_JOBS["cron:clocking-reminders"].schedule).toBe("*/5 * * * *");
		expect(
			await CRON_JOBS["cron:clocking-reminders"].processor({ triggeredAt: "2026-10-25T06:00:00Z" }),
		).toEqual({ sent: 2 });
		expect(clockingReminders.run).toHaveBeenCalledOnce();
	});
});

describe("absence deputy reminders cron (#1013)", () => {
	it("loads the reminder job lazily and runs hourly, so each zone's day starts soon after midnight", async () => {
		expect(absenceDeputyReminders.imported).not.toHaveBeenCalled();
		expect(CRON_JOBS["cron:absence-deputy-reminders"].schedule).toBe("0 * * * *");
		expect(
			await CRON_JOBS["cron:absence-deputy-reminders"].processor({
				triggeredAt: "2026-10-25T06:00:00Z",
			}),
		).toEqual({ candidates: 3, sent: 1 });
		expect(absenceDeputyReminders.run).toHaveBeenCalledOnce();
	});
});

describe("deputy cover summaries cron (#1018)", () => {
	it("loads the summary job lazily and runs every 15 minutes, so a late approval is told soon", async () => {
		expect(deputyCoverSummaries.imported).not.toHaveBeenCalled();
		expect(CRON_JOBS["cron:deputy-cover-summaries"].schedule).toBe("*/15 * * * *");
		expect(
			await CRON_JOBS["cron:deputy-cover-summaries"].processor({
				triggeredAt: "2026-10-25T06:00:00Z",
			}),
		).toEqual({
			coverStart: { candidates: 2, sent: 1 },
			returnSummary: { candidates: 1, sent: 1 },
			failed: 0,
		});
		expect(deputyCoverSummaries.run).toHaveBeenCalledOnce();
	});
});
