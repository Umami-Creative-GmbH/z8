/**
 * Column packing for the dashboard grid.
 *
 * Widgets are placed into the shortest column in reading order. Once the person is working
 * with the dashboard, the previous placement is passed back as `kept`: placed widgets stay in
 * their column whatever their height does, and only widgets that newly appear are packed.
 * Re-balancing on every height change is what made expanding one widget move the others.
 */
export interface MasonryItem<K> {
	key: K;
	/** Height the item occupies, including its margins. */
	height: number;
}

export function assignMasonryColumns<K>(
	items: readonly MasonryItem<K>[],
	columnCount: number,
	kept?: ReadonlyMap<K, number>,
): Map<K, number> {
	const columns = Math.max(1, Math.floor(columnCount));
	const heights = Array.from({ length: columns }, () => 0);
	const assignment = new Map<K, number>();
	const unplaced: MasonryItem<K>[] = [];

	for (const item of items) {
		const column = kept?.get(item.key);
		if (column !== undefined && column < columns) {
			assignment.set(item.key, column);
			heights[column] += item.height;
		} else {
			unplaced.push(item);
		}
	}

	for (const item of unplaced) {
		const column = shortestColumn(heights);
		assignment.set(item.key, column);
		heights[column] += item.height;
	}

	return assignment;
}

/** Whether the keys both lists share appear in the same relative order. */
export function preservesRelativeOrder<K>(previous: readonly K[], next: readonly K[]): boolean {
	const nextKeys = new Set(next);
	const previousKeys = new Set(previous);
	const before = previous.filter((key) => nextKeys.has(key));
	const after = next.filter((key) => previousKeys.has(key));
	return before.every((key, index) => after[index] === key);
}

function shortestColumn(heights: readonly number[]): number {
	let shortest = 0;
	for (let column = 1; column < heights.length; column++) {
		if (heights[column] < heights[shortest]) shortest = column;
	}
	return shortest;
}
