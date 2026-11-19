import { Layer } from "effect";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const actor = vi.hoisted(() => ({ id: "r040-1835-admin", organizationId: "r040-1835-a" }));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("@/lib/auth/request-session", () => ({
	getRequestSession: async () => ({
		user: { id: actor.id },
		session: {
			id: "r040-synthetic-request",
			userId: actor.id,
			activeOrganizationId: actor.organizationId,
		},
	}),
}));
vi.mock("@/lib/effect/runtime", async () => {
	const { OnboardingServiceLive } = await import("@/lib/effect/services/onboarding.service");
	const { AuthServiceLive } = await import("@/lib/effect/services/auth.service");
	const { DatabaseServiceLive } = await import("@/lib/effect/services/database.service");
	return (await import("@/test/effect-runtime")).runtimeModuleOver(
		OnboardingServiceLive.pipe(Layer.provide(Layer.mergeAll(AuthServiceLive, DatabaseServiceLive))),
	);
});

import { checkIsAdmin, createWorkTemplateOnboarding, skipWorkTemplateSetup } from "./actions";

describe("organization work-template production action and scoped PostgreSQL records", () => {
	const pool = integrationAdminPool();
	const input = {
		name: "Four-day template",
		hoursPerWeek: 32.5,
		workingDays: ["monday", "tuesday", "wednesday", "thursday"],
		setAsDefault: true,
	} satisfies Parameters<typeof createWorkTemplateOnboarding>[0];
	async function cleanup() {
		await pool.query("DELETE FROM organization WHERE id=ANY($1::text[])", [
			["r040-1835-a", "r040-1835-b"],
		]);
		await pool.query('DELETE FROM "user" WHERE id=ANY($1::text[])', [
			["r040-1835-admin", "r040-1835-member"],
		]);
	}
	beforeEach(async () => {
		await cleanup();
		actor.id = "r040-1835-admin";
		actor.organizationId = "r040-1835-a";
		await pool.query(
			'INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,true,now(),now()),($3,$3,$4,true,now(),now())',
			[actor.id, "r040-admin@example.test", "r040-1835-member", "r040-member@example.test"],
		);
		await pool.query(
			"INSERT INTO organization (id,name,slug,created_at) VALUES ($1,$1,$1,now()),($2,$2,$2,now())",
			[actor.organizationId, "r040-1835-b"],
		);
		await pool.query(
			"INSERT INTO member (id,user_id,organization_id,role,created_at) VALUES ('r040-admin-a',$1,$2,'admin',now()),('r040-member-a','r040-1835-member',$2,'member',now()),('r040-admin-b',$1,'r040-1835-b','member',now())",
			[actor.id, actor.organizationId],
		);
	});
	afterAll(cleanup);
	it("creates the exact weekly schedule and organization default without touching recorded time or display-week preference", async () => {
		await pool.query(
			"INSERT INTO user_settings (user_id,week_start_day,updated_at) VALUES ($1,'monday',now())",
			[actor.id],
		);
		const timeBefore = (
			await pool.query("SELECT count(*)::int n FROM time_entry WHERE organization_id=$1", [
				actor.organizationId,
			])
		).rows[0].n;
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		expect(await createWorkTemplateOnboarding(input)).toEqual({ success: true, data: undefined });
		const policies = (
			await pool.query("SELECT id,name,is_default FROM work_policy WHERE organization_id=$1", [
				actor.organizationId,
			])
		).rows;
		expect(policies).toEqual([
			{ id: expect.any(String), name: "Four-day template", is_default: true },
		]);
		const schedules = (
			await pool.query(
				"SELECT id,schedule_cycle,schedule_type,hours_per_cycle FROM work_policy_schedule WHERE policy_id=$1",
				[policies[0].id],
			)
		).rows;
		expect(schedules).toEqual([
			{
				id: expect.any(String),
				schedule_cycle: "weekly",
				schedule_type: "simple",
				hours_per_cycle: "32.50",
			},
		]);
		const days = (
			await pool.query(
				"SELECT day_of_week,hours_per_day,is_work_day FROM work_policy_schedule_day WHERE schedule_id=$1 ORDER BY day_of_week::text",
				[schedules[0].id],
			)
		).rows;
		expect(days).toEqual([
			{ day_of_week: "friday", hours_per_day: "0.00", is_work_day: false },
			{ day_of_week: "monday", hours_per_day: "8.10", is_work_day: true },
			{ day_of_week: "saturday", hours_per_day: "0.00", is_work_day: false },
			{ day_of_week: "sunday", hours_per_day: "0.00", is_work_day: false },
			{ day_of_week: "thursday", hours_per_day: "8.10", is_work_day: true },
			{ day_of_week: "tuesday", hours_per_day: "8.10", is_work_day: true },
			{ day_of_week: "wednesday", hours_per_day: "8.10", is_work_day: true },
		]);
		expect(
			(
				await pool.query(
					"SELECT organization_id,assignment_type FROM work_policy_assignment WHERE policy_id=$1",
					[policies[0].id],
				)
			).rows,
		).toEqual([{ organization_id: actor.organizationId, assignment_type: "organization" }]);
		expect(
			(await pool.query("SELECT onboarding_step FROM user_settings WHERE user_id=$1", [actor.id]))
				.rows[0],
		).toEqual({ onboarding_step: "wellness" });
		expect(
			(await pool.query("SELECT week_start_day FROM user_settings WHERE user_id=$1", [actor.id]))
				.rows[0].week_start_day,
		).toBe("monday");
		expect(
			(
				await pool.query("SELECT count(*)::int n FROM time_entry WHERE organization_id=$1", [
					actor.organizationId,
				])
			).rows[0].n,
		).toBe(timeBefore);
		expect(
			(
				await pool.query(
					"SELECT count(*)::int n FROM work_policy WHERE organization_id='r040-1835-b'",
				)
			).rows[0].n,
		).toBe(0);
	});
	it("keeps a non-default template unassigned", async () => {
		expect((await createWorkTemplateOnboarding({ ...input, setAsDefault: false })).success).toBe(
			true,
		);
		expect(
			(
				await pool.query("SELECT is_default FROM work_policy WHERE organization_id=$1", [
					actor.organizationId,
				])
			).rows,
		).toEqual([{ is_default: false }]);
		expect(
			(
				await pool.query(
					"SELECT count(*)::int n FROM work_policy_assignment WHERE organization_id=$1",
					[actor.organizationId],
				)
			).rows[0].n,
		).toBe(0);
	});
	it("skips without creating a policy and preserves the writer's existing wellness destination", async () => {
		expect((await skipWorkTemplateSetup()).success).toBe(true);
		expect(
			(
				await pool.query("SELECT count(*)::int n FROM work_policy WHERE organization_id=$1", [
					actor.organizationId,
				])
			).rows[0].n,
		).toBe(0);
		expect(
			(await pool.query("SELECT onboarding_step FROM user_settings WHERE user_id=$1", [actor.id]))
				.rows[0].onboarding_step,
		).toBe("wellness");
	});
	it("refuses a restricted actor and a changed active organization", async () => {
		actor.id = "r040-1835-member";
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: false });
		expect(await createWorkTemplateOnboarding(input)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(await skipWorkTemplateSetup()).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		actor.id = "r040-1835-admin";
		actor.organizationId = "r040-1835-b";
		expect(await createWorkTemplateOnboarding(input)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			(
				await pool.query(
					"SELECT count(*)::int n FROM work_policy WHERE organization_id=ANY($1::text[])",
					[["r040-1835-a", "r040-1835-b"]],
				)
			).rows[0].n,
		).toBe(0);
	});
	it("rechecks authority on late submission after the administrator check", async () => {
		expect(await checkIsAdmin()).toMatchObject({ success: true, data: true });
		await pool.query(
			"UPDATE member SET role='member' WHERE id='r040-admin-a' AND organization_id=$1",
			[actor.organizationId],
		);
		expect(await createWorkTemplateOnboarding(input)).toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(
			(
				await pool.query("SELECT count(*)::int n FROM work_policy WHERE organization_id=$1", [
					actor.organizationId,
				])
			).rows[0].n,
		).toBe(0);
	});
});
