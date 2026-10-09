/**
 * A scripted stand-in for the Lexware Office Public API (#904): routes
 * requests by method and path to recorded replies (see `lexware-public-api.ts`)
 * and records every request, so contract tests can assert both what the
 * connector sends and how it reads the answers. Pair it with `virtualTime()` so
 * rate-limit pacing and back-off run instantly.
 *
 * Test-only: never imported by production code.
 */

export interface RecordedLexwareRequest {
	method: string;
	url: URL;
	/** Path without the query, e.g. `/v1/contacts`. */
	path: string;
	headers: Record<string, string>;
	/** The parsed JSON body, if any. */
	body: unknown;
	/** The virtual time the request was sent at (ms). */
	at: number;
}

export type ScriptedReply =
	| { status: number; body?: unknown; headers?: Record<string, string>; rawBody?: string }
	/** The transport fails (connection refused, timeout) instead of answering. */
	| { error: Error };

interface Route {
	method: string;
	path: string | RegExp;
	when?: (request: RecordedLexwareRequest) => boolean;
	replies: ScriptedReply[];
}

export interface VirtualTime {
	now(): number;
	sleep(ms: number): Promise<void>;
	sleeps(): number[];
}

/**
 * A clock that only moves when the code under test sleeps. Sleepers wake in
 * order of their wake-up time, once all pending microtasks have run, so
 * concurrent callers see one consistent timeline.
 */
export function virtualTime(start = 1_000_000): VirtualTime {
	let current = start;
	const slept: number[] = [];
	const timers: { wake: number; resolve: () => void }[] = [];
	let scheduled = false;

	const schedule = () => {
		if (scheduled) return;
		scheduled = true;
		setImmediate(() => {
			scheduled = false;
			timers.sort((left, right) => left.wake - right.wake);
			const next = timers.shift();
			if (!next) return;
			current = Math.max(current, next.wake);
			next.resolve();
			if (timers.length > 0) schedule();
		});
	};

	return {
		now: () => current,
		sleep: (ms) => {
			slept.push(ms);
			return new Promise<void>((resolve) => {
				timers.push({ wake: current + ms, resolve });
				schedule();
			});
		},
		sleeps: () => [...slept],
	};
}

export function scriptedLexware(time: VirtualTime = virtualTime()) {
	const routes: Route[] = [];
	const requests: RecordedLexwareRequest[] = [];

	const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
		const url = new URL(input);
		const headers: Record<string, string> = {};
		new Headers(init.headers).forEach((value, key) => {
			headers[key] = value;
		});
		const request: RecordedLexwareRequest = {
			method: init.method ?? "GET",
			url,
			path: url.pathname,
			headers,
			body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
			at: time.now(),
		};
		requests.push(request);
		const route = routes.find(
			(candidate) =>
				candidate.method === request.method &&
				(typeof candidate.path === "string"
					? candidate.path === request.path
					: candidate.path.test(request.path)) &&
				(candidate.when?.(request) ?? true),
		);
		if (!route)
			throw new Error(`No scripted reply for ${request.method} ${url.pathname}${url.search}`);
		const reply =
			route.replies.length > 1 ? (route.replies.shift() as ScriptedReply) : route.replies[0];
		if ("error" in reply) throw reply.error;
		return new Response(
			reply.rawBody ?? (reply.body === undefined ? null : JSON.stringify(reply.body)),
			{
				status: reply.status,
				headers: { "content-type": "application/json", ...reply.headers },
			},
		);
	};

	return {
		fetch,
		time,
		/**
		 * Answers `method path` with `replies` in order; the last reply repeats.
		 * Earlier registrations win, so register specific `when` routes first.
		 */
		on(
			method: string,
			path: string | RegExp,
			...replies: [ScriptedReply, ...ScriptedReply[]]
		): void {
			routes.push({ method, path, replies });
		},
		onWhen(
			method: string,
			path: string | RegExp,
			when: (request: RecordedLexwareRequest) => boolean,
			...replies: [ScriptedReply, ...ScriptedReply[]]
		): void {
			routes.push({ method, path, when, replies });
		},
		requests: () => [...requests],
	};
}

export type ScriptedLexware = ReturnType<typeof scriptedLexware>;
