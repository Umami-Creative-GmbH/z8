import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { appAuthCode, db } from "@/db";

const APP_AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export type SupportedApp = "mobile" | "desktop";

export async function createAppAuthCode(input: {
	userId: string;
	sessionToken: string;
	app: SupportedApp;
	codeChallenge: string;
}) {
	const code = randomBytes(16).toString("hex").toUpperCase();
	const expiresAt = new Date(Date.now() + APP_AUTH_CODE_TTL_MS);

	await db.insert(appAuthCode).values({
		userId: input.userId,
		app: input.app,
		code,
		codeChallenge: input.codeChallenge,
		sessionToken: input.sessionToken,
		status: "pending",
		expiresAt,
	});

	return { code, expiresAt };
}

function challengeForVerifier(verifier: string): string {
	return createHash("sha256").update(verifier).digest("base64url");
}

function isMatchingChallenge(verifier: string, challenge: string): boolean {
	const actual = Buffer.from(challengeForVerifier(verifier));
	const expected = Buffer.from(challenge);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function consumeAppAuthCode(input: {
	code: string;
	app: SupportedApp;
	verifier: string;
}) {
	const record = await db.query.appAuthCode.findFirst({
		where: and(eq(appAuthCode.code, input.code), eq(appAuthCode.app, input.app)),
	});

	if (
		!record ||
		record.status !== "pending" ||
		!record.codeChallenge ||
		!isMatchingChallenge(input.verifier, record.codeChallenge)
	) {
		return { status: "invalid_code" } as const;
	}

	const updated = await db
		.update(appAuthCode)
		.set({ status: "used", usedAt: new Date() })
		.where(
			and(
				eq(appAuthCode.id, record.id),
				eq(appAuthCode.status, "pending"),
				gt(appAuthCode.expiresAt, new Date()),
			),
		)
		.returning({ id: appAuthCode.id });

	if (updated.length === 0) {
		await db
			.update(appAuthCode)
			.set({ status: "expired" })
			.where(
				and(
					eq(appAuthCode.id, record.id),
					eq(appAuthCode.status, "pending"),
					lte(appAuthCode.expiresAt, new Date()),
				),
			)
			.returning({ id: appAuthCode.id });

		return { status: "invalid_code" } as const;
	}

	return { sessionToken: record.sessionToken, status: "success" } as const;
}
