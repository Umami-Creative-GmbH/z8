import { and, eq } from "drizzle-orm";

import type { StreamSession } from "./auth.js";
import { validateStreamRequest } from "./auth.js";
import { ClientRegistry } from "./registry.js";
import { startRedisFanout } from "./redis-fanout.js";
import { createNotifyServerHandler } from "./server.js";

type WebappModules = {
	db: {
		select: (selection: unknown) => {
			from: (table: unknown) => {
				where: (condition: unknown) => { limit: (count: number) => Promise<Array<{ organizationId: string }>> };
			};
		};
	};
	employee: { organizationId: unknown; userId: unknown; isActive: unknown };
	auth: { api: { getSession: (params: { headers: Headers }) => Promise<StreamSession | null> } };
	getUnreadCount: (userId: string, organizationId: string) => Promise<number>;
	createRedisSubscriber: () => Parameters<typeof startRedisFanout>[0]["subscriber"];
};

async function loadWebappModules(): Promise<WebappModules> {
	const importModule = (specifier: string) => import(specifier) as Promise<Record<string, unknown>>;
	const [dbModule, schemaModule, authModule, notificationModule, redisModule] = await Promise.all([
		importModule("@/db/index.js"),
		importModule("@/db/schema/index.js"),
		importModule("@/lib/auth.js"),
		importModule("@/lib/notifications/notification-service.js"),
		importModule("@/lib/redis.js"),
	]);

	return {
		db: dbModule.db as WebappModules["db"],
		employee: schemaModule.employee as WebappModules["employee"],
		auth: authModule.auth as WebappModules["auth"],
		getUnreadCount: notificationModule.getUnreadCount as WebappModules["getUnreadCount"],
		createRedisSubscriber: redisModule.createRedisSubscriber as WebappModules["createRedisSubscriber"],
	};
}

const { db, employee, auth, getUnreadCount, createRedisSubscriber } = await loadWebappModules();
const eqColumn = eq as (left: unknown, right: unknown) => unknown;
const andConditions = and as (...conditions: unknown[]) => unknown;

const registry = new ClientRegistry();

export const handler = createNotifyServerHandler({
	validate: (headers) =>
		validateStreamRequest(headers, {
			getSession: (requestHeaders) => auth.api.getSession({ headers: requestHeaders }),
			findActiveEmployee: async ({ userId, organizationId }) => {
				const [record] = await db
					.select({ organizationId: employee.organizationId })
					.from(employee)
					.where(
						andConditions(
							eqColumn(employee.userId, userId),
							eqColumn(employee.organizationId, organizationId),
							eqColumn(employee.isActive, true),
						),
					)
					.limit(1);

				return record ?? null;
			},
		}),
	getUnreadCount,
	registerClient: (client) => {
		registry.add(client);
		return () => registry.remove(client.id);
	},
});

export async function startFanout(): Promise<() => Promise<void>> {
	return startRedisFanout({
		subscriber: createRedisSubscriber(),
		fanout: (userId, event, data) => registry.fanout(userId, event, data),
	});
}
