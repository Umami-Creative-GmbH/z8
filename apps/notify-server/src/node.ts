import { createServer } from "node:http";

import { handler, startFanout } from "./runtime.js";

function createHeaders(headers: Record<string, string | string[] | undefined>): Headers {
	const result = new Headers();
	for (const [name, value] of Object.entries(headers)) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			for (const item of value) result.append(name, item);
			continue;
		}
		result.set(name, value);
	}
	return result;
}

const port = Number(process.env.NOTIFY_SERVER_PORT ?? 3002);
await startFanout();

createServer(async (incoming, outgoing) => {
	try {
		const request = new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
			method: incoming.method,
			headers: createHeaders(incoming.headers),
		});
		const response = await handler(request);
		outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
		if (response.body) {
			for await (const chunk of response.body) {
				outgoing.write(chunk);
			}
		}
		outgoing.end();
	} catch {
		outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
		outgoing.end("Internal server error");
	}
}).listen(port, () => {
	console.log(`notify-server node fallback listening on :${port}`);
});
