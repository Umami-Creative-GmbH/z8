import type { KioskQueueStorage, QueuedKioskCommand } from "./offline-queue";

/** An in-memory stand-in for the kiosk's IndexedDB command store, for unit tests. */
export function memoryKioskQueueStorage(): KioskQueueStorage {
	const records = new Map<number, QueuedKioskCommand>();
	let sequence = 0;
	return {
		async list() {
			return [...records.values()]
				.sort((left, right) => left.sequence - right.sequence)
				.map((record) => structuredClone(record));
		},
		async add(record) {
			sequence += 1;
			records.set(sequence, structuredClone({ ...record, sequence }));
			return sequence;
		},
		async update(record) {
			if (records.has(record.sequence)) records.set(record.sequence, structuredClone(record));
		},
		async remove(sequences) {
			for (const key of sequences) records.delete(key);
		},
	};
}
