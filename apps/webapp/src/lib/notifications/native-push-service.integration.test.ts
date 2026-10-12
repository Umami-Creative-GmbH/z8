import { generateKeyPairSync } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { integrationAdminPool } from "@/test/integration-database";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

vi.mock("@/env", async (original) => ({
	env: {
		...(await original<typeof import("@/env")>()).env,
		FCM_PROJECT_ID: "z8-t843",
		FCM_CLIENT_EMAIL: "push@z8-t843.iam.gserviceaccount.com",
		FCM_PRIVATE_KEY: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
	},
}));

const { registerNativePushToken, sendNativePushToUser } = await import("./native-push-service");

const admin = integrationAdminPool();
const userId = "t843-push-user";
const sessions = { live: "t843-session-live", later: "t843-session-later" };

/** Device tokens FCM was asked to deliver to. */
const delivered: string[] = [];
const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
	if (String(input) === "https://oauth2.googleapis.com/token") {
		return Response.json({ access_token: "access", expires_in: 3600 });
	}
	delivered.push(JSON.parse(String(init?.body)).message.token);
	return Response.json({ name: "projects/z8-t843/messages/1" });
});

const approval = { type: "approval_request_submitted", actionUrl: "/approvals/inbox" } as const;

async function cleanup() {
	await admin.query('delete from "user" where id = $1', [userId]);
}

async function createSession(id: string, expiresIn: string) {
	await admin.query(
		`insert into session (id, token, user_id, expires_at, created_at, updated_at)
		 values ($1, $1, $2, now() + $3::interval, now(), now())`,
		[id, userId, expiresIn],
	);
}

async function boundSession(token: string): Promise<string | null> {
	const { rows } = await admin.query<{ session_id: string | null }>(
		"select session_id from push_device_token where token = $1",
		[token],
	);
	return rows[0]?.session_id ?? null;
}

beforeEach(async () => {
	await cleanup();
	await admin.query(
		'insert into "user"(id,name,email,created_at,updated_at) values ($1,$1,$2,now(),now())',
		[userId, "t843-push@example.test"],
	);
	delivered.length = 0;
	vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
});

afterAll(cleanup);

describe("native push follows the session that registered the device", () => {
	it("sends to a device whose session is live", async () => {
		await createSession(sessions.live, "1 day");
		await registerNativePushToken(
			{ userId, sessionId: sessions.live },
			{ token: "t843-device", platform: "ios" },
		);

		const result = await sendNativePushToUser(userId, approval);

		expect(result).toEqual({ sent: 1, failed: 0, expired: [] });
		expect(delivered).toEqual(["t843-device"]);
	});

	it("stops sending once the session is revoked on the server", async () => {
		await createSession(sessions.live, "1 day");
		await registerNativePushToken(
			{ userId, sessionId: sessions.live },
			{ token: "t843-device", platform: "android" },
		);

		await admin.query("delete from session where id = $1", [sessions.live]);

		expect(await boundSession("t843-device")).toBeNull();
		await expect(sendNativePushToUser(userId, approval)).resolves.toEqual({
			sent: 0,
			failed: 0,
			expired: [],
		});
		expect(delivered).toEqual([]);
	});

	it("does not send to a device whose session has expired", async () => {
		await createSession(sessions.live, "-1 minute");
		await registerNativePushToken(
			{ userId, sessionId: sessions.live },
			{ token: "t843-device", platform: "ios" },
		);

		await sendNativePushToUser(userId, approval);

		expect(delivered).toEqual([]);
	});

	it("binds the token again when the device registers after the next sign-in", async () => {
		await createSession(sessions.live, "1 day");
		await registerNativePushToken(
			{ userId, sessionId: sessions.live },
			{ token: "t843-device", platform: "ios" },
		);
		await admin.query("delete from session where id = $1", [sessions.live]);

		await createSession(sessions.later, "1 day");
		await registerNativePushToken(
			{ userId, sessionId: sessions.later },
			{ token: "t843-device", platform: "ios" },
		);
		await sendNativePushToUser(userId, approval);

		expect(await boundSession("t843-device")).toBe(sessions.later);
		expect(delivered).toEqual(["t843-device"]);
	});
});
