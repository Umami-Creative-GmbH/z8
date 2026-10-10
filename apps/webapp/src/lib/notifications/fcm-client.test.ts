import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createFcmSender, readFcmCredentials } from "./fcm-client";
import type { NativePushMessage } from "./native-push-message";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const credentials = {
	projectId: "z8-test",
	clientEmail: "push@z8-test.iam.gserviceaccount.com",
	privateKey: privateKeyPem,
};

const message: NativePushMessage = {
	title: "You have a request to review",
	body: "Open Z8 to see the details.",
	data: { type: "approval_request_submitted", path: "/approvals/inbox", organizationId: "org-1" },
};

function json(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

function fcmError(status: number, code: string, errorCode?: string, violatedField?: string) {
	return json(status, {
		error: {
			code: status,
			status: code,
			message: "error",
			details: [
				...(errorCode
					? [{ "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode }]
					: []),
				...(violatedField
					? [
							{
								"@type": "type.googleapis.com/google.rpc.BadRequest",
								fieldViolations: [{ field: violatedField, description: "Invalid value" }],
							},
						]
					: []),
			],
		},
	});
}

/** A fake Google: issues an access token, then answers sends with `sendResponses`. */
function fakeGoogle(...sendResponses: Response[]) {
	const fetch = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
		const url = String(input);
		if (url === "https://oauth2.googleapis.com/token") {
			return json(200, { access_token: "access-1", expires_in: 3600, token_type: "Bearer" });
		}
		const next = sendResponses.shift();
		if (!next) throw new Error(`unexpected request ${url}`);
		return next;
	});
	return fetch;
}

describe("readFcmCredentials", () => {
	it("is off unless project, client email and private key are all set", () => {
		expect(readFcmCredentials({})).toBeNull();
		expect(
			readFcmCredentials({
				FCM_PROJECT_ID: "p",
				FCM_CLIENT_EMAIL: "e",
				FCM_PRIVATE_KEY: undefined,
			}),
		).toBeNull();
	});

	it("accepts a private key with escaped line breaks, as env files store it", () => {
		const escaped = privateKeyPem.replace(/\n/g, "\\n");
		expect(
			readFcmCredentials({
				FCM_PROJECT_ID: "z8-test",
				FCM_CLIENT_EMAIL: credentials.clientEmail,
				FCM_PRIVATE_KEY: escaped,
			}),
		).toEqual(credentials);
	});
});

describe("createFcmSender", () => {
	it("signs a service-account assertion and sends the message to the device token", async () => {
		const fetch = fakeGoogle(json(200, { name: "projects/z8-test/messages/1" }));
		const sender = createFcmSender(credentials, { fetch, now: () => 1_800_000_000_000 });

		await expect(sender.send("device-token", message)).resolves.toEqual({ kind: "sent" });

		const [tokenUrl, tokenInit] = fetch.mock.calls[0];
		expect(tokenUrl).toBe("https://oauth2.googleapis.com/token");
		const form = new URLSearchParams(String(tokenInit?.body));
		expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
		const [header, claims, signature] = String(form.get("assertion")).split(".");
		expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
			alg: "RS256",
			typ: "JWT",
		});
		expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toEqual({
			iss: credentials.clientEmail,
			scope: "https://www.googleapis.com/auth/firebase.messaging",
			aud: "https://oauth2.googleapis.com/token",
			iat: 1_800_000_000,
			exp: 1_800_003_600,
		});
		expect(
			verify(
				"RSA-SHA256",
				Buffer.from(`${header}.${claims}`),
				createPublicKey(privateKeyPem),
				Buffer.from(signature, "base64url"),
			),
		).toBe(true);

		const [sendUrl, sendInit] = fetch.mock.calls[1];
		expect(sendUrl).toBe("https://fcm.googleapis.com/v1/projects/z8-test/messages:send");
		expect(new Headers(sendInit?.headers).get("authorization")).toBe("Bearer access-1");
		expect(JSON.parse(String(sendInit?.body)).message.token).toBe("device-token");
	});

	it("reuses the access token until shortly before it expires", async () => {
		let now = 1_800_000_000_000;
		const fetch = fakeGoogle(json(200, {}), json(200, {}), json(200, {}));
		const sender = createFcmSender(credentials, { fetch, now: () => now });

		await sender.send("a", message);
		now += 30 * 60 * 1000;
		await sender.send("b", message);
		expect(fetch.mock.calls.filter(([url]) => String(url).includes("oauth2"))).toHaveLength(1);

		now += 29 * 60 * 1000;
		await sender.send("c", message);
		expect(fetch.mock.calls.filter(([url]) => String(url).includes("oauth2"))).toHaveLength(2);
	});

	it.each([
		["an unregistered token", fcmError(404, "NOT_FOUND", "UNREGISTERED")],
		["a malformed token", fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "message.token")],
		[
			"a token of another Firebase project",
			fcmError(403, "PERMISSION_DENIED", "SENDER_ID_MISMATCH"),
		],
	])("reports %s as invalid", async (_case, response) => {
		const sender = createFcmSender(credentials, { fetch: fakeGoogle(response) });

		await expect(sender.send("dead", message)).resolves.toEqual({ kind: "invalid_token" });
	});

	it.each([
		["names no field", fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT")],
		[
			"names a message field",
			fcmError(400, "INVALID_ARGUMENT", "INVALID_ARGUMENT", "message.data.path"),
		],
	])("keeps the token when an INVALID_ARGUMENT error %s", async (_case, response) => {
		const sender = createFcmSender(credentials, { fetch: fakeGoogle(response) });

		await expect(sender.send("t", message)).resolves.toEqual({
			kind: "failed",
			status: 400,
			error: "INVALID_ARGUMENT",
		});
	});

	it("reports quota and server errors as failures that keep the token", async () => {
		const sender = createFcmSender(credentials, {
			fetch: fakeGoogle(fcmError(429, "RESOURCE_EXHAUSTED", "QUOTA_EXCEEDED"), json(503, {})),
		});

		await expect(sender.send("t", message)).resolves.toMatchObject({ kind: "failed", status: 429 });
		await expect(sender.send("t", message)).resolves.toMatchObject({ kind: "failed", status: 503 });
	});

	it("reports a refused access token as a failure", async () => {
		const fetch = vi.fn(async () => json(401, { error: "invalid_grant" }));
		const sender = createFcmSender(credentials, { fetch });

		await expect(sender.send("t", message)).resolves.toMatchObject({ kind: "failed", status: 401 });
	});
});
