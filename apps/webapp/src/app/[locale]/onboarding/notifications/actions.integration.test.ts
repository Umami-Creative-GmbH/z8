import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const actor = vi.hoisted(() => ({
	userId: "r033-account-a",
	signedIn: true,
	mfa: false,
	sso: false,
}));
vi.mock("next/headers", async () => (await import("@/test/integration-harness")).nextHeaders());
vi.mock("next/server", async (original) =>
	(await import("@/test/integration-harness")).nextServer(original),
);
vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: async () =>
				actor.signedIn
					? {
							user: { id: actor.userId, role: "user" },
							session: { id: "r033-session", userId: actor.userId, activeOrganizationId: null },
							mfaRequired: actor.mfa,
							ssoRequired: actor.sso,
						}
					: null,
		},
	},
}));
const { configureNotificationsOnboarding, skipNotificationsSetup } = await import("./actions");
const pool = integrationAdminPool();
const values = {
	enablePush: false,
	enableEmail: true,
	notifyApprovals: false,
	notifyStatusUpdates: true,
	notifyTeamChanges: false,
};
const read = async (userId = actor.userId) =>
	(
		await pool.query(
			"SELECT notification_type, channel, enabled FROM notification_preference WHERE user_id=$1 ORDER BY notification_type::text, channel::text",
			[userId],
		)
	).rows;

describe("notification onboarding actions on disposable PostgreSQL", () => {
	beforeEach(async () => {
		actor.userId = "r033-account-a";
		actor.signedIn = true;
		actor.mfa = false;
		actor.sso = false;
		await pool.query('DELETE FROM "user" WHERE id IN ($1,$2)', [
			"r033-account-a",
			"r033-account-b",
		]);
		await pool.query(
			'INSERT INTO "user" (id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,true,now(),now()),($3,$3,$4,true,now(),now())',
			["r033-account-a", "r033-a@example.test", "r033-account-b", "r033-b@example.test"],
		);
	});
	afterAll(async () => {
		await pool.query('DELETE FROM "user" WHERE id IN ($1,$2)', [
			"r033-account-a",
			"r033-account-b",
		]);
	});
	it("persists every channel/topic value for the authenticated account and supports updating", async () => {
		expect((await configureNotificationsOnboarding(values)).success).toBe(true);
		expect(await read()).toEqual([
			{ notification_type: "approval_request_approved", channel: "email", enabled: true },
			{ notification_type: "approval_request_approved", channel: "in_app", enabled: true },
			{ notification_type: "approval_request_approved", channel: "push", enabled: false },
			{ notification_type: "approval_request_rejected", channel: "email", enabled: true },
			{ notification_type: "approval_request_rejected", channel: "in_app", enabled: true },
			{ notification_type: "approval_request_rejected", channel: "push", enabled: false },
			{ notification_type: "approval_request_submitted", channel: "email", enabled: false },
			{ notification_type: "approval_request_submitted", channel: "in_app", enabled: false },
			{ notification_type: "approval_request_submitted", channel: "push", enabled: false },
			{ notification_type: "team_member_added", channel: "email", enabled: false },
			{ notification_type: "team_member_added", channel: "in_app", enabled: false },
			{ notification_type: "team_member_added", channel: "push", enabled: false },
			{ notification_type: "team_member_removed", channel: "email", enabled: false },
			{ notification_type: "team_member_removed", channel: "in_app", enabled: false },
			{ notification_type: "team_member_removed", channel: "push", enabled: false },
		]);
		expect(
			(
				await pool.query("SELECT onboarding_step FROM user_settings WHERE user_id=$1", [
					actor.userId,
				])
			).rows,
		).toEqual([{ onboarding_step: "complete" }]);
		expect(await read("r033-account-b")).toEqual([]);
		expect(
			(await configureNotificationsOnboarding({ ...values, enablePush: true, enableEmail: false }))
				.success,
		).toBe(true);
		const rows = await read();
		expect(rows).toHaveLength(15);
		expect(rows.filter((row) => row.channel === "email").every((row) => !row.enabled)).toBe(true);
		expect(rows.filter((row) => row.channel === "push" && row.enabled)).toHaveLength(2);
		expect(
			(
				await pool.query("SELECT count(*)::int AS n FROM push_subscription WHERE user_id=$1", [
					actor.userId,
				])
			).rows[0].n,
		).toBe(0);
		expect(
			(await pool.query("SELECT count(*)::int AS n FROM member WHERE user_id=$1", [actor.userId]))
				.rows[0].n,
		).toBe(0);
	});
	it("skip preserves stored preferences and uses the current account on every invocation", async () => {
		await configureNotificationsOnboarding(values);
		const before = await read();
		expect((await skipNotificationsSetup()).success).toBe(true);
		expect(await read()).toEqual(before);
		actor.userId = "r033-account-b";
		expect((await skipNotificationsSetup()).success).toBe(true);
		expect(await read()).toEqual([]);
		expect(await read("r033-account-a")).toEqual(before);
	});
	it.each(["signed-out", "mfa", "sso"])(
		"refuses %s for save and skip without writing",
		async (refusal) => {
			actor.signedIn = refusal !== "signed-out";
			actor.mfa = refusal === "mfa";
			actor.sso = refusal === "sso";
			expect(await configureNotificationsOnboarding(values)).toEqual(
				expect.objectContaining({ success: false, code: "AuthenticationError" }),
			);
			expect(await skipNotificationsSetup()).toEqual(
				expect.objectContaining({ success: false, code: "AuthenticationError" }),
			);
			expect(await read()).toEqual([]);
		},
	);
});
