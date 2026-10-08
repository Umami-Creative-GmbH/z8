/**
 * Paging the finance queue (#753). Whether an account is open depends on its
 * recorded money and approved adjustments (`settlement.ts`), so the queue is
 * filtered while it is read, never by a row cap. Reports and legacy claims are
 * read as two streams in the same order and merged here; a page is a slice of
 * the merged list, so every account appears on exactly one page.
 */

export interface QueueEntry<T> {
	type: "report" | "legacy_claim";
	id: string;
	/** Epoch milliseconds of the source's decision; undecided sources sort last. */
	decidedAt: number | null;
	item: T;
}

const KIND_RANK: Record<QueueEntry<unknown>["type"], number> = { report: 0, legacy_claim: 1 };

/** Newest decision first, then reports before claims, then id descending (the SQL order). */
function comesFirst(left: QueueEntry<unknown>, right: QueueEntry<unknown>): boolean {
	const leftAt = left.decidedAt ?? Number.NEGATIVE_INFINITY;
	const rightAt = right.decidedAt ?? Number.NEGATIVE_INFINITY;
	if (leftAt !== rightAt) return leftAt > rightAt;
	if (left.type !== right.type) return KIND_RANK[left.type] < KIND_RANK[right.type];
	return left.id > right.id;
}

/** Merges streams that are each ordered newest decision first into one such stream. */
export async function* mergeNewestFirst<T>(
	streams: ReadonlyArray<AsyncIterable<QueueEntry<T>>>,
): AsyncGenerator<T> {
	const iterators = streams.map((stream) => stream[Symbol.asyncIterator]());
	const heads = await Promise.all(iterators.map((iterator) => iterator.next()));
	try {
		while (true) {
			let next: { index: number; entry: QueueEntry<T> } | null = null;
			for (const [index, head] of heads.entries()) {
				if (head.done) continue;
				if (!next || comesFirst(head.value, next.entry)) next = { index, entry: head.value };
			}
			if (!next) return;
			yield next.entry.item;
			heads[next.index] = await (iterators[next.index] as AsyncIterator<QueueEntry<T>>).next();
		}
	} finally {
		await Promise.all(iterators.map((iterator) => iterator.return?.()));
	}
}

/** One page of a stream: `limit` items after skipping `offset`, and whether more follow. */
export async function takeQueuePage<T>(
	stream: AsyncIterable<T>,
	page: { offset: number; limit: number },
): Promise<{ items: T[]; hasMore: boolean }> {
	const items: T[] = [];
	let index = 0;
	for await (const item of stream) {
		if (index++ < page.offset) continue;
		// One more than the page proves that a next page exists.
		if (items.length === page.limit) return { items, hasMore: true };
		items.push(item);
	}
	return { items, hasMore: false };
}
