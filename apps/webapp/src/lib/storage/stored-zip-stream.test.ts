import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { createStoredZipStream, type StoredZipEntry } from "./stored-zip-stream";

const bytes = (text: string) => new TextEncoder().encode(text);

async function collect(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
	return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(archive: Uint8Array) {
	const zip = await JSZip.loadAsync(archive);
	const files: Record<string, { text: string; date: Date }> = {};
	for (const entry of Object.values(zip.files)) {
		files[entry.name] = { text: await entry.async("string"), date: entry.date };
	}
	return files;
}

const entry = (name: string, text: string, date?: string): StoredZipEntry => ({
	name,
	date,
	read: async () => bytes(text),
});

describe("createStoredZipStream", () => {
	it("writes a ZIP that standard readers open, with UTF-8 names and the given dates", async () => {
		const archive = await collect(
			createStoredZipStream([
				entry("contract/2026-03-01_Arbeitsvertrag.pdf", "%PDF contract", "2026-03-01"),
				entry("certificate/2026-04-02_Zeugnis für Anna.pdf", "%PDF zeugnis", "2026-04-02"),
			]),
		);

		const files = await unzip(archive);
		expect(Object.keys(files)).toEqual([
			"contract/2026-03-01_Arbeitsvertrag.pdf",
			"certificate/2026-04-02_Zeugnis für Anna.pdf",
		]);
		expect(files["contract/2026-03-01_Arbeitsvertrag.pdf"]?.text).toBe("%PDF contract");
		expect(files["certificate/2026-04-02_Zeugnis für Anna.pdf"]?.text).toBe("%PDF zeugnis");
		const date = files["certificate/2026-04-02_Zeugnis für Anna.pdf"]?.date;
		// JSZip reads the DOS date as UTC.
		expect(date?.toISOString().slice(0, 10)).toBe("2026-04-02");
	});

	it("writes an empty archive when there is nothing to include", async () => {
		const archive = await collect(createStoredZipStream([]));
		expect(Object.keys(await unzip(archive))).toEqual([]);
	});

	it("writes ZIP64 records that standard readers open", async () => {
		const archive = await collect(
			createStoredZipStream([entry("a.pdf", "first"), entry("b/c.pdf", "second")], {
				forceZip64: true,
			}),
		);
		const files = await unzip(archive);
		expect(files["a.pdf"]?.text).toBe("first");
		expect(files["b/c.pdf"]?.text).toBe("second");
	});

	it("reads one file at a time, only when the consumer asks for more", async () => {
		const reads: number[] = [];
		const total = 40;
		const chunk = new Uint8Array(1024 * 1024);
		const entries = (async function* () {
			for (let index = 0; index < total; index += 1) {
				yield {
					name: `file-${index}.pdf`,
					read: async () => {
						reads.push(index);
						return chunk;
					},
				} satisfies StoredZipEntry;
			}
		})();

		const reader = createStoredZipStream(entries).getReader();
		let received = 0;
		let maxReadAhead = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			received += value.byteLength;
			// Files whose bytes were read but not yet handed to the consumer stay bounded.
			const fullyReceivedFiles = Math.floor(received / (chunk.byteLength + 64));
			maxReadAhead = Math.max(maxReadAhead, reads.length - fullyReceivedFiles);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}

		expect(reads).toHaveLength(total);
		expect(received).toBeGreaterThan(total * chunk.byteLength);
		expect(maxReadAhead).toBeLessThanOrEqual(2);
	});

	it("fails the stream when a file cannot be read", async () => {
		const stream = createStoredZipStream([
			entry("a.pdf", "fine"),
			{
				name: "b.pdf",
				read: async () => {
					throw new Error("Stored document content does not match its recorded identity");
				},
			},
		]);
		await expect(collect(stream)).rejects.toThrow("does not match");
	});
});
