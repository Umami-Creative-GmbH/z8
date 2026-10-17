import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import * as authSchema from "../../auth-schema";
import * as appSchema from "../index";

it.each(["empty", "tables-only"])(
	"creates referenced unique keys before foreign keys on a %s database",
	async (state) => {
		const schema = { ...authSchema, ...appSchema };
		const current = generateDrizzleJson(schema);
		const previous =
			state === "empty" ? generateDrizzleJson({}) : structuredClone(current);
		if (state === "tables-only") {
			for (const table of Object.values(previous.tables)) {
				table.indexes = {};
				table.foreignKeys = {};
			}
		}
		const statements = await generateMigration(previous, current);
		const failures: string[] = [];
		const sameColumns = (left: string[], right: string[]) =>
			left.length === right.length &&
			left.every((column) => right.includes(column));
		for (const table of Object.values(schema)) {
			if (!is(table, PgTable)) continue;
			for (const foreignKey of getTableConfig(table).foreignKeys) {
				const reference = foreignKey.reference();
				const target = getTableConfig(reference.foreignTable);
				const columns = reference.foreignColumns.map((column) => column.name);
				// These keys are emitted inside CREATE TABLE, before any foreign keys.
				const inlineKeys = [
					target.columns.filter((column) => column.primary),
					...target.columns
						.filter((column) => column.isUnique)
						.map((column) => [column]),
					...target.primaryKeys.map((key) => key.columns),
					...target.uniqueConstraints.map((key) => key.columns),
				];
				if (
					inlineKeys.some((key) =>
						sameColumns(
							key.map((column) => column.name),
							columns,
						),
					)
				) {
					continue;
				}
				const foreignKeyPosition = statements.findIndex((statement) =>
					statement.includes(
						`CONSTRAINT "${foreignKey.getName()}" FOREIGN KEY`,
					),
				);
				const backingIndexes = target.indexes.filter(
					(index) =>
						index.config.unique &&
						!index.config.where &&
						sameColumns(
							index.config.columns.flatMap((column) =>
								"name" in column ? [column.name] : [],
							),
							columns,
						),
				);
				const ready =
					foreignKeyPosition >= 0 &&
					backingIndexes.some((index) => {
						const position = statements.findIndex((statement) =>
							statement.startsWith(
								`CREATE UNIQUE INDEX "${index.config.name}"`,
							),
						);
						return position >= 0 && position < foreignKeyPosition;
					});
				if (!ready)
					failures.push(
						`${foreignKey.getName()} -> ${target.name}(${columns.join(", ")})`,
					);
			}
		}
		expect(failures).toEqual([]);
	},
);
