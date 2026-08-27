import type { DBTransactionAdapter, Where } from "better-auth";
import { vi } from "vitest";

type Row = Record<string, unknown>;

function matches(row: Row, where: Where[] = []) {
	return where.every(({ field, operator = "eq", value }) => {
		if (operator === "eq") return row[field] === value;
		if (operator === "ne") return row[field] !== value;
		throw new Error(`Unsupported test operator: ${operator}`);
	});
}

export function createTransactionFixture(initial: Record<string, Row[]> = {}) {
	const rows = new Map(
		Object.entries(initial).map(([model, values]) => [
			model,
			values.map((value) => ({ ...value })),
		]),
	);
	let nextId = 1;
	const table = (model: string) => {
		const existing = rows.get(model);
		if (existing) return existing;
		const created: Row[] = [];
		rows.set(model, created);
		return created;
	};
	const database = {
		id: "scim-test",
		findOne: vi.fn(
			async ({ model, where }: { model: string; where: Where[] }) =>
				table(model).find((row) => matches(row, where)) ?? null,
		),
		findMany: vi.fn(
			async ({ model, where }: { model: string; where?: Where[] }) =>
				table(model).filter((row) => matches(row, where)),
		),
		create: vi.fn(async ({ model, data }: { model: string; data: Row }) => {
			const row = { id: `${model}_${nextId++}`, ...data };
			table(model).push(row);
			return row;
		}),
		update: vi.fn(
			async ({
				model,
				where,
				update,
			}: {
				model: string;
				where: Where[];
				update: Row;
			}) => {
				const row = table(model).find((candidate) => matches(candidate, where));
				if (!row) return null;
				Object.assign(row, update);
				return row;
			},
		),
		delete: vi.fn(
			async ({ model, where }: { model: string; where: Where[] }) => {
				const values = table(model);
				for (let index = values.length - 1; index >= 0; index -= 1) {
					const value = values[index];
					if (value && matches(value, where)) values.splice(index, 1);
				}
			},
		),
	};

	return {
		database: database as unknown as DBTransactionAdapter,
		operations: database,
		rows(model: string) {
			return table(model);
		},
	};
}
