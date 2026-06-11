import { and, eq } from "drizzle-orm";

import type { StreamSession } from "./auth.js";
import { validateStreamRequest } from "./auth.js";
import { ClientRegistry } from "./registry.js";
import { startRedisFanout } from "./redis-fanout.js";
import { createNotifyServerHandler, type NotifyServerDependencies } from "./server.js";

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

export interface NotifyRuntimeDependencies extends Pick<NotifyServerDependencies, "validate" | "getUnreadCount"> {
	createRedisSubscriber: () => Parameters<typeof startRedisFanout>[0]["subscriber"];
	startRedisFanout: typeof startRedisFanout;
}

export function createNotifyRuntime(deps: NotifyRuntimeDependencies) {
	const registry = new ClientRegistry();
	let fanoutPromise: Promise<() => Promise<void>> | null = null;
	let fanoutAvailable = false;
	let fanoutTerminal = false;

	const markFanoutUnavailable = () => {
		fanoutAvailable = false;
		registry.closeAll();
	};

	const markFanoutAvailable = () => {
		fanoutAvailable = true;
		fanoutTerminal = false;
	};

	const markFanoutTerminal = () => {
		fanoutTerminal = true;
		fanoutPromise = null;
	};

	const startFanout = async () => {
		if (!fanoutPromise || fanoutTerminal) {
			fanoutAvailable = false;
			fanoutTerminal = false;
			fanoutPromise = deps
				.startRedisFanout({
					subscriber: deps.createRedisSubscriber(),
					fanout: (userId, event, data) => registry.fanout(userId, event, data),
					onUnavailable: markFanoutUnavailable,
					onAvailable: markFanoutAvailable,
					onTerminal: markFanoutTerminal,
				})
				.catch((error: unknown) => {
					markFanoutUnavailable();
					markFanoutTerminal();
					throw error;
				});
		}

		const cleanup = await fanoutPromise;
		if (!fanoutAvailable) throw new Error("Notification stream unavailable");

		return cleanup;
	};

	return {
		handler: createNotifyServerHandler({
			validate: deps.validate,
			ensureFanout: async () => {
				await startFanout();
			},
			getUnreadCount: deps.getUnreadCount,
			registerClient: (client) => {
				registry.add(client);
				return () => registry.remove(client.id);
			},
		}),
		startFanout,
	};
}

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

const eqColumn = eq as (left: unknown, right: unknown) => unknown;
const andConditions = and as (...conditions: unknown[]) => unknown;

let defaultRuntimePromise: Promise<ReturnType<typeof createNotifyRuntime>> | null = null;

async function getDefaultRuntime(): Promise<ReturnType<typeof createNotifyRuntime>> {
	defaultRuntimePromise ??= loadWebappModules().then(({ db, employee, auth, getUnreadCount, createRedisSubscriber }) =>
		createNotifyRuntime({
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
			createRedisSubscriber,
			startRedisFanout,
		}),
	);
	return defaultRuntimePromise;
}

export async function handler(request: Request): Promise<Response> {
	return (await getDefaultRuntime()).handler(request);
}

export async function startFanout(): Promise<() => Promise<void>> {
	return (await getDefaultRuntime()).startFanout();
}
