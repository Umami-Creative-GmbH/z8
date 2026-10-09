import { crc32 } from "node:zlib";

/**
 * A streaming ZIP writer for archives larger than memory (#871). Entries are
 * stored uncompressed (PDFs and images do not compress), and each file is read
 * only when the consumer asks for more bytes, so at most one file is held in
 * memory at a time. Because a file is complete before its header is written,
 * sizes and CRC sit in the local header (no data descriptors); ZIP64 records
 * are added once offsets or the entry count outgrow the classic format.
 */

export interface StoredZipEntry {
	/** Path inside the archive, `/`-separated, UTF-8. */
	name: string;
	/** Modification date as an ISO plain date (`YYYY-MM-DD`); 1980-01-01 when absent. */
	date?: string;
	/** Reads the complete file. Throwing fails the stream. */
	read: () => Promise<Uint8Array>;
}

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR = 0x07064b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const UTF8_NAMES_FLAG = 0x0800;
const VERSION_DEFAULT = 20;
const VERSION_ZIP64 = 45;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const EARLIEST_DOS_DATE = (1 << 5) | 1; // 1980-01-01

interface CentralRecord {
	name: Uint8Array;
	dosDate: number;
	crc: number;
	size: number;
	offset: number;
}

function dosDateOf(date: string | undefined): number {
	const match = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
	if (!match) return EARLIEST_DOS_DATE;
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	if (year < 1980 || year > 2107 || month < 1 || month > 12 || day < 1 || day > 31) {
		return EARLIEST_DOS_DATE;
	}
	return ((year - 1980) << 9) | (month << 5) | day;
}

function localHeader(record: CentralRecord): Uint8Array {
	const header = new Uint8Array(30 + record.name.byteLength);
	const view = new DataView(header.buffer);
	view.setUint32(0, LOCAL_FILE_HEADER, true);
	view.setUint16(4, VERSION_DEFAULT, true);
	view.setUint16(6, UTF8_NAMES_FLAG, true);
	view.setUint16(8, 0, true); // stored
	view.setUint16(10, 0, true); // time 00:00
	view.setUint16(12, record.dosDate, true);
	view.setUint32(14, record.crc, true);
	view.setUint32(18, record.size, true);
	view.setUint32(22, record.size, true);
	view.setUint16(26, record.name.byteLength, true);
	view.setUint16(28, 0, true);
	header.set(record.name, 30);
	return header;
}

function centralHeader(record: CentralRecord, zip64Offset: boolean): Uint8Array {
	const extraLength = zip64Offset ? 12 : 0;
	const header = new Uint8Array(46 + record.name.byteLength + extraLength);
	const view = new DataView(header.buffer);
	const version = zip64Offset ? VERSION_ZIP64 : VERSION_DEFAULT;
	view.setUint32(0, CENTRAL_DIRECTORY_HEADER, true);
	view.setUint16(4, version, true); // made by (MS-DOS host)
	view.setUint16(6, version, true); // needed to extract
	view.setUint16(8, UTF8_NAMES_FLAG, true);
	view.setUint16(10, 0, true);
	view.setUint16(12, 0, true);
	view.setUint16(14, record.dosDate, true);
	view.setUint32(16, record.crc, true);
	view.setUint32(20, record.size, true);
	view.setUint32(24, record.size, true);
	view.setUint16(28, record.name.byteLength, true);
	view.setUint16(30, extraLength, true);
	view.setUint16(32, 0, true); // comment
	view.setUint16(34, 0, true); // disk
	view.setUint16(36, 0, true); // internal attributes
	view.setUint32(38, 0, true); // external attributes
	view.setUint32(42, zip64Offset ? MAX_UINT32 : record.offset, true);
	header.set(record.name, 46);
	if (zip64Offset) {
		const extra = 46 + record.name.byteLength;
		view.setUint16(extra, ZIP64_EXTRA_FIELD, true);
		view.setUint16(extra + 2, 8, true);
		view.setBigUint64(extra + 4, BigInt(record.offset), true);
	}
	return header;
}

function endRecords(input: {
	entries: number;
	directoryOffset: number;
	directorySize: number;
	zip64: boolean;
}): Uint8Array {
	const zip64Length = input.zip64 ? 56 + 20 : 0;
	const records = new Uint8Array(zip64Length + 22);
	const view = new DataView(records.buffer);
	if (input.zip64) {
		const zip64EndOffset = input.directoryOffset + input.directorySize;
		view.setUint32(0, ZIP64_END_OF_CENTRAL_DIRECTORY, true);
		view.setBigUint64(4, BigInt(44), true);
		view.setUint16(12, VERSION_ZIP64, true);
		view.setUint16(14, VERSION_ZIP64, true);
		view.setUint32(16, 0, true);
		view.setUint32(20, 0, true);
		view.setBigUint64(24, BigInt(input.entries), true);
		view.setBigUint64(32, BigInt(input.entries), true);
		view.setBigUint64(40, BigInt(input.directorySize), true);
		view.setBigUint64(48, BigInt(input.directoryOffset), true);
		view.setUint32(56, ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR, true);
		view.setUint32(60, 0, true);
		view.setBigUint64(64, BigInt(zip64EndOffset), true);
		view.setUint32(72, 1, true);
	}
	const end = zip64Length;
	const entries = input.zip64 ? MAX_UINT16 : input.entries;
	view.setUint32(end, END_OF_CENTRAL_DIRECTORY, true);
	view.setUint16(end + 4, 0, true);
	view.setUint16(end + 6, 0, true);
	view.setUint16(end + 8, entries, true);
	view.setUint16(end + 10, entries, true);
	view.setUint32(end + 12, input.zip64 ? MAX_UINT32 : input.directorySize, true);
	view.setUint32(end + 16, input.zip64 ? MAX_UINT32 : input.directoryOffset, true);
	view.setUint16(end + 20, 0, true);
	return records;
}

export function createStoredZipStream(
	entries: Iterable<StoredZipEntry> | AsyncIterable<StoredZipEntry>,
	options: { forceZip64?: boolean } = {},
): ReadableStream<Uint8Array> {
	const forceZip64 = options.forceZip64 === true;
	const encoder = new TextEncoder();
	const records: CentralRecord[] = [];
	let offset = 0;
	let iterator: Iterator<StoredZipEntry> | AsyncIterator<StoredZipEntry> | null = null;

	return new ReadableStream<Uint8Array>(
		{
			async pull(controller) {
				iterator ??=
					Symbol.asyncIterator in entries
						? entries[Symbol.asyncIterator]()
						: entries[Symbol.iterator]();
				const next = await iterator.next();
				if (!next.done) {
					const entry = next.value;
					const data = await entry.read();
					if (data.byteLength >= MAX_UINT32) {
						throw new Error("A single ZIP entry must be smaller than 4 GiB");
					}
					const record: CentralRecord = {
						name: encoder.encode(entry.name),
						dosDate: dosDateOf(entry.date),
						crc: crc32(data) >>> 0,
						size: data.byteLength,
						offset,
					};
					records.push(record);
					const header = localHeader(record);
					offset += header.byteLength + data.byteLength;
					controller.enqueue(header);
					if (data.byteLength > 0) controller.enqueue(data);
					return;
				}

				const directoryOffset = offset;
				const directory = records.map((record) =>
					centralHeader(record, forceZip64 || record.offset >= MAX_UINT32),
				);
				const directorySize = directory.reduce((sum, header) => sum + header.byteLength, 0);
				const zip64 =
					forceZip64 ||
					records.length >= MAX_UINT16 ||
					directoryOffset >= MAX_UINT32 ||
					directorySize >= MAX_UINT32;
				for (const header of directory) controller.enqueue(header);
				controller.enqueue(
					endRecords({ entries: records.length, directoryOffset, directorySize, zip64 }),
				);
				controller.close();
			},
			async cancel() {
				await iterator?.return?.();
			},
		},
		{ highWaterMark: 0 },
	);
}
