import { afterEach, describe, expect, it, vi } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { KioskFrozenCommand, KioskFrozenSubmission } from "./frozen-command";
import {
	createKioskOfflineQueue,
	frozenCommandOf,
	frozenCommandsOf,
	readFrozenCommand,
} from "./offline-queue";
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

/** The kiosk's offline clock and the device clock, as the tests set them. */
const clocks = { kiosk: "2026-10-16T08:30:00Z", device: "2026-10-16T08:30:00Z" };

function queueWith(fetch: typeof globalThis.fetch) {
	const storage = memoryKioskQueueStorage();
	return {
		storage,
		queue: createKioskOfflineQueue({
			storage: () => storage,
			fetch,
			now: () => clocks.kiosk,
			device: { nowInstant: () => parseInstant(clocks.device) },
		}),
	};
}

async function enqueue(
	queue: ReturnType<typeof createKioskOfflineQueue>,
	employee: { id: string; name: string },
	occurredAt?: string,
	options: { token?: string; kioskId?: string } = {},
) {
	const frozen = submission(employee, occurredAt);
	if (options.kioskId) frozen.command = { ...frozen.command, kioskId: options.kioskId };
	await queue.enqueue({
		submission: frozen,
		employeeName: employee.name,
		action: "clock_in",
		...(options.token ? { token: options.token } : {}),
	});
	return frozen;
}

describe("offline kiosk queue (#1292)", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		clocks.kiosk = "2026-10-16T08:30:00Z";
		clocks.device = "2026-10-16T08:30:00Z";
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

	it("keeps a confirmed command for the offline view until a state learned after it arrives", async () => {
		const { fetch } = server({ submit: [executed] });
		const { queue } = queueWith(fetch);
		const frozen = await enqueue(queue, anna);
		clocks.kiosk = "2026-10-16T08:31:00Z";

		expect(await queue.send("z8k_token")).toMatchObject({ settled: 1, waiting: 0 });

		expect(await queue.commands()).toEqual([]);
		expect((await queue.confirmed()).map((record) => record.operationId)).toEqual([
			frozen.command.operationId,
		]);
		// A cached state read before the confirmation does not show it yet.
		await queue.forgetConfirmedBefore(kioskId, "2026-10-16T08:30:59Z");
		expect(await queue.confirmed()).toHaveLength(1);
		await queue.forgetConfirmedBefore(kioskId, "2026-10-16T08:32:00Z");
		expect(await queue.confirmed()).toEqual([]);
	});

	it("keeps a throttled command and resends the same bytes only after the wait", async () => {
		const throttled: Answer = (sent) =>
			Response.json(
				{
					outcome: "retry_later",
					operationId: JSON.parse(sent.body ?? "{}").command.operationId,
					code: "pin_throttled",
					retryAfter: 900,
				},
				{ status: 429 },
			);
		const { sent, fetch } = server({ submit: [throttled, executed, executed] });
		const { queue, storage } = queueWith(fetch);
		await enqueue(queue, anna, "2026-10-16T08:00:00Z");
		await enqueue(queue, anna, "2026-10-16T08:05:00Z");
		const bens = await enqueue(queue, ben, "2026-10-16T08:10:00Z");

		expect(await queue.send("z8k_token")).toMatchObject({ refused: [], settled: 1, waiting: 2 });
		// Anna's later command waits behind the throttled one; Ben's goes on.
		expect(sent.map((request) => request.body)).toEqual([sent[0]?.body, JSON.stringify(bens)]);
		expect((await storage.list())[0]).toMatchObject({
			uncertain: false,
			notBefore: "2026-10-16T08:45:00Z",
		});

		clocks.device = "2026-10-16T08:40:00Z";
		expect(await queue.send("z8k_token")).toMatchObject({ waiting: 2 });
		expect(sent).toHaveLength(2);

		clocks.device = "2026-10-16T08:45:00Z";
		expect(await queue.send("z8k_token")).toMatchObject({ waiting: 1 });
		expect(sent[2]?.body).toBe(sent[0]?.body);
	});

	it("sends each command only with the token it was queued under, and a retired token's once", async () => {
		const otherKiosk = "33333333-3333-4333-8333-333333333333";
		const { sent, fetch } = server({ submit: [executed, refused("kiosk_revoked")] });
		const { queue } = queueWith(fetch);
		// Queued on a kiosk that was revoked, then the device was paired as another kiosk.
		const old = await enqueue(queue, anna, "2026-10-16T08:00:00Z", {
			token: "z8k_old",
			kioskId: otherKiosk,
		});
		const current = await enqueue(queue, ben, "2026-10-16T08:10:00Z", { token: "z8k_new" });

		const report = await queue.send("z8k_new", kioskId);
		expect(report).toMatchObject({ settled: 1, waiting: 0 });
		expect(sent.map((request) => [request.token, request.body])).toEqual([
			["z8k_new", JSON.stringify(current)],
		]);

		const retired = await queue.sendRetired("z8k_new");
		expect(sent.at(-1)).toMatchObject({ token: "z8k_old", body: JSON.stringify(old) });
		expect(retired.refused.map((notice) => notice.code)).toEqual(["kiosk_revoked"]);
		expect(await queue.commands()).toEqual([]);
		expect(await queue.sendRetired("z8k_new")).toMatchObject({ settled: 0, refused: [] });
	});

	it("keeps a retired token's commands while Z8 cannot be reached, for a later contact", async () => {
		const { fetch } = server({ submit: [networkDown] });
		const { queue } = queueWith(fetch);
		await enqueue(queue, anna, undefined, { token: "z8k_old" });

		expect(await queue.sendRetired("z8k_new")).toMatchObject({ unreachable: true });
		expect((await queue.commands()).map((record) => record.token)).toEqual(["z8k_old"]);
	});

	it("answers an empty queue without any request", async () => {
		const { sent, fetch } = server({});
		const { queue } = queueWith(fetch);

		expect(await queue.sendBeforeForgetting("z8k_token")).toMatchObject({ sent: true });
		expect(sent).toEqual([]);
	});
});

describe("reading a queued record's frozen command", () => {
	async function queued(body?: string) {
		const { queue } = queueWith(server({}).fetch);
		const frozen = await enqueue(queue, anna);
		const [record] = await queue.commands();
		if (!record) throw new Error("nothing queued");
		return { frozen, record: body === undefined ? record : { ...record, body } };
	}

	it("reads the command of the stored submission bytes", async () => {
		const { frozen, record } = await queued();

		expect(readFrozenCommand(record)).toEqual(frozen.command);
		expect(frozenCommandOf(record)).toEqual(frozen.command);
		expect(frozenCommandsOf([record])).toEqual([frozen.command]);
	});

	it.each([
		["bytes that are not JSON", "{not json"],
		["JSON that is not an object", "null"],
		["a submission without a command", JSON.stringify({ pin: {}, contact: {} })],
		[
			"a command of another shape",
			JSON.stringify({
				...submission(anna),
				command: { version: 1, operationId: "not-a-uuid" },
			}),
		],
	])("treats %s as unreadable", async (_, body) => {
		const { record } = await queued(body);

		expect(readFrozenCommand(record)).toBeNull();
		expect(frozenCommandsOf([record])).toEqual([]);
		expect(() => frozenCommandOf(record)).toThrow(/unreadable/);
	});

	it("leaves out unreadable records and keeps the readable ones in order", async () => {
		const { frozen, record } = await queued();

		expect(frozenCommandsOf([{ ...record, body: "{not json" }, record])).toEqual([frozen.command]);
	});
});
