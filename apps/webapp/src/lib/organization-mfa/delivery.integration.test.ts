import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const mail = vi.hoisted(() => ({
	send: vi.fn(async (_message: unknown, _options: unknown) => ({
		success: false,
	})),
}));
vi.mock("next/cache", async (original) =>
	(await import("@/test/integration-harness")).nextCache(original),
);
vi.mock("@/lib/email/email-service", () => ({ sendEmail: mail.send }));
vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: async () => "http://localhost:3000",
	getDefaultAppBaseUrl: () => "http://localhost:3000",
}));
const { deliverMfaNotices } = await import("./delivery");
const org = "t1310-notice-org",
	person = "t1310-notice-person";

describe("mandatory organization MFA notices", () => {
	const pool = integrationAdminPool();
	async function cleanup() {
		await pool.query("DELETE FROM organization WHERE id=$1", [org]);
		await pool.query('DELETE FROM "user" WHERE id=$1', [person]);
	}
	beforeEach(async () => {
		await cleanup();
		mail.send.mockClear();
		mail.send.mockResolvedValue({ success: false });
		await pool.query(
			'INSERT INTO "user"(id,name,email,email_verified,created_at,updated_at) VALUES ($1,$1,$2,true,now(),now())',
			[person, `${person}@example.test`],
		);
		await pool.query(
			"INSERT INTO organization(id,name,slug,timezone,created_at) VALUES ($1,'Notice Company',$1,'Europe/Berlin',now())",
			[org],
		);
		await pool.query(
			"INSERT INTO member(id,user_id,organization_id,role,status,created_at) VALUES ($1,$2,$3,'owner','approved',now())",
			[`${person}-member`, person, org],
		);
		await pool.query(
			"INSERT INTO notification_preference(id,user_id,organization_id,notification_type,channel,enabled,created_at,updated_at) VALUES (gen_random_uuid(),$1,$2,'organization_mfa_notice','email',false,now(),now()),(gen_random_uuid(),$1,$2,'organization_mfa_notice','in_app',false,now(),now())",
			[person, org],
		);
		await pool.query(
			"INSERT INTO organization_mfa_policy(organization_id,enabled,grace_period_days,updated_by) VALUES ($1,true,14,$2)",
			[org, person],
		);
	});
	afterAll(cleanup);
	it("ignores preference opt-outs, retains required facts, and deduplicates retries without moving the deadline", async () => {
		const first = await deliverMfaNotices();
		expect(first.failed).toBe(1);
		const initialDeadline = (
			await pool.query(
				"SELECT deadline FROM organization_mfa_window WHERE organization_id=$1 AND user_id=$2",
				[org, person],
			)
		).rows[0].deadline;
		const inbox = () =>
			pool.query(
				"SELECT message FROM notification WHERE organization_id=$1 AND user_id=$2",
				[org, person],
			);
		expect((await inbox()).rowCount).toBe(1);
		expect((await inbox()).rows[0].message).toContain("Europe/Berlin");
		expect((await inbox()).rows[0].message).toContain("Notice Company");
		const firstMessage = mail.send.mock.calls[0][0] as {
			idempotencyKey: string;
			html: string;
		};
		expect(firstMessage.html).toContain("backup code");
		mail.send.mockResolvedValue({ success: true });
		expect((await deliverMfaNotices()).sent).toBe(1);
		const secondMessage = mail.send.mock.calls[1][0] as {
			idempotencyKey: string;
		};
		expect(secondMessage.idempotencyKey).toBe(firstMessage.idempotencyKey);
		await deliverMfaNotices();
		expect(mail.send).toHaveBeenCalledTimes(2);
		expect((await inbox()).rowCount).toBe(1);
		expect(
			(
				await pool.query(
					"SELECT deadline FROM organization_mfa_window WHERE organization_id=$1 AND user_id=$2",
					[org, person],
				)
			).rows[0].deadline,
		).toEqual(initialDeadline);
	});
});
