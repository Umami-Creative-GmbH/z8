import type { Redis } from "ioredis";

import type { NotificationStreamEvent } from "./registry.js";

export type FanoutFunction = (userId: string, event: NotificationStreamEvent, data: unknown) => number;

export function handleRedisMessage(channel: string, message: string, fanout: FanoutFunction): number {
	const prefix = "notifications:";
	if (!channel.startsWith(prefix)) return 0;

	const userId = channel.slice(prefix.length);
	if (!userId) return 0;

	try {
		const parsed = JSON.parse(message) as { event?: unknown; data?: unknown };
		if (parsed.event !== "new_notification" && parsed.event !== "count_update") return 0;

		return fanout(userId, parsed.event, parsed.data);
	} catch {
		return 0;
	}
}

export async function startRedisFanout(params: { subscriber: Redis; fanout: FanoutFunction }): Promise<() => Promise<void>> {
	const onMessage = (channel: string, message: string) => handleRedisMessage(channel, message, params.fanout);
	params.subscriber.on("message", onMessage);
	await params.subscriber.psubscribe("notifications:*");

	return async () => {
		params.subscriber.off("message", onMessage);
		await params.subscriber.punsubscribe("notifications:*");
		params.subscriber.disconnect();
	};
}
