import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { user } from "@/db/auth-schema";
import { ensureRedisReady, redis } from "@/lib/redis";
import { createSetupBootstrap } from "./bootstrap";

// Authorization must use the authoritative database, never a cached/fail-open result.
export async function hasPlatformAdmin(): Promise<boolean> {
	const [admin] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, "admin"))
		.limit(1);
	return Boolean(admin);
}

export const setupBootstrap = createSetupBootstrap({
	redis,
	ready: async () =>
		(await ensureRedisReady()) &&
		(await redis.ping()) === "PONG" &&
		redis.status === "ready",
	isConfigured: hasPlatformAdmin,
});
