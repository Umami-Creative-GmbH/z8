/**
 * PostgreSQL contract: pnpm --filter webapp test:approval-workflow-repository:integration
 * The existing runner owns, migrates, and removes the disposable database.
 *
 * Drives the real worker dispatch (queued/manual and scheduler-created job
 * shapes), execution tracking, ownership gate, approval discovery and legacy
 * escalation writes against PostgreSQL. Only provider configuration loaders and
 * outbound provider messages are replaced.
 */
import { randomUUID } from "node:crypto";
import type { Job } from "bullmq";
import { eq, inArray, sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { organization, user } from "@/db/auth-schema";
import {
	approvalEscalationControl,
	approvalRequest,
	cronJobExecution,
	discordEscalation,
	discordUserMapping,
	employee,
	employeeManagers,
	slackEscalation,
	slackUserMapping,
	teamsEscalation,
	telegramEscalation,
	telegramUserMapping,
} from "@/db/schema";
import {
	resolveApprovalWorkflowRepositoryTestConfiguration,
	verifyApprovalWorkflowRepositoryTestDatabase,
} from "@/lib/approvals/workflow/repository-integration-harness";
import { createJobExecution } from "@/lib/cron/tracking";
import type { AllJobData, JobResult } from "@/lib/queue";
import { processJob } from "@/worker";
import { LEGACY_ESCALATION_JOB_NAMES } from "./legacy-escalation-schedulers";

const providers = vi.hoisted(() => {
	const state = {
		configs: [] as Array<Record<string, unknown>>,
		sent: [] as Array<{ approvalId: string; managerId: string; organizationId: string }>,
		recordSend: (approvalId: string, managerId: string, organizationId: string) => {
			state.sent.push({ approvalId, managerId, organizationId });
			return Promise.resolve();
		},
	};
	return state;
});

vi.mock("@/lib/slack/bot-config", () => ({ getAllActiveBotConfigs: async () => providers.configs }));
vi.mock("@/lib/telegram/bot-config", () => ({ getAllActiveBotConfigs: async () => providers.configs }));
vi.mock("@/lib/discord/bot-config", () => ({ getAllActiveBotConfigs: async () => providers.configs }));
vi.mock("@/lib/teams/tenant-resolver", () => ({ getAllActiveTenants: async () => providers.configs }));
vi.mock("@/lib/slack/approval-handler", () => ({ sendApprovalMessageToManager: providers.recordSend }));
vi.mock("@/lib/telegram/approval-handler", () => ({ sendApprovalMessageToManager: providers.recordSend }));
vi.mock("@/lib/discord/approval-handler", () => ({ sendApprovalMessageToManager: providers.recordSend }));
vi.mock("@/lib/teams/approval-handler", () => ({ sendApprovalCardToManager: providers.recordSend }));

const databaseUrl = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL;
const testSentinel = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL;
const integrationRequired = process.env.APPROVAL_WORKFLOW_REPOSITORY_TEST_REQUIRED === "1";
const integrationConfiguration = resolveApprovalWorkflowRepositoryTestConfiguration({
	databaseUrl,
	required: integrationRequired,
	sentinel: testSentinel,
});
if (integrationConfiguration.status === "error") {
	throw new Error(
		`Invalid legacy escalation fencing integration test configuration: ${integrationConfiguration.reason}`,
	);
}
const describeIntegration = integrationConfiguration.status === "enabled" ? describe : describe.skip;
if (integrationConfiguration.status === "unavailable") {
	describe.skip(`legacy escalation fencing PostgreSQL unavailable: ${integrationConfiguration.reason}`, () => {
		it("requires the label-owned disposable PostgreSQL runner", () => {});
	});
}

type LegacyEscalationJobName = (typeof LEGACY_ESCALATION_JOB_NAMES)[number];
type OrgKey = "legacy" | "moved" | "paused";

interface SeededOrg {
	organizationId: string;
	requester: string;
	approver: string;
	backup: string;
	assignedByUserId: string;
	backupUserId: string;
}

const escalationTable = {
	"cron:slack-escalation": slackEscalation,
	"cron:telegram-escalation": telegramEscalation,
	"cron:discord-escalation": discordEscalation,
	"cron:teams-escalation": teamsEscalation,
} as const;

const staleCreatedAt = new Date(Date.now() - 72 * 60 * 60 * 1000);
const runId = randomUUID().slice(0, 8);
const seededOrganizationIds: string[] = [];
const seededUserIds: string[] = [];
const executionIds: string[] = [];

async function seedOrg(key: OrgKey): Promise<SeededOrg> {
	const organizationId = `t271-${key}-${runId}-${randomUUID().slice(0, 8)}`;
	await db.insert(organization).values({
		id: organizationId,
		name: `T271 ${key}`,
		slug: organizationId,
		createdAt: new Date(),
	});
	seededOrganizationIds.push(organizationId);

	const people = await Promise.all(
		(["requester", "approver", "backup"] as const).map(async (role) => {
			const userId = `${organizationId}-${role}`;
			await db.insert(user).values({ id: userId, name: `${key} ${role}`, email: `${userId}@t271.test` });
			seededUserIds.push(userId);
			const [row] = await db
				.insert(employee)
				.values({ userId, organizationId })
				.returning({ id: employee.id });
			return { role, userId, employeeId: row!.id };
		}),
	);
	const byRole = Object.fromEntries(people.map((person) => [person.role, person]));
	const seeded: SeededOrg = {
		organizationId,
		requester: byRole.requester!.employeeId,
		approver: byRole.approver!.employeeId,
		backup: byRole.backup!.employeeId,
		assignedByUserId: byRole.approver!.userId,
		backupUserId: byRole.backup!.userId,
	};

	// Slack/Telegram/Discord walk the approver's managers; Teams walks the requester's.
	await db.insert(employeeManagers).values([
		{ employeeId: seeded.approver, managerId: seeded.backup, isPrimary: true, assignedBy: seeded.assignedByUserId },
		{ employeeId: seeded.requester, managerId: seeded.approver, isPrimary: true, assignedBy: seeded.assignedByUserId },
		{ employeeId: seeded.requester, managerId: seeded.backup, isPrimary: false, assignedBy: seeded.assignedByUserId },
	]);
	await db.insert(slackUserMapping).values({
		userId: seeded.backupUserId,
		organizationId,
		slackUserId: `U${organizationId}`,
		slackTeamId: `T${organizationId}`,
	});
	await db.insert(telegramUserMapping).values({
		userId: seeded.backupUserId,
		organizationId,
		telegramUserId: `tg-${organizationId}`,
	});
	await db.insert(discordUserMapping).values({
		userId: seeded.backupUserId,
		organizationId,
		discordUserId: `dc-${organizationId}`,
	});
	return seeded;
}

async function insertStaleApproval(org: SeededOrg): Promise<string> {
	const [row] = await db
		.insert(approvalRequest)
		.values({
			organizationId: org.organizationId,
			entityType: "absence_entry",
			entityId: randomUUID(),
			requestedBy: org.requester,
			approverId: org.approver,
			createdAt: staleCreatedAt,
		})
		.returning({ id: approvalRequest.id });
	return row!.id;
}

async function setControl(organizationId: string, owner: string, automationPaused: boolean) {
	await db
		.insert(approvalEscalationControl)
		.values({ organizationId, owner: owner as "legacy" | "escalation", automationPaused })
		.onConflictDoUpdate({
			target: approvalEscalationControl.organizationId,
			set: { owner: owner as "legacy" | "escalation", automationPaused },
		});
}

function configure(orgs: SeededOrg[]) {
	providers.configs = orgs.map((org) => ({
		organizationId: org.organizationId,
		tenantId: `tenant-${org.organizationId}`,
		botAccessToken: "token-not-used",
		enableEscalations: true,
		escalationTimeoutHours: 24,
	}));
}

async function escalationsFor(jobName: LegacyEscalationJobName, approvalIds: string[]) {
	const table = escalationTable[jobName];
	return db
		.select({ approvalRequestId: table.approvalRequestId, escalatedTo: table.escalatedToApproverId })
		.from(table)
		.where(inArray(table.approvalRequestId, approvalIds));
}

async function approverOf(approvalId: string) {
	const [row] = await db
		.select({ approverId: approvalRequest.approverId })
		.from(approvalRequest)
		.where(eq(approvalRequest.id, approvalId));
	return row?.approverId;
}

/** Queued API/manual job: the route created the execution record before enqueueing. */
async function runManualJob(jobName: LegacyEscalationJobName): Promise<JobResult> {
	const executionId = await createJobExecution({ jobName, metadata: { source: "manual" } });
	executionIds.push(executionId);
	return processJob({
		id: `manual-${randomUUID()}`,
		name: jobName,
		data: { type: jobName, triggeredAt: new Date().toISOString(), executionId },
		attemptsMade: 0,
		opts: { attempts: 1 },
		updateData: async () => {},
	} as unknown as Job<AllJobData>);
}

/** Scheduler-created job: no execution record until the worker creates one. */
async function runScheduledJob(jobName: LegacyEscalationJobName): Promise<JobResult> {
	const job = {
		id: `repeat:cron-${jobName}:${randomUUID()}`,
		name: jobName,
		data: { type: jobName, triggeredAt: new Date().toISOString() } as Record<string, unknown>,
		attemptsMade: 0,
		opts: { attempts: 1 },
		updateData: async (data: Record<string, unknown>) => {
			job.data = data;
		},
	};
	const result = await processJob(job as unknown as Job<AllJobData>);
	executionIds.push(job.data.executionId as string);
	return result;
}

describeIntegration("legacy escalation execution fencing (PostgreSQL)", () => {
	const pool = new Pool({ connectionString: databaseUrl, max: 2 });

	beforeAll(async () => {
		const enabled = await verifyApprovalWorkflowRepositoryTestDatabase({
			databaseUrl,
			required: integrationRequired,
			sentinel: testSentinel,
			currentDatabase: async () => {
				const result = await pool.query<{ database_name: string }>(
					"select current_database() as database_name",
				);
				return result.rows[0]?.database_name ?? "";
			},
		});
		if (enabled.status !== "enabled") {
			throw new Error("Legacy escalation fencing integration test is not enabled");
		}
		// The handlers use the application client; it must target the same disposable database.
		const appDatabase = await db.execute<{ database_name: string }>(
			sql`select current_database() as database_name`,
		);
		expect(appDatabase.rows[0]?.database_name).toBe(enabled.databaseName);
	});

	beforeEach(() => {
		providers.configs = [];
		providers.sent = [];
	});

	afterEach(async () => {
		if (seededOrganizationIds.length > 0) {
			await db.delete(organization).where(inArray(organization.id, seededOrganizationIds.splice(0)));
		}
		if (seededUserIds.length > 0) {
			await db.delete(user).where(inArray(user.id, seededUserIds.splice(0)));
		}
		if (executionIds.length > 0) {
			await db.delete(cronJobExecution).where(inArray(cronJobExecution.id, executionIds.splice(0)));
		}
	});

	afterAll(async () => {
		await pool.end();
	});

	describe.each(LEGACY_ESCALATION_JOB_NAMES)("%s", (jobName) => {
		it("admits only the legacy-owned organization for a queued/manual job and records suppression", async () => {
			const legacy = await seedOrg("legacy");
			const moved = await seedOrg("moved");
			const paused = await seedOrg("paused");
			await setControl(moved.organizationId, "escalation", false);
			await setControl(paused.organizationId, "legacy", true);
			const approvals = {
				legacy: await insertStaleApproval(legacy),
				moved: await insertStaleApproval(moved),
				paused: await insertStaleApproval(paused),
			};
			configure([legacy, moved, paused]);

			const result = await runManualJob(jobName);

			expect(result.success).toBe(true);
			expect(result.data).toMatchObject({ success: true, approvalsEscalated: 1, errors: [] });
			expect(
				(result.data as { suppressedOrganizations: unknown[] }).suppressedOrganizations,
			).toEqual(
				expect.arrayContaining([
					{ organizationId: moved.organizationId, reason: "ownership_moved" },
					{ organizationId: paused.organizationId, reason: "automation_paused" },
				]),
			);
			expect(await escalationsFor(jobName, Object.values(approvals))).toEqual([
				{ approvalRequestId: approvals.legacy, escalatedTo: legacy.backup },
			]);
			expect(providers.sent).toEqual([
				{ approvalId: approvals.legacy, managerId: legacy.backup, organizationId: legacy.organizationId },
			]);
			expect(await approverOf(approvals.moved)).toBe(moved.approver);
			expect(await approverOf(approvals.paused)).toBe(paused.approver);

			// Existing execution tracking persists the explicit suppression outcome.
			const [execution] = await db
				.select({ status: cronJobExecution.status, result: cronJobExecution.result })
				.from(cronJobExecution)
				.where(eq(cronJobExecution.id, executionIds.at(-1)!));
			expect(execution?.status).toBe("completed");
			expect(JSON.stringify(execution?.result)).toContain(moved.organizationId);
		});

		it("rereads ownership on each scheduled run and preserves committed escalations", async () => {
			const org = await seedOrg("legacy");
			configure([org]);
			const committed = await insertStaleApproval(org);

			const first = await runScheduledJob(jobName);
			expect(first.data).toMatchObject({ approvalsEscalated: 1, suppressedOrganizations: [] });
			const committedState = {
				escalations: await escalationsFor(jobName, [committed]),
				approver: await approverOf(committed),
			};
			expect(committedState.escalations).toEqual([{ approvalRequestId: committed, escalatedTo: org.backup }]);

			// Ownership moves between runs: fresh work is refused, committed state is untouched.
			await setControl(org.organizationId, "escalation", false);
			const fresh = await insertStaleApproval(org);
			const afterMove = await runScheduledJob(jobName);
			expect(afterMove.data).toMatchObject({
				approvalsEscalated: 0,
				suppressedOrganizations: [{ organizationId: org.organizationId, reason: "ownership_moved" }],
			});

			// Legacy ownership with automation paused is also refused.
			await setControl(org.organizationId, "legacy", true);
			const afterPause = await runScheduledJob(jobName);
			expect(afterPause.data).toMatchObject({
				approvalsEscalated: 0,
				suppressedOrganizations: [{ organizationId: org.organizationId, reason: "automation_paused" }],
			});

			// An unrecognized owner fails closed with its own outcome.
			await setControl(org.organizationId, "future-owner", false);
			const afterUnknown = await runScheduledJob(jobName);
			expect(afterUnknown.data).toMatchObject({
				approvalsEscalated: 0,
				suppressedOrganizations: [{ organizationId: org.organizationId, reason: "unrecognized_owner" }],
			});

			expect(await escalationsFor(jobName, [committed, fresh])).toEqual(committedState.escalations);
			expect(await approverOf(committed)).toBe(committedState.approver);
			expect(await approverOf(fresh)).toBe(org.approver);
			expect(providers.sent).toHaveLength(1);

			// Resuming legacy ownership admits the pending work again on the next run.
			await setControl(org.organizationId, "legacy", false);
			const resumed = await runScheduledJob(jobName);
			expect(resumed.data).toMatchObject({ approvalsEscalated: 1, suppressedOrganizations: [] });
			expect(await escalationsFor(jobName, [fresh])).toEqual([{ approvalRequestId: fresh, escalatedTo: org.backup }]);
		});
	});

	it("fails closed per organization when the control table cannot be read", async () => {
		const org = await seedOrg("legacy");
		configure([org]);
		const approval = await insertStaleApproval(org);
		const hiddenName = `approval_escalation_control_hidden_${runId}`;
		await pool.query(`alter table approval_escalation_control rename to "${hiddenName}"`);
		try {
			const result = await runManualJob("cron:slack-escalation");
			expect(result.data).toMatchObject({ success: false, approvalsEscalated: 0, suppressedOrganizations: [] });
			expect((result.data as { errors: string[] }).errors).toHaveLength(1);
		} finally {
			await pool.query(`alter table "${hiddenName}" rename to approval_escalation_control`);
		}
		expect(await escalationsFor("cron:slack-escalation", [approval])).toEqual([]);
		expect(providers.sent).toEqual([]);
	});

	it("removes an organization's control with the organization and leaves other tenants intact", async () => {
		const removed = await seedOrg("moved");
		const retained = await seedOrg("paused");
		await setControl(removed.organizationId, "escalation", false);
		await setControl(retained.organizationId, "legacy", true);

		await db.delete(organization).where(eq(organization.id, removed.organizationId));

		const remaining = await db
			.select({ organizationId: approvalEscalationControl.organizationId })
			.from(approvalEscalationControl)
			.where(inArray(approvalEscalationControl.organizationId, [removed.organizationId, retained.organizationId]));
		expect(remaining).toEqual([{ organizationId: retained.organizationId }]);
	});
});
