export function mapSequentially<T, Result>(
	items: readonly T[],
	operation: (item: T, index: number) => Promise<Result>,
): Promise<Result[]> {
	return items.reduce<Promise<Result[]>>(
		(resultsPromise, item, index) =>
			resultsPromise.then(async (results) => {
				results.push(await operation(item, index));
				return results;
			}),
		Promise.resolve([]),
	);
}
