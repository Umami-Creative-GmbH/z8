import { afterEach, describe, expect, it, vi } from "vitest";
import type { KioskFrozenCommand, KioskFrozenSubmission } from "./frozen-command";
import { createKioskOfflineQueue } from "./offline-queue";
import { memoryKioskQueueStorage } from "./offline-queue.test.fixture";

/**
 * #1292: the offline kiosk's durable queue of frozen kiosk commands, sent in
 * order with the same bytes on every attempt; an unknown outcome is looked up
 * before anything is sent again.
 */
const kioskId = "22222222-2222-4222-8222-222222222222";
const anna = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Anna Berger" };
const ben = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Ben Özdemir" };

let operation = 0;
function submission(
	employee: { id: string },
	occurredAt = "2026-10-16T08:00:00Z",
): KioskFrozenSubmission {
	operation += 1;
	const command: KioskFrozenCommand = {
		version: 1,
		operationId: `00000000-0000-4000-8000-${String(operation).padStart(12, "0")}`,
		kioskId,
		employeeId: employee.id,
		action: "clock_in",
		occurredAt,
		timeSource: "server_anchor",
		timezone: "Europe/Berlin",
		workLocationType: "office",
	};
	return {
		command,
		pin: { v: 1, kid: "k1", epk: "ZXBr", iv: "aXY", ct: "Y3Q" },
		contact: { serverTime: "2026-10-16T07:45:00Z", proof: "cHJvb2Y" },
	};
}

type Sent = { method: string; url: string; token: string | null; body: string | null };
type Answer = (sent: Sent) => Response | Promise<Response>;

/** A server that answers each request with the next scripted answer for its kind. */
function server(answers: { submit?: Answer[]; lookup?: Answer[] }) {
	const sent: Sent[] = [];
	const submit = [...(answers.submit ?? [])];
	const lookup = [...(answers.lookup ?? [])];
	const fetch = vi.fn(async (url: string, init?: RequestInit) => {
		const request: Sent = {
			method: init?.method ?? "GET",
			url,
			token: new Headers(init?.headers).get("x-kiosk-token"),
			body: typeof init?.body === "string" ? init.body : null,
		};
		sent.push(request);
		const next = request.method === "POST" ? submit.shift() : lookup.shift();
		if (!next) throw new Error(`no answer scripted for ${request.method} ${url}`);
		return next(request);
	});
	return { sent, fetch: fetch as unknown as typeof globalThis.fetch };
}

const executed: Answer = (sent) => {
	const { command } = JSON.parse(sent.body ?? "{}") as KioskFrozenSubmission;
	return Response.json(
		{ outcome: "executed", operationId: command.operationId, action: command.action },
		{ status: 201 },
	);
};
const unknown: Answer = () => Response.json({ outcome: "unknown" }, { status: 500 });
const refused =
	(code: string, status = 403): Answer =>
	(sent) =>
		Response.json(
			{ outcome: "refused", operationId: JSON.parse(sent.body ?? "{}").command.operationId, code },
			{ status },
		);
const networkDown: Answer = () => {
	throw new TypeError("Failed to fetch");
};
const lookupSays =
	(outcome: string): Answer =>
	() =>
		Response.json({ outcome, operationId: "x", action: "clock_in" });

function queueWith(fetch: typeof globalThis.fetch) {
	const storage = memoryKioskQueueStorage();
	return { storage, queue: createKioskOfflineQueue({ storage: () => storage, fetch }) };
}

async function enqueue(
	queue: ReturnType<typeof createKioskOfflineQueue>,
	employee: { id: string; name: string },
	occurredAt?: string,
) {
	const frozen = submission(employee, occurredAt);
	await queue.enqueue({ submission: frozen, employeeName: employee.name, action: "clock_in" });
	return frozen;
}

describe("offline kiosk queue (#1292)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("keeps queued commands in order, with their frozen bytes and no plaintext PIN", async () => {
		const { queue } = queueWith(server({}).fetch);
		const first = await enqueue(queue, anna, "2026-10-16T08:00:00Z");
		const second = await enqueue(queue, ben, "2026-10-16T08:01:00Z");

		const commands = await queue.commands();

		expect(commands.map((record) => record.operationId)).toEqual([
			first.command.operationId,
			second.command.operationId,
		]);
		expect(commands[0]?.body).toBe(JSON.stringify(first));
		expect(commands[0]).toMatchObject({
			employeeId: anna.id,
			employeeName: anna.name,
			action: "clock_in",
			occurredAt: "2026-10-16T08:00:00Z",
		});
	});

	it("sends the queue in order with the kiosk's token and drops what committed", async () => {
		const { sent, fetch } = server({ submit: [executed, executed] });
		const { queue } = queueWith(fetch);
		const first = await enqueue(queue, anna);
		const second = await enqueue(queue, anna, "2026-10-16T09:00:00Z");

		const report = await queue.send("z8k_token");

		expect(sent.map((request) => [request.method, request.url, request.token])).toEqual([
			["POST", "/api/kiosk/commands", "z8k_token"],
			["POST", "/api/kiosk/commands", "z8k_token"],
		]);
		expect(sent.map((request) => request.body)).toEqual([
			JSON.stringify(first),
			JSON.stringify(second),
		]);
		expect(report).toMatchObject({ refused: [], waiting: 0, unreachable: false });
		expect(await queue.commands()).toEqual([]);
	});

	it("looks an unknown outcome up first and resends the same bytes only when it did not commit", async () => {
		const { sent, fetch } = server({
			submit: [unknown, executed],
			lookup: [lookupSays("not_committed")],
		});
		const { queue } = queueWith(fetch);
		const frozen = await enqueue(queue, anna);

		expect(await queue.send("z8k_token")).toMatchObject({ waiting: 1 });
		expect(await queue.send("z8k_token")).toMatchObject({ waiting: 0 });

		expect(sent.map((request) => `${request.method} ${request.url}`)).toEqual([
			"POST /api/kiosk/commands",
			`GET /api/kiosk/commands/${frozen.command.operationId}`,
			"POST /api/kiosk/commands",
		]);
		expect(sent[2]?.body).toBe(sent[0]?.body);
	});

	it("recovers a lost response by lookup without sending the command again", async () => {
		const { sent, fetch } = server({ submit: [networkDown], lookup: [lookupSays("committed")] });
		const { queue, storage } = queueWith(fetch);
		await enqueue(queue, anna);

		expect(await queue.send("z8k_token")).toMatchObject({ unreachable: true, waiting: 1 });
		// Marked before it was sent: the outcome is unknown, not "never sent".
		expect((await storage.list())[0]?.uncertain).toBe(true);
		expect(await queue.send("z8k_token")).toMatchObject({ unreachable: false, waiting: 0 });

		expect(sent.filter((request) => request.method === "POST")).toHaveLength(1);
		expect(await queue.commands()).toEqual([]);
	});

	it("drops a refused command, lists it as a notice and never sends it again", async () => {
		const { sent, fetch } = server({ submit: [refused("wrong_pin"), executed] });
		const { queue } = queueWith(fetch);
		const wrong = await enqueue(queue, anna, "2026-10-16T08:00:00Z");
		await enqueue(queue, ben);

		const report = await queue.send("z8k_token");
		await queue.send("z8k_token");

		expect(report.refused).toEqual([
			{
				operationId: wrong.command.operationId,
				employeeName: anna.name,
				action: "clock_in",
				occurredAt: "2026-10-16T08:00:00Z",
				code: "wrong_pin",
			},
		]);
		expect(sent).toHaveLength(2);
		expect(await queue.commands()).toEqual([]);
	});

	it("holds an employee's later commands behind one with an unknown outcome, not other employees'", async () => {
		const { sent, fetch } = server({ submit: [unknown, executed] });
		const { queue } = queueWith(fetch);
		await enqueue(queue, anna, "2026-10-16T08:00:00Z");
		await enqueue(queue, anna, "2026-10-16T08:05:00Z");
		const bens = await enqueue(queue, ben, "2026-10-16T08:10:00Z");

		const report = await queue.send("z8k_token");

		expect(sent).toHaveLength(2);
		expect(sent[1]?.body).toBe(JSON.stringify(bens));
		expect(report.waiting).toBe(2);
	});

	it("stops at the first transport failure and keeps everything", async () => {
		const { sent, fetch } = server({ submit: [networkDown] });
		const { queue } = queueWith(fetch);
		await enqueue(queue, anna);
		await enqueue(queue, ben);

		expect(await queue.send("z8k_token")).toMatchObject({ unreachable: true, waiting: 2 });
		expect(sent).toHaveLength(1);
	});

	it("reports a token Z8 never knew and keeps the commands", async () => {
		const { fetch } = server({
			submit: [() => Response.json({ code: "kiosk_unknown" }, { status: 401 })],
		});
		const { queue } = queueWith(fetch);
		await enqueue(queue, anna);

		expect(await queue.send("z8k_token")).toMatchObject({ kioskUnknown: true, waiting: 1 });
	});

	it("sends nothing while the browser reports itself offline", async () => {
		const { sent, fetch } = server({});
		const { queue } = queueWith(fetch);
		await enqueue(queue, anna);
		vi.stubGlobal("navigator", { onLine: false });

		expect(await queue.send("z8k_token")).toMatchObject({ unreachable: true, waiting: 1 });
		expect(sent).toEqual([]);
	});

	it("sends the queue once before the kiosk forgets its token, so a rotated kiosk's commands are refused and listed", async () => {
		const { fetch } = server({ submit: [refused("kiosk_rotated"), unknown] });
		const { queue } = queueWith(fetch);
		await enqueue(queue, anna);
		await enqueue(queue, ben);

		const result = await queue.sendBeforeForgetting("z8k_old-token");

		expect(result.sent).toBe(true);
		expect(result.report.refused.map((notice) => notice.code)).toEqual(["kiosk_rotated"]);
		expect(await queue.commands()).toEqual([]);
	});

	it("keeps the queue and the token when it could not be sent before forgetting", async () => {
		const { fetch } = server({ submit: [networkDown] });
		const { queue } = queueWith(fetch);
		await enqueue(queue, anna);

		expect((await queue.sendBeforeForgetting("z8k_old-token")).sent).toBe(false);
		expect(await queue.commands()).toHaveLength(1);
	});

	it("answers an empty queue without any request", async () => {
		const { sent, fetch } = server({});
		const { queue } = queueWith(fetch);

		expect(await queue.sendBeforeForgetting("z8k_token")).toMatchObject({ sent: true });
		expect(sent).toEqual([]);
	});
});
