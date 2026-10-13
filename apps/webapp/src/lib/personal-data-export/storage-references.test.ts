import { describe, expect, it } from "vitest";
import { jsonWithoutStorageReferences, withoutStorageReferences } from "./storage-references";

describe("withoutStorageReferences", () => {
	it("drops stored-object references and storage identity fields at any depth", () => {
		expect(
			withoutStorageReferences({
				reportId: "r-1",
				items: [
					{
						position: 1,
						receipts: [
							{
								receiptId: "rc-1",
								fileName: "train.pdf",
								sizeBytes: 12,
								checksumSha256: "abc",
								object: { provider: "s3-private", bucket: "b", key: "k", versionId: "v" },
							},
						],
					},
				],
				attachments: [{ attachmentId: "a-1", storageKey: "k", storage_bucket: "b" }],
				storage_version_id: "v",
			}),
		).toEqual({
			reportId: "r-1",
			items: [
				{ position: 1, receipts: [{ receiptId: "rc-1", fileName: "train.pdf", sizeBytes: 12 }] },
			],
			attachments: [{ attachmentId: "a-1" }],
		});
	});

	it("keeps ordinary values, including keys that merely mention a version", () => {
		const value = { policy: { version: 3, rate: "0.30", source: { provider: "ECB", key: "EUR" } } };
		expect(withoutStorageReferences(value)).toEqual(value);
		expect(withoutStorageReferences(null)).toBeNull();
		expect(withoutStorageReferences(["a", 1, true])).toEqual(["a", 1, true]);
	});
});

describe("jsonWithoutStorageReferences", () => {
	it("serializes the cleaned value, and null stays null", () => {
		expect(jsonWithoutStorageReferences({ a: 1, storageKey: "k" })).toBe('{"a":1}');
		expect(jsonWithoutStorageReferences(null)).toBeNull();
	});
});
