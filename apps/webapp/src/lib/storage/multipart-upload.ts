/**
 * Stores a byte stream of unknown length as one object without holding it in
 * memory (#1169): bytes are collected into parts of `partSizeBytes` and each
 * part is uploaded as soon as it is full, so memory stays near one part plus
 * one chunk. A stream that ends before the first part fills is stored with a
 * single put instead. A failing stream (or part) aborts the multipart upload,
 * so no incomplete upload is left behind, and the error is rethrown unchanged.
 */

import { createLogger } from "@/lib/logger";

const logger = createLogger("MultipartUpload");

/** S3 needs at least 5 MiB for every part but the last; 8 MiB keeps requests few. */
export const DEFAULT_MULTIPART_PART_SIZE_BYTES = 8 * 1024 * 1024;

/** The storage operations a streamed upload needs, bound to one bucket and key. */
export interface MultipartUploadPort {
	putObject(body: Uint8Array): Promise<{ versionId: string | null }>;
	/** Starts a multipart upload; returns its upload id. */
	create(): Promise<string>;
	/** Uploads one part (numbered from 1); returns its ETag. */
	uploadPart(uploadId: string, partNumber: number, body: Uint8Array): Promise<string>;
	complete(
		uploadId: string,
		parts: readonly { partNumber: number; etag: string }[],
	): Promise<{ versionId: string | null }>;
	abort(uploadId: string): Promise<void>;
}

function concat(chunks: readonly Uint8Array[], length: number): Uint8Array {
	if (chunks.length === 1 && chunks[0]) return chunks[0];
	const joined = new Uint8Array(length);
	let offset = 0;
	for (const chunk of chunks) {
		joined.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return joined;
}

export async function uploadStreamInParts(
	port: MultipartUploadPort,
	body: ReadableStream<Uint8Array>,
	options: { partSizeBytes?: number } = {},
): Promise<{ versionId: string | null }> {
	const partSize = options.partSizeBytes ?? DEFAULT_MULTIPART_PART_SIZE_BYTES;
	const reader = body.getReader();
	let buffered: Uint8Array[] = [];
	let bufferedBytes = 0;
	let uploadId: string | null = null;
	const parts: { partNumber: number; etag: string }[] = [];

	/** Uploads the buffered bytes as the next part of `id`. */
	const uploadBuffered = async (id: string) => {
		const partNumber = parts.length + 1;
		const etag = await port.uploadPart(id, partNumber, concat(buffered, bufferedBytes));
		parts.push({ partNumber, etag });
		buffered = [];
		bufferedBytes = 0;
	};

	try {
		for (;;) {
			// One chunk at a time on purpose: the stream is produced on demand.
			const { done, value } = await reader.read();
			if (done) break;
			if (value.byteLength === 0) continue;
			buffered.push(value);
			bufferedBytes += value.byteLength;
			if (bufferedBytes >= partSize) {
				uploadId ??= await port.create();
				await uploadBuffered(uploadId);
			}
		}
		if (uploadId === null) {
			return await port.putObject(concat(buffered, bufferedBytes));
		}
		if (bufferedBytes > 0) await uploadBuffered(uploadId);
		return await port.complete(uploadId, parts);
	} catch (error) {
		await reader.cancel(error).catch(() => undefined);
		if (uploadId !== null) {
			const abandoned = uploadId;
			await port.abort(abandoned).catch((abortError: unknown) => {
				// The upload failed already; a lingering part is left to the bucket's lifecycle rule.
				logger.warn(
					{ uploadId: abandoned, error: abortError },
					"Could not abort an incomplete multipart upload",
				);
			});
		}
		throw error;
	}
}
