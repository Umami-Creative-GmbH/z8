import { AbilityBuilder, createMongoAbility, type MongoAbility } from "@casl/ability";
import { PgDialect, pgTable, text, boolean } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
	accessibleByDrizzle,
	UnsupportedAuthorizationConditionError,
	type DrizzleFieldMap,
} from "../index";

const documents = pgTable("documents", {
	id: text("id"),
	ownerId: text("owner_id"),
	organizationId: text("organization_id"),
	private: boolean("private"),
});

type TestAbility = MongoAbility<["read" | "update", "Document"]>;

const fields = {
	id: documents.id,
	ownerId: documents.ownerId,
	organizationId: documents.organizationId,
	private: documents.private,
} satisfies DrizzleFieldMap;

function buildAbility(define: (can: AbilityBuilder<TestAbility>["can"], cannot: AbilityBuilder<TestAbility>["cannot"]) => void): TestAbility {
	const { can, cannot, build } = new AbilityBuilder<TestAbility>(createMongoAbility);
	define(can, cannot);
	return build();
}

function toSql(predicate: NonNullable<ReturnType<typeof accessibleByDrizzle>>) {
	return new PgDialect().sqlToQuery(predicate).sql;
}

describe("accessibleByDrizzle", () => {
	it("returns null when no allow rule exists", () => {
		const ability = buildAbility(() => {});

		expect(accessibleByDrizzle(ability, "read", "Document", fields)).toBeNull();
	});

	it("returns a predicate for equality and $in conditions", () => {
		const ability = buildAbility((can) => {
			can("read", "Document", {
				organizationId: "org-1",
				ownerId: { $in: ["employee-1", "employee-2"] },
			});
		});

		const predicate = accessibleByDrizzle(ability, "read", "Document", fields);

		expect(predicate).not.toBeNull();
		expect(toSql(predicate)).toContain('"documents"."organization_id" = $1');
		expect(toSql(predicate)).toContain('"documents"."owner_id" in ($2, $3)');
	});

	it("returns a predicate for explicit $and, $or, and $not conditions", () => {
		const ability = buildAbility((can) => {
			can("read", "Document", {
				$and: [
					{ organizationId: "org-1" },
					{
						$or: [
							{ ownerId: "employee-1" },
							{ $not: { private: true } },
						],
					},
				],
			});
		});

		const predicate = accessibleByDrizzle(ability, "read", "Document", fields);

		expect(predicate).not.toBeNull();
		expect(toSql(predicate)).toContain('"documents"."organization_id" = $1');
		expect(toSql(predicate)).toContain('"documents"."owner_id" = $2');
		expect(toSql(predicate)).toContain('not "documents"."private" = $3');
		expect(toSql(predicate)).toContain(" and ");
		expect(toSql(predicate)).toContain(" or ");
	});

	it("throws for unsupported field", () => {
		const ability = buildAbility((can) => {
			can("read", "Document", { missingField: "x" });
		});

		expect(() => accessibleByDrizzle(ability, "read", "Document", fields)).toThrow(
			UnsupportedAuthorizationConditionError,
		);
	});

	it("preserves CASL v7 cannot priority for narrower allow rules with boolean composition", () => {
		const ability = buildAbility((can, cannot) => {
			can("read", "Document", { organizationId: "org-1" });
			cannot("read", "Document", { private: true });
			can("read", "Document", { ownerId: "employee-1", id: "document-1" });
		});

		const predicate = accessibleByDrizzle(ability, "read", "Document", fields);

		expect(predicate).not.toBeNull();
		expect(toSql(predicate)).toContain(" or ");
		expect(toSql(predicate)).toContain(" and ");
		expect(toSql(predicate)).toContain('not "documents"."private" = $');
		expect(toSql(predicate)).toContain('"documents"."owner_id" = $');
		expect(toSql(predicate)).toContain('"documents"."id" = $');
		expect(toSql(predicate)).toContain('"documents"."organization_id" = $');
	});

	it("throws for unconditional database access", () => {
		const ability = buildAbility((can) => {
			can("read", "Document");
		});

		expect(() => accessibleByDrizzle(ability, "read", "Document", fields)).toThrow(
			UnsupportedAuthorizationConditionError,
		);
	});

	it("throws for unconditional allow rules bounded by conditional denies", () => {
		const ability = buildAbility((can, cannot) => {
			can("read", "Document");
			cannot("read", "Document", { private: true });
		});

		expect(() => accessibleByDrizzle(ability, "read", "Document", fields)).toThrow(
			UnsupportedAuthorizationConditionError,
		);
	});

	it("throws for unsupported operator shape", () => {
		const ability = buildAbility((can) => {
			can("read", "Document", { id: { $regex: "x" } });
		});

		expect(() => accessibleByDrizzle(ability, "read", "Document", fields)).toThrow(
			UnsupportedAuthorizationConditionError,
		);
	});
});
