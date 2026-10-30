/** Forward observation math only; this does not prove a browser decoder path or byte equality. */
import { createHash } from "node:crypto";

export const cachedCdpTextProjectionProtocol =
	"cached-cdp-text-forward-projection-v1";
export const cachedCdpTextSourceRevision =
	"d0c02bfad08ec92a6ffcf989e53cd995e6381a4c";
export const cachedCdpTextByteLimit = 8 * 1024 * 1024;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
// Exact pinned TextCodecLatin1 kTable entries for 80–9F; all other bytes map to themselves.
const c1 = [
	0x20ac, 0x0081, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6,
	0x2030, 0x0160, 0x2039, 0x0152, 0x008d, 0x017d, 0x008f, 0x0090, 0x2018,
	0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161,
	0x203a, 0x0153, 0x009d, 0x017e, 0x0178,
];
const codeUnit = (byte) =>
	byte >= 0x80 && byte <= 0x9f ? c1[byte - 0x80] : byte;
const mapping = Buffer.alloc(512);
for (let byte = 0; byte < 256; byte++)
	mapping.writeUInt16BE(codeUnit(byte), byte * 2);
export const cachedCdpTextMappingSha256 = hash(mapping);

export function projectCachedCdpText(original) {
	if (
		!Buffer.isBuffer(original) ||
		original.buffer instanceof SharedArrayBuffer
	)
		throw new TypeError("unsupported-original-buffer");
	if (original.length > cachedCdpTextByteLimit)
		throw new RangeError("original-byte-limit");
	if (
		(original[0] === 0xef && original[1] === 0xbb && original[2] === 0xbf) ||
		(original[0] === 0xff && original[1] === 0xfe) ||
		(original[0] === 0xfe && original[1] === 0xff)
	)
		throw new TypeError("unsupported-bom-prefix");
	const utf8Hash = createHash("sha256");
	const chunk = Buffer.allocUnsafe(32768);
	let used = 0,
		utf8Bytes = 0;
	for (const byte of original) {
		const value = codeUnit(byte);
		if (used + 3 > chunk.length) {
			utf8Hash.update(chunk.subarray(0, used));
			used = 0;
		}
		if (value < 0x80) chunk[used++] = value;
		else if (value < 0x800) {
			chunk[used++] = 0xc0 | (value >> 6);
			chunk[used++] = 0x80 | (value & 0x3f);
		} else {
			chunk[used++] = 0xe0 | (value >> 12);
			chunk[used++] = 0x80 | ((value >> 6) & 0x3f);
			chunk[used++] = 0x80 | (value & 0x3f);
		}
		utf8Bytes += value < 0x80 ? 1 : value < 0x800 ? 2 : 3;
		if (utf8Bytes > cachedCdpTextByteLimit)
			throw new RangeError("projected-byte-limit");
	}
	utf8Hash.update(chunk.subarray(0, used));
	return {
		protocol: cachedCdpTextProjectionProtocol,
		sourceRevision: cachedCdpTextSourceRevision,
		mappingSha256: cachedCdpTextMappingSha256,
		originalBytes: original.length,
		originalSha256: hash(original),
		outputCodeUnits: original.length,
		utf8Bytes,
		utf8Sha256: utf8Hash.digest("hex"),
	};
}

/** Recomputes math from the bounded original while available; not browser/cached-body verification. */
export function validateCachedCdpTextProjection(proof, original) {
	try {
		if (
			!proof ||
			![Object.prototype, null].includes(Object.getPrototypeOf(proof))
		)
			return false;
		const expected = projectCachedCdpText(original);
		if (Reflect.ownKeys(proof).length !== Object.keys(expected).length)
			return false;
		return Object.entries(expected).every(([key, value]) => {
			const descriptor = Object.getOwnPropertyDescriptor(proof, key);
			return (
				descriptor &&
				Object.hasOwn(descriptor, "value") &&
				descriptor.value === value
			);
		});
	} catch {
		return false;
	}
}
