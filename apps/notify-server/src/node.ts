import { createServer } from "node:http";
import { pathToFileURL } from "node:url";

import { handler, startFanout } from "./runtime.js";

type NodeResponseLike = {
	destroyed: boolean;
	writeHead: (statusCode: number, headers: Record<string, string>) => unknown;
	write: (chunk: Uint8Array) => boolean;
	end: (chunk?: string) => unknown;
	on: (event: "close" | "drain" | "error", listener: (...args: unknown[]) => void) => unknown;
	once: (event: "close" | "drain" | "error", listener: (...args: unknown[]) => void) => unknown;
	removeListener: (event: "close" | "drain" | "error", listener: (...args: unknown[]) => void) => unknown;
};

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

function waitForDrain(outgoing: NodeResponseLike): Promise<void> {
	return new Promise((resolve) => {
		const done = () => {
			outgoing.removeListener("drain", done);
			outgoing.removeListener("close", done);
			outgoing.removeListener("error", done);
			resolve();
		};
		outgoing.once("drain", done);
		outgoing.once("close", done);
		outgoing.once("error", done);
	});
}

export async function writeWebResponseToNodeResponse(response: Response, outgoing: NodeResponseLike): Promise<void> {
	outgoing.writeHead(response.status, Object.fromEntries(response.headers.entries()));
	if (!response.body) {
		if (!outgoing.destroyed) outgoing.end();
		return;
	}

	const reader = response.body.getReader();
	let closed = false;
	const cancel = () => {
		if (closed) return;
		closed = true;
		void reader.cancel().catch(() => {});
	};
	outgoing.on("close", cancel);
	outgoing.on("error", cancel);

	try {
		while (!closed && !outgoing.destroyed) {
			const result = await reader.read();
			if (result.done) break;
			if (closed || outgoing.destroyed) break;
			if (!outgoing.write(result.value)) {
				await waitForDrain(outgoing);
			}
		}
	} finally {
		outgoing.removeListener("close", cancel);
		outgoing.removeListener("error", cancel);
		if (closed || outgoing.destroyed) {
			await reader.cancel().catch(() => {});
		}
		if (!closed && !outgoing.destroyed) outgoing.end();
	}
}

export async function startNodeServer(): Promise<void> {
	const port = Number(process.env.NOTIFY_SERVER_PORT ?? 3002);
	await startFanout();

	createServer(async (incoming, outgoing) => {
		try {
			const request = new Request(`http://${incoming.headers.host ?? "localhost"}${incoming.url ?? "/"}`, {
				method: incoming.method,
				headers: createHeaders(incoming.headers),
			});
			const response = await handler(request);
			await writeWebResponseToNodeResponse(response, outgoing);
		} catch {
			if (!outgoing.destroyed) {
				outgoing.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
				outgoing.end("Internal server error");
			}
		}
	}).listen(port, () => {
		console.log(`notify-server node fallback listening on :${port}`);
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await startNodeServer();
}
