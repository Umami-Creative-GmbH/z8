import { handler, startFanout } from "./runtime.js";

declare const Bun: {
	serve: (options: { port: number; fetch: (request: Request) => Response | Promise<Response> }) => unknown;
};

const port = Number(process.env.NOTIFY_SERVER_PORT ?? 3002);
await startFanout();
Bun.serve({ port, fetch: handler });
console.log(`notify-server listening on :${port}`);
