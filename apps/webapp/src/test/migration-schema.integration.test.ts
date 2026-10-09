import { generateDrizzleJson } from "drizzle-kit/api";
import { expect, it } from "vitest";
import * as auth from "@/db/auth-schema";
import * as schema from "@/db/schema";
import { integrationAdminPool } from "@/test/integration-database";

it("the SQL migration chain supplies every declared table, column, enum, index and constraint", async () => {
	const expected = generateDrizzleJson({ ...auth, ...schema });
	const pool = integrationAdminPool();
	const columns = (
		await pool.query<{
			table_name: string;
			column_name: string;
		}>(
			"select table_name,column_name from information_schema.columns where table_schema='public'",
		)
	).rows;
	const enums = (
		await pool.query<{ name: string; value: string }>(
			"select t.typname as name,e.enumlabel as value from pg_enum e join pg_type t on t.oid=e.enumtypid join pg_namespace n on n.oid=t.typnamespace where n.nspname='public'",
		)
	).rows;
	const indexes = (
		await pool.query<{ tablename: string; indexname: string }>(
			"select tablename,indexname from pg_indexes where schemaname='public'",
		)
	).rows;
	const constraints = (
		await pool.query<{
			table_name: string;
			name: string;
			kind: string;
			columns: string[];
			target: string;
			target_columns: string[];
			on_delete: string;
			on_update: string;
		}>(`
 select c.relname as table_name,con.conname as name,con.contype as kind,
 array(select a.attname::text from unnest(con.conkey) with ordinality k(num,pos) join pg_attribute a on a.attrelid=con.conrelid and a.attnum=k.num order by k.pos) as columns,
 target.relname as target,
 array(select a.attname::text from unnest(con.confkey) with ordinality k(num,pos) join pg_attribute a on a.attrelid=con.confrelid and a.attnum=k.num order by k.pos) as target_columns,
 con.confdeltype as on_delete,con.confupdtype as on_update
 from pg_constraint con join pg_class c on c.oid=con.conrelid
 join pg_namespace n on n.oid=c.relnamespace left join pg_class target on target.oid=con.confrelid
 where n.nspname='public'
 `)
	).rows;
	const uniqueIndexes = (
		await pool.query<{ table_name: string; columns: string[] }>(`
 select c.relname as table_name,
 array(select a.attname::text from unnest(i.indkey) with ordinality k(num,pos) join pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num where k.pos<=i.indnkeyatts order by k.pos) as columns
 from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and i.indisunique and i.indisvalid and i.indpred is null and i.indexprs is null
 `)
	).rows;
	const sameColumns = (a: string[], b: string[]) =>
		JSON.stringify(a) === JSON.stringify(b);
	const action: Record<string, string> = {
		"no action": "a",
		restrict: "r",
		cascade: "c",
		"set null": "n",
		"set default": "d",
	};
	const missing: string[] = [];
	for (const table of Object.values(expected.tables)) {
		const actual = columns.filter((c) => c.table_name === table.name);
		if (!actual.length) {
			missing.push(`table ${table.name}`);
			continue;
		}
		for (const column of Object.values(table.columns)) {
			if (!actual.some((c) => c.column_name === column.name))
				missing.push(`column ${table.name}.${column.name}`);
		}
		for (const index of Object.values(table.indexes)) {
			if (
				!indexes.some(
					(i) => i.tablename === table.name && i.indexname === index.name,
				)
			)
				missing.push(`index ${table.name}.${index.name}`);
		}
		const primaryColumns = Object.values(table.columns)
			.filter((column) => column.primaryKey)
			.map((column) => column.name);
		if (
			primaryColumns.length &&
			!constraints.some(
				(c) =>
					c.table_name === table.name &&
					c.kind === "p" &&
					sameColumns(c.columns, primaryColumns),
			)
		)
			missing.push(`primary key ${table.name}`);
		// Compare FK/unique key definitions: SQL may use custom or truncated names.
		for (const fk of Object.values(table.foreignKeys)) {
			if (
				!constraints.some(
					(c) =>
						c.table_name === table.name &&
						c.kind === "f" &&
						c.target === fk.tableTo &&
						sameColumns(c.columns, fk.columnsFrom) &&
						sameColumns(c.target_columns, fk.columnsTo) &&
						c.on_delete === action[fk.onDelete ?? "no action"] &&
						c.on_update === action[fk.onUpdate ?? "no action"],
				)
			)
				missing.push(`foreign key ${table.name}.${fk.name}`);
		}
		for (const unique of [
			...Object.values(table.uniqueConstraints),
			...Object.values(table.compositePrimaryKeys),
		]) {
			if (
				!uniqueIndexes.some(
					(i) =>
						i.table_name === table.name &&
						sameColumns(i.columns, unique.columns),
				)
			)
				missing.push(`unique key ${table.name}.${unique.name}`);
		}
		for (const check of Object.values(table.checkConstraints)) {
			if (
				!constraints.some(
					(c) =>
						c.table_name === table.name &&
						c.kind === "c" &&
						c.name === check.name.slice(0, 63),
				)
			)
				missing.push(`check ${table.name}.${check.name}`);
		}
	}
	for (const en of Object.values(expected.enums))
		for (const value of en.values)
			if (!enums.some((e) => e.name === en.name && e.value === value))
				missing.push(`enum ${en.name}.${value}`);
	expect(missing).toEqual([]);
});
