/** Runs a bounded number of independent tasks, returning results in input order. */
export async function mapConcurrently<T, R>(
	items: readonly T[],
	limit: number,
	run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (!Number.isInteger(limit) || limit < 1)
		throw new RangeError("Concurrency must be a positive integer");
	let next = 0;
	const results: R[] = new Array(items.length);
	async function worker() {
		while (next < items.length) {
			const index = next++;
			// Each worker must finish its task before taking another; this enforces the bound.
			// react-doctor-disable-next-line react-doctor/async-await-in-loop
			results[index] = await run(items[index], index);
		}
	}
	// Join every worker even on failure, so callers never return while side effects are still running.
	const workers = await Promise.allSettled(
		Array.from({ length: Math.min(limit, items.length) }, worker),
	);
	const failure = workers.find((worker) => worker.status === "rejected");
	if (failure?.status === "rejected") throw failure.reason;
	return results;
}
