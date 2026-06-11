import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";

import { writeWebResponseToNodeResponse } from "./node.js";

class FakeOutgoing extends EventEmitter {
	destroyed = false;
	readonly chunks: Uint8Array[] = [];
	readonly writeHead = vi.fn();
	readonly end = vi.fn();
	writeResult = true;
	onWrite: (() => void) | null = null;

	write(chunk: Uint8Array): boolean {
		this.chunks.push(chunk);
		this.onWrite?.();
		return this.writeResult;
	}
}

async function waitForCondition(assertion: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt += 1) {
		if (assertion()) return;
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Condition was not met");
}

describe("writeWebResponseToNodeResponse", () => {
	it("cancels the web stream reader when the node response closes", async () => {
		const cancel = vi.fn();
		const outgoing = new FakeOutgoing();
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([1]));
				},
				cancel,
			}),
		);

		const pump = writeWebResponseToNodeResponse(response, outgoing);
		await waitForCondition(() => outgoing.chunks.length === 1);
		outgoing.destroyed = true;
		outgoing.emit("close");
		await pump;

		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("waits for drain before writing the next chunk", async () => {
		const outgoing = new FakeOutgoing();
		outgoing.writeResult = false;
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([1]));
					controller.enqueue(new Uint8Array([2]));
					controller.close();
				},
			}),
		);

		const pump = writeWebResponseToNodeResponse(response, outgoing);
		await waitForCondition(() => outgoing.chunks.length === 1);
		expect(outgoing.chunks).toHaveLength(1);

		outgoing.writeResult = true;
		outgoing.emit("drain");
		await pump;

		expect(outgoing.chunks).toHaveLength(2);
	});

	it("cancels and stops pumping if the response closes while waiting for drain", async () => {
		const cancel = vi.fn();
		const outgoing = new FakeOutgoing();
		outgoing.writeResult = false;
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([1]));
					controller.enqueue(new Uint8Array([2]));
				},
				cancel,
			}),
		);

		const pump = writeWebResponseToNodeResponse(response, outgoing);
		await waitForCondition(() => outgoing.chunks.length === 1);
		outgoing.destroyed = true;
		outgoing.emit("close");
		await pump;

		expect(outgoing.chunks).toHaveLength(1);
		expect(cancel).toHaveBeenCalledTimes(1);
	});

	it("cancels the reader if the node response is destroyed during pumping", async () => {
		const cancel = vi.fn();
		const outgoing = new FakeOutgoing();
		outgoing.onWrite = () => {
			outgoing.destroyed = true;
		};
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(new Uint8Array([1]));
					controller.enqueue(new Uint8Array([2]));
				},
				cancel,
			}),
		);

		await writeWebResponseToNodeResponse(response, outgoing);

		expect(outgoing.chunks).toHaveLength(1);
		expect(cancel).toHaveBeenCalledTimes(1);
	});
});
