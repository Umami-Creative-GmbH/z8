import type { Redis } from "ioredis";

import type { NotificationStreamEvent } from "./registry.js";

export type FanoutFunction = (userId: string, event: NotificationStreamEvent, data: unknown) => number;

export function handleRedisMessage(channel: string, message: string, fanout: FanoutFunction): number {
	const [prefix, userId, extra] = channel.split(":");
	if (prefix !== "notifications" || !userId || extra !== undefined) return 0;

	try {
		const parsed = JSON.parse(message) as { event?: unknown; data?: unknown };
		if (parsed.event !== "new_notification" && parsed.event !== "count_update") return 0;

		return fanout(userId, parsed.event, parsed.data);
	} catch {
		return 0;
	}
}

export async function startRedisFanout(params: {
	subscriber: Redis;
	fanout: FanoutFunction;
	onUnavailable?: () => void;
}): Promise<() => Promise<void>> {
	const onMessage = (_pattern: string, channel: string, message: string) => handleRedisMessage(channel, message, params.fanout);
	let unavailableNotified = false;
	const onUnavailable = () => {
		if (unavailableNotified) return;
		unavailableNotified = true;
		params.onUnavailable?.();
	};
	params.subscriber.on("pmessage", onMessage);
	params.subscriber.on("end", onUnavailable);
	params.subscriber.on("close", onUnavailable);
	await params.subscriber.psubscribe("notifications:*");

	return async () => {
		params.subscriber.off("pmessage", onMessage);
		params.subscriber.off("end", onUnavailable);
		params.subscriber.off("close", onUnavailable);
		await params.subscriber.punsubscribe("notifications:*");
		params.subscriber.disconnect();
	};
}
