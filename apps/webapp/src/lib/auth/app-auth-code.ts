import { randomBytes } from "node:crypto";
import { and, eq, gt, lte } from "drizzle-orm";
import { appAuthCode, db } from "@/db";

const APP_AUTH_CODE_TTL_MS = 5 * 60 * 1000;

export type SupportedApp = "mobile" | "desktop";

export async function createAppAuthCode(input: {
	userId: string;
	sessionToken: string;
	app: SupportedApp;
}) {
	const code = randomBytes(16).toString("hex").toUpperCase();
	const expiresAt = new Date(Date.now() + APP_AUTH_CODE_TTL_MS);

	await db.insert(appAuthCode).values({
		userId: input.userId,
		app: input.app,
		code,
		sessionToken: input.sessionToken,
		status: "pending",
		expiresAt,
	});

	return { code, expiresAt };
}

export async function consumeAppAuthCode(input: { code: string; app: SupportedApp }) {
	const record = await db.query.appAuthCode.findFirst({
		where: and(eq(appAuthCode.code, input.code), eq(appAuthCode.app, input.app)),
	});

	if (!record || record.status !== "pending") {
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
