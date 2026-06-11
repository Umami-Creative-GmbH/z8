import { randomUUID } from "node:crypto";

import type { StreamAuthResult } from "./auth.js";
import type { NotificationStreamEvent } from "./registry.js";
import { createSseHeaders, encodeSseEvent } from "./sse.js";

export interface NotifyServerDependencies {
	validate: (headers: Headers) => Promise<StreamAuthResult>;
	getUnreadCount: (userId: string, organizationId: string) => Promise<number>;
	registerClient: (client: {
		id: string;
		userId: string;
		organizationId: string;
		send: (event: NotificationStreamEvent, data: unknown) => void;
	}) => () => void;
}

export function createNotifyServerHandler(deps: NotifyServerDependencies) {
	return async function handleRequest(request: Request): Promise<Response> {
		const pathname = new URL(request.url).pathname;
		if (pathname === "/health") return Response.json({ ok: true });
		if (pathname !== "/api/notifications/stream") return new Response("Not found", { status: 404 });

		const auth = await deps.validate(request.headers);
		if (!auth.ok) return new Response(auth.message, { status: auth.status });

		const encoder = new TextEncoder();
		const id = randomUUID();
		let cleanup = () => {};
		let closed = false;

		const stream = new ReadableStream<Uint8Array>({
			async start(controller) {
				const sendFrame = (event: NotificationStreamEvent | "heartbeat", data: unknown) => {
					if (closed) return;
					controller.enqueue(encoder.encode(encodeSseEvent(event, data)));
				};
				const unregister = deps.registerClient({
					id,
					userId: auth.userId,
					organizationId: auth.organizationId,
					send: sendFrame,
				});
				const heartbeat = setInterval(() => sendFrame("heartbeat", { timestamp: Date.now() }), 30_000);
				cleanup = () => {
					if (closed) return;
					closed = true;
					clearInterval(heartbeat);
					unregister();
				};

				const count = await deps.getUnreadCount(auth.userId, auth.organizationId);
				sendFrame("count_update", { count, organizationId: auth.organizationId });
			},
			cancel() {
				cleanup();
			},
		});

		return new Response(stream, { headers: createSseHeaders() });
	};
}
