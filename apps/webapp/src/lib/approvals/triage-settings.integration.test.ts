import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	getApprovalTriageSettingsAction,
	saveApprovalTriageSettingsAction,
} from "@/app/[locale]/(app)/settings/approval-policies/triage-actions";
import { getAbility } from "@/lib/auth-helpers";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { buildInboxTriage } from "./inbox/triage";
import { getEffectiveApprovalTriagePolicy } from "./triage-policy";

const request = vi.hoisted(() => ({
	current: null as null | {
		user: { id: string; name: string; email: string };
		session: { id: string; userId: string; activeOrganizationId: string };
	},
}));
vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: async () => request.current,
}));
vi.mock("next/cache", async (importOriginal) =>
	(await import("@/test/integration-harness")).nextCache(importOriginal),
);

describe("organization triage settings (#1353)", () => {
	let fixture: LifecycleDatabaseFixture;
	let otherOrg: string;
	let otherOwner: string;
	let approvalManager: string;
	function signIn(
		userId = fixture.ownerUserId,
		organizationId = fixture.organizationId,
	) {
		request.current = {
			user: { id: userId, name: "Actor", email: `${userId}@example.test` },
			session: {
				id: "triage-settings-session",
				userId,
				activeOrganizationId: organizationId,
			},
		};
	}
	async function audits() {
		const { rows } = await fixture.pool.query<{
			organization_id: string;
			performed_by: string;
			entity_type: string;
			changes: string;
		}>(
			"select organization_id, performed_by, entity_type, changes from audit_log where organization_id = $1 and action = 'approval_setting.triage_changed' order by timestamp, id",
			[fixture.organizationId],
		);
		return rows.map((row) => ({ ...row, changes: JSON.parse(row.changes) }));
	}
	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		otherOrg = await fixture.createOrganization();
		otherOwner = (
			await fixture.seedEmployee({ organizationId: otherOrg, role: "owner" })
		).userId;
		const manager = await fixture.seedEmployee();
		approvalManager = manager.userId;
		// An employee-admin can manage approvals, but their member role is not organization admin.
		await fixture.pool.query(
			"update employee set role = 'admin' where id = $1",
			[manager.employeeId],
		);
	});
	beforeEach(async () => {
		await fixture.pool.query(
			"delete from approval_setting where organization_id = any($1::text[])",
			[[fixture.organizationId, otherOrg]],
		);
		await fixture.pool.query(
			"delete from audit_log where organization_id = any($1::text[])",
			[[fixture.organizationId, otherOrg]],
		);
		signIn();
	});
	afterAll(async () => fixture?.close());
	it("lets an organization admin save thresholds and refresh the shared effective policy", async () => {
		expect(await getApprovalTriageSettingsAction()).toEqual({
			success: true,
			data: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
		});
		expect(
			await saveApprovalTriageSettingsAction({
				staleAfterHours: 12,
				smallCorrectionMinutes: 0,
			}),
		).toEqual({
			success: true,
			data: { staleAfterHours: 12, smallCorrectionMinutes: 0 },
		});
		expect(await getApprovalTriageSettingsAction()).toEqual({
			success: true,
			data: { staleAfterHours: 12, smallCorrectionMinutes: 0 },
		});
		expect(
			await getEffectiveApprovalTriagePolicy({
				organizationId: fixture.organizationId,
			}),
		).toEqual({ staleAfterHours: 12, smallCorrectionMinutes: 0 });
	});
	it("withholds editable settings from approval managers, signed-out users and outsiders", async () => {
		signIn(approvalManager);
		expect((await getAbility())?.can("manage", "Approval")).toBe(true);
		expect(await getApprovalTriageSettingsAction()).toMatchObject({
			success: false,
		});
		expect(
			await saveApprovalTriageSettingsAction({
				staleAfterHours: 1,
				smallCorrectionMinutes: 60,
			}),
		).toMatchObject({ success: false });
		signIn(fixture.ownerUserId, otherOrg);
		expect(await getApprovalTriageSettingsAction()).toMatchObject({
			success: false,
		});
		expect(
			await saveApprovalTriageSettingsAction({
				staleAfterHours: 1,
				smallCorrectionMinutes: 60,
			}),
		).toMatchObject({ success: false });
		request.current = null;
		expect(await getApprovalTriageSettingsAction()).toMatchObject({
			success: false,
		});
		expect(
			await saveApprovalTriageSettingsAction({
				staleAfterHours: 1,
				smallCorrectionMinutes: 60,
			}),
		).toMatchObject({ success: false });
		expect(
			await getEffectiveApprovalTriagePolicy({ organizationId: otherOrg }),
		).toEqual({ staleAfterHours: 72, smallCorrectionMinutes: 15 });
		expect(await audits()).toEqual([]);
	});
	it.each([
		{ staleAfterHours: 0, smallCorrectionMinutes: 15 },
		{ staleAfterHours: 721, smallCorrectionMinutes: 15 },
		{ staleAfterHours: 1.5, smallCorrectionMinutes: 15 },
		{ staleAfterHours: NaN, smallCorrectionMinutes: 15 },
		{ staleAfterHours: Infinity, smallCorrectionMinutes: 15 },
		{ staleAfterHours: "72", smallCorrectionMinutes: 15 },
		{ staleAfterHours: 72, smallCorrectionMinutes: -1 },
		{ staleAfterHours: 72, smallCorrectionMinutes: 61 },
		{ staleAfterHours: 72, smallCorrectionMinutes: 0.5 },
		{ staleAfterHours: 72, smallCorrectionMinutes: NaN },
		{ staleAfterHours: 72, smallCorrectionMinutes: -Infinity },
		{ staleAfterHours: 72, smallCorrectionMinutes: "15" },
		null,
		{},
		{ staleAfterHours: 72 },
	])(
		"rejects malformed thresholds without altering policy or audit (%j)",
		async (input) => {
			const result = await saveApprovalTriageSettingsAction(input);
			expect(result).toMatchObject({
				success: false,
				error: expect.any(String),
			});
			expect(
				await getEffectiveApprovalTriagePolicy({
					organizationId: fixture.organizationId,
				}),
			).toEqual({ staleAfterHours: 72, smallCorrectionMinutes: 15 });
			expect(await audits()).toEqual([]);
		},
	);
	it.each([
		{ staleAfterHours: 1, smallCorrectionMinutes: 0 },
		{ staleAfterHours: 720, smallCorrectionMinutes: 60 },
	])("accepts both inclusive bounds (%j)", async (policy) => {
		expect(await saveApprovalTriageSettingsAction(policy)).toEqual({
			success: true,
			data: policy,
		});
		expect(await getApprovalTriageSettingsAction()).toEqual({
			success: true,
			data: policy,
		});
	});
	it("audits only actual changes with the organization, actor and old/new values", async () => {
		await saveApprovalTriageSettingsAction({
			staleAfterHours: 72,
			smallCorrectionMinutes: 15,
		});
		expect(await audits()).toEqual([]);
		await saveApprovalTriageSettingsAction({
			staleAfterHours: 24,
			smallCorrectionMinutes: 0,
		});
		await saveApprovalTriageSettingsAction({
			staleAfterHours: 24,
			smallCorrectionMinutes: 0,
		});
		expect(await audits()).toEqual([
			{
				organization_id: fixture.organizationId,
				performed_by: fixture.ownerUserId,
				entity_type: "approval_setting",
				changes: {
					staleAfterHours: { from: 72, to: 24 },
					smallCorrectionMinutes: { from: 15, to: 0 },
				},
			},
		]);
	});
	it("rolls the setting back when its transactional audit cannot be recorded", async () => {
		await fixture.pool.query(`create function reject_triage_audit() returns trigger language plpgsql as $$ begin if new.action = 'approval_setting.triage_changed' then raise exception 'test audit refused'; end if; return new; end $$;
  create trigger reject_triage_audit before insert on audit_log for each row execute function reject_triage_audit();`);
		try {
			expect(
				await saveApprovalTriageSettingsAction({
					staleAfterHours: 24,
					smallCorrectionMinutes: 0,
				}),
			).toMatchObject({ success: false });
			expect(await getApprovalTriageSettingsAction()).toEqual({
				success: true,
				data: { staleAfterHours: 72, smallCorrectionMinutes: 15 },
			});
			expect(await audits()).toEqual([]);
		} finally {
			await fixture.pool.query(
				"drop trigger reject_triage_audit on audit_log; drop function reject_triage_audit()",
			);
		}
	});
	it("keeps policy and audit isolated when switching active organizations", async () => {
		await saveApprovalTriageSettingsAction({
			organizationId: otherOrg,
			staleAfterHours: 12,
			smallCorrectionMinutes: 0,
		});
		expect(
			await getEffectiveApprovalTriagePolicy({ organizationId: otherOrg }),
		).toEqual({ staleAfterHours: 72, smallCorrectionMinutes: 15 });
		signIn(otherOwner, otherOrg);
		await saveApprovalTriageSettingsAction({
			staleAfterHours: 48,
			smallCorrectionMinutes: 60,
		});
		expect(await getApprovalTriageSettingsAction()).toEqual({
			success: true,
			data: { staleAfterHours: 48, smallCorrectionMinutes: 60 },
		});
		signIn();
		expect(await getApprovalTriageSettingsAction()).toEqual({
			success: true,
			data: { staleAfterHours: 12, smallCorrectionMinutes: 0 },
		});
		expect((await audits())[0]?.performed_by).toBe(fixture.ownerUserId);
	});
	it("refreshes existing stale-age output and disables the correction lane even for zero movement", async () => {
		const context = {
			organizationId: fixture.organizationId,
			requestId: "req",
			entityId: "entity",
			revision: "v1",
			scope: "submitted_request",
		};
		const input = {
			type: "absence_entry" as const,
			priority: "normal" as const,
			status: "pending" as const,
			createdAt: "2026-10-17T00:00:00Z",
			now: new Date("2026-10-18T00:00:00Z"),
			context,
		};
		expect(
			buildInboxTriage({
				...input,
				policy: await getEffectiveApprovalTriagePolicy({
					organizationId: fixture.organizationId,
				}),
			}).riskReasons,
		).not.toContain("stale_pending");
		await saveApprovalTriageSettingsAction({
			staleAfterHours: 24,
			smallCorrectionMinutes: 0,
		});
		const policy = await getEffectiveApprovalTriagePolicy({
			organizationId: fixture.organizationId,
		});
		expect(buildInboxTriage({ ...input, policy })).toMatchObject({
			riskLevel: "high",
			fastLaneGroup: "stale_pending",
			reasons: expect.arrayContaining([
				expect.objectContaining({
					code: "stale_pending",
					facts: { staleAfterHours: 24 },
				}),
			]),
		});
		const correction = buildInboxTriage({
			...input,
			type: "time_entry",
			requestKind: "time_correction",
			createdAt: "2026-10-17T23:00:00Z",
			policy,
			evidence: [
				{ check: "payroll", state: "clear", validity: "current", context },
				{
					check: "correction",
					state: "clear",
					validity: "current",
					context,
					correction: {
						plainTimeEdit: true,
						originalStart: "2026-10-17T08:00:00Z",
						originalEnd: "2026-10-17T16:00:00Z",
						proposedStart: "2026-10-17T08:00:00Z",
						proposedEnd: "2026-10-17T16:00:00Z",
					},
				},
			],
		});
		expect(correction.fastLaneGroup).toBeNull();
		expect(correction.riskLevel).toBe("medium");
	});
	it("fails closed on policy read failures instead of reusing another organization's policy or defaults", async () => {
		await saveApprovalTriageSettingsAction({
			staleAfterHours: 12,
			smallCorrectionMinutes: 0,
		});
		await fixture.pool.query(
			"alter table approval_setting rename to triage_settings_unavailable",
		);
		try {
			await expect(
				getEffectiveApprovalTriagePolicy({
					organizationId: fixture.organizationId,
				}),
			).rejects.toThrow();
			await expect(
				getEffectiveApprovalTriagePolicy({ organizationId: otherOrg }),
			).rejects.toThrow();
			expect(await getApprovalTriageSettingsAction()).toMatchObject({
				success: false,
			});
		} finally {
			await fixture.pool.query(
				"alter table triage_settings_unavailable rename to approval_setting",
			);
		}
	});
});
