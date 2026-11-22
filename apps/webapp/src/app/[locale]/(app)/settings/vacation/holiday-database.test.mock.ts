import { vi } from "vitest";

/**
 * A stand-in database for the holiday settings action tests. Query builders
 * chain any method; awaiting one resolves the next queued `select` result, the
 * `returning` rows of an update or delete, or the inserted row. Writes and
 * their `where` conditions are recorded.
 */
export function holidayTestDatabase(query: Record<string, unknown>) {
	const state = {
		selects: [] as unknown[][],
		inserts: [] as unknown[],
		updates: [] as unknown[],
		updateConditions: [] as unknown[],
		updateReturn: [] as unknown[],
		deletes: 0,
		deleteReturn: [] as unknown[],
		guardCalls: 0,
	};

	function chain(resolve: () => unknown, onWhere?: (condition: unknown) => void) {
		const builder: unknown = new Proxy(
			{},
			{
				get(_target, property) {
					if (property === "then") {
						return (
							onFulfilled: (value: unknown) => unknown,
							onRejected?: (error: unknown) => unknown,
						) => Promise.resolve().then(resolve).then(onFulfilled, onRejected);
					}
					return (...args: unknown[]) => {
						if (property === "where") onWhere?.(args[0]);
						return builder;
					};
				},
			},
		);
		return builder;
	}

	const db = {
		query,
		select: vi.fn(() => chain(() => state.selects.shift() ?? [])),
		insert: vi.fn(() => ({
			values: vi.fn((value: Record<string, unknown> | Record<string, unknown>[]) => {
				state.inserts.push(value);
				return chain(() => [{ id: "new-row", ...(Array.isArray(value) ? {} : value) }]);
			}),
		})),
		update: vi.fn(() => ({
			set: vi.fn((value: unknown) => {
				state.updates.push(value);
				return chain(
					() => state.updateReturn,
					(condition) => state.updateConditions.push(condition),
				);
			}),
		})),
		delete: vi.fn(() =>
			chain(() => {
				state.deletes += 1;
				return state.deleteReturn;
			}),
		),
		execute: vi.fn(async () => {
			state.guardCalls += 1;
			return [];
		}),
		transaction(callback: (tx: unknown) => unknown) {
			return callback(db);
		},
	};

	function reset() {
		state.selects = [];
		state.inserts = [];
		state.updates = [];
		state.updateConditions = [];
		state.updateReturn = [];
		state.deletes = 0;
		state.deleteReturn = [];
		state.guardCalls = 0;
	}

	return { db, state, reset };
}
