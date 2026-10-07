import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	deleteTravelExpenseReceiptObject,
	loadReceiptPreview,
	RECEIPT_PREVIEW_SIZE,
	renderReceiptPreview,
} from "../receipt-preview";

const storage = vi.hoisted(() => ({ objects: new Map<string, Uint8Array>() }));

vi.mock("@/lib/storage/export-s3-client", () => ({
	async uploadPrivateObject(_organizationId: string, key: string, data: Uint8Array) {
		storage.objects.set(key, new Uint8Array(data));
		return { bucket: "private", versionId: null };
	},
	async readPrivateObject(input: { key: string }) {
		const bytes = storage.objects.get(input.key);
		if (!bytes) throw new Error("NoSuchKey");
		return bytes;
	},
	async deletePrivateObject(input: { key: string }) {
		storage.objects.delete(input.key);
	},
	async deletePrivateObjectVersions(input: { key: string }) {
		storage.objects.delete(input.key);
	},
}));

/** A noisy photo-sized JPEG, so it compresses like a real phone photo (hundreds of KB). */
async function phonePhoto() {
	const width = 2448;
	const height = 1836;
	const pixels = Buffer.alloc(width * height * 3);
	// Seeded noise, so sizes are the same on every run.
	let seed = 690;
	for (let index = 0; index < pixels.length; index += 1) {
		seed ^= seed << 13;
		seed ^= seed >>> 17;
		seed ^= seed << 5;
		pixels[index] = seed & 0xff;
	}
	return sharp(pixels, { raw: { width, height, channels: 3 } })
		.jpeg({ quality: 90 })
		.toBuffer();
}

async function pixelAt(image: Uint8Array, x: number, y: number) {
	const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
	const offset = (y * info.width + x) * info.channels;
	return { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! };
}

describe("renderReceiptPreview", () => {
	it("turns a phone photo into a small square WebP preview", async () => {
		const photo = await phonePhoto();
		expect(photo.byteLength).toBeGreaterThan(500_000);

		const preview = await renderReceiptPreview(photo, "image/jpeg");

		expect(preview).not.toBeNull();
		const metadata = await sharp(preview!).metadata();
		expect(metadata).toMatchObject({ format: "webp", width: 192, height: 192 });
		expect(preview!.byteLength).toBeLessThan(30_000);
	});

	it("shows the photo upright as the camera recorded it", async () => {
		// Stored sideways: left half red, right half blue, displayed rotated 90° clockwise.
		const sideways = await sharp({
			create: { width: 400, height: 200, channels: 3, background: { r: 0, g: 0, b: 255 } },
		})
			.composite([
				{
					input: { create: { width: 200, height: 200, channels: 3, background: "#ff0000" } },
					left: 0,
					top: 0,
				},
			])
			.jpeg()
			.withMetadata({ orientation: 6 })
			.toBuffer();

		const preview = await renderReceiptPreview(sideways, "image/jpeg");

		// Upright, red is on top: the top right corner is red, not blue.
		const topRight = await pixelAt(preview!, RECEIPT_PREVIEW_SIZE - 10, 10);
		expect(topRight.r).toBeGreaterThan(200);
		expect(topRight.b).toBeLessThan(60);
	});

	it("has no preview for a PDF receipt", async () => {
		const pdf = Buffer.from("%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n%%EOF");

		await expect(renderReceiptPreview(pdf, "application/pdf")).resolves.toBeNull();
	});

	it("has no preview for an image it cannot read", async () => {
		const broken = Buffer.from("not really a jpeg");

		await expect(renderReceiptPreview(broken, "image/jpeg")).resolves.toBeNull();
	});
});

describe("stored receipt previews", () => {
	const receipt = {
		organizationId: "org-1",
		key: "travel-expenses/org-1/reports/report-1/item-1/receipt-1-taxi.jpg",
		bucket: "private",
		versionId: "v1",
	};

	beforeEach(() => {
		storage.objects.clear();
	});

	it("renders the preview once and reuses it without reading the original again", async () => {
		const photo = await phonePhoto();
		storage.objects.set(receipt.key, photo);
		const readOriginal = vi.fn(async () => photo);

		const first = await loadReceiptPreview({ ...receipt, mimeType: "image/jpeg", readOriginal });
		const second = await loadReceiptPreview({ ...receipt, mimeType: "image/jpeg", readOriginal });

		expect(readOriginal).toHaveBeenCalledTimes(1);
		expect(first!.byteLength).toBeLessThan(30_000);
		expect(second).toEqual(first);
	});

	it("does not read a PDF original for a preview", async () => {
		const readOriginal = vi.fn(async () => new Uint8Array());

		const preview = await loadReceiptPreview({
			...receipt,
			mimeType: "application/pdf",
			readOriginal,
		});

		expect(preview).toBeNull();
		expect(readOriginal).not.toHaveBeenCalled();
	});

	it("leaves no preview behind when the receipt object is deleted", async () => {
		const photo = await phonePhoto();
		storage.objects.set(receipt.key, photo);
		await loadReceiptPreview({
			...receipt,
			mimeType: "image/jpeg",
			readOriginal: async () => photo,
		});

		await deleteTravelExpenseReceiptObject(receipt);

		expect([...storage.objects.keys()]).toEqual([]);
	});
});
