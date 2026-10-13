import { describe, expect, it } from "vitest";
import { type MultipartUploadPort, uploadStreamInParts } from "./multipart-upload";

function fakePort(log: string[]): MultipartUploadPort & { parts: Uint8Array[]; put: Uint8Array[] } {
	const parts: Uint8Array[] = [];
	const put: Uint8Array[] = [];
	return {
		parts,
		put,
		async putObject(body) {
			log.push(`put ${body.byteLength}`);
			put.push(body);
			return { versionId: "v-single" };
		},
		async create() {
			log.push("create");
			return "upload-1";
		},
		async uploadPart(uploadId, partNumber, body) {
			log.push(`part ${partNumber} ${body.byteLength} (${uploadId})`);
			parts.push(body);
			return `etag-${partNumber}`;
		},
		async complete(uploadId, completed) {
			log.push(
				`complete ${uploadId} ${completed.map((part) => `${part.partNumber}:${part.etag}`).join(",")}`,
			);
			return { versionId: "v-multi" };
		},
		async abort(uploadId) {
			log.push(`abort ${uploadId}`);
		},
	};
}

/** A stream of `count` chunks of `size` bytes that logs every chunk it hands out. */
function chunkStream(log: string[], count: number, size: number, failAt?: number) {
	let index = 0;
	return new ReadableStream<Uint8Array>(
		{
			pull(controller) {
				if (index === failAt) {
					controller.error(new Error("source failed"));
					return;
				}
				if (index === count) {
					controller.close();
					return;
				}
				log.push(`chunk ${index}`);
				controller.enqueue(new Uint8Array(size).fill(index));
				index += 1;
			},
		},
		{ highWaterMark: 0 },
	);
}

describe("uploadStreamInParts", () => {
	it("stores a stream smaller than one part with a single put", async () => {
		const log: string[] = [];
		const port = fakePort(log);
		const result = await uploadStreamInParts(port, chunkStream(log, 3, 10), { partSizeBytes: 100 });
		expect(result).toEqual({ versionId: "v-single" });
		expect(log).toEqual(["chunk 0", "chunk 1", "chunk 2", "put 30"]);
		expect([...(port.put[0] ?? [])]).toEqual([
			...new Uint8Array(10).fill(0),
			...new Uint8Array(10).fill(1),
			...new Uint8Array(10).fill(2),
		]);
	});

	it("uploads parts while the stream is still being produced and completes them in order", async () => {
		const log: string[] = [];
		const port = fakePort(log);
		const result = await uploadStreamInParts(port, chunkStream(log, 5, 40), { partSizeBytes: 100 });
		expect(result).toEqual({ versionId: "v-multi" });
		expect(log).toEqual([
			"chunk 0",
			"chunk 1",
			"chunk 2",
			"create",
			"part 1 120 (upload-1)",
			"chunk 3",
			"chunk 4",
			"part 2 80 (upload-1)",
			"complete upload-1 1:etag-1,2:etag-2",
		]);
	});

	it("does not send an empty last part when the stream ends on a part boundary", async () => {
		const log: string[] = [];
		const result = await uploadStreamInParts(fakePort(log), chunkStream(log, 2, 100), {
			partSizeBytes: 100,
		});
		expect(result).toEqual({ versionId: "v-multi" });
		expect(log.filter((line) => !line.startsWith("chunk"))).toEqual([
			"create",
			"part 1 100 (upload-1)",
			"part 2 100 (upload-1)",
			"complete upload-1 1:etag-1,2:etag-2",
		]);
	});

	it("aborts the multipart upload and rethrows when the stream fails", async () => {
		const log: string[] = [];
		await expect(
			uploadStreamInParts(fakePort(log), chunkStream(log, 5, 60, 3), { partSizeBytes: 100 }),
		).rejects.toThrow("source failed");
		expect(log.filter((line) => !line.startsWith("chunk"))).toEqual([
			"create",
			"part 1 120 (upload-1)",
			"abort upload-1",
		]);
	});

	it("never starts a multipart upload when the stream fails before one part is full", async () => {
		const log: string[] = [];
		await expect(
			uploadStreamInParts(fakePort(log), chunkStream(log, 5, 10, 2), { partSizeBytes: 100 }),
		).rejects.toThrow("source failed");
		expect(log).toEqual(["chunk 0", "chunk 1"]);
	});
});
