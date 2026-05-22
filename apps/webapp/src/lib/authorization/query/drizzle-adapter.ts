import type { AnyAbility } from "@casl/ability";
import { rulesToCondition } from "@casl/ability/extra";
import { and, eq, inArray, not, or, type SQL } from "drizzle-orm";
import type { DrizzleFieldMap } from "./types";

export type { AccessiblePredicate, DrizzleFieldMap } from "./types";

type ConditionValue = string | number | boolean | { $in: readonly unknown[] };
interface MongoCondition {
	[fieldName: string]: ConditionValue | MongoCondition | MongoCondition[];
}
type AbilityRule<TAbility extends AnyAbility> = ReturnType<TAbility["rulesFor"]>[number];

export class UnsupportedAuthorizationConditionError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UnsupportedAuthorizationConditionError";
	}
}

export function accessibleByDrizzle<TAbility extends AnyAbility>(
	ability: TAbility,
	action: Parameters<TAbility["rulesFor"]>[0],
	subjectType: Parameters<TAbility["rulesFor"]>[1],
	fields: DrizzleFieldMap,
): SQL | null {
	const rules = ability.rulesFor(action, subjectType);

	return rulesToCondition(
		rules,
		(rule) => ruleToPredicate(rule, fields),
		{
			and: combineAnd,
			or: combineOr,
			empty: () => {
				throw new UnsupportedAuthorizationConditionError(
					"Unconditional database authorization is not supported",
				);
			},
		},
	);
}

function ruleToPredicate<TAbility extends AnyAbility>(
	rule: AbilityRule<TAbility>,
	fields: DrizzleFieldMap,
): SQL {
	if (!rule.conditions) {
		throw new UnsupportedAuthorizationConditionError(
			"Unconditional database authorization is not supported",
		);
	}

	const predicate = conditionToPredicate(rule.conditions as MongoCondition, fields);
	return rule.inverted ? not(predicate) : predicate;
}

function conditionToPredicate(condition: MongoCondition, fields: DrizzleFieldMap): SQL {
	const predicates = Object.entries(condition).map(([fieldName, value]) => {
		if (fieldName === "$and") {
			return combineAnd(readBooleanConditions(fieldName, value, fields));
		}

		if (fieldName === "$or") {
			return combineOr(readBooleanConditions(fieldName, value, fields));
		}

		if (fieldName === "$not") {
			if (!isConditionObject(value)) {
				throw unsupportedOperator(fieldName);
			}

			return not(conditionToPredicate(value, fields));
		}

		const field = fields[fieldName];
		if (!field) {
			throw new UnsupportedAuthorizationConditionError(
				`Unsupported authorization field: ${fieldName}`,
			);
		}

		if (isInOperator(value)) {
			return inArray(field, value.$in);
		}

		if (isPlainObject(value)) {
			throw unsupportedOperator(fieldName);
		}

		return eq(field, value);
	});

	return combineAnd(predicates);
}

function readBooleanConditions(
	operator: string,
	value: unknown,
	fields: DrizzleFieldMap,
): SQL[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw unsupportedOperator(operator);
	}

	return value.map((item) => {
		if (!isConditionObject(item)) {
			throw unsupportedOperator(operator);
		}

		return conditionToPredicate(item, fields);
	});
}

function combineAnd(predicates: SQL[]): SQL {
	const predicate = and(...predicates);
	if (!predicate) {
		throw new UnsupportedAuthorizationConditionError("Empty authorization condition is not supported");
	}

	return predicate;
}

function combineOr(predicates: SQL[]): SQL {
	const predicate = or(...predicates);
	if (!predicate) {
		throw new UnsupportedAuthorizationConditionError("Empty authorization condition is not supported");
	}

	return predicate;
}

function isInOperator(value: unknown): value is { $in: readonly unknown[] } {
	return isPlainObject(value) && "$in" in value && Array.isArray(value.$in) && Object.keys(value).length === 1;
}

function isConditionObject(value: unknown): value is MongoCondition {
	return isPlainObject(value) && Object.keys(value).length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unsupportedOperator(fieldName: string): UnsupportedAuthorizationConditionError {
	return new UnsupportedAuthorizationConditionError(
		`Unsupported authorization condition for field: ${fieldName}`,
	);
}
