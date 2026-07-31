import { isInstant } from "@/lib/datetime/temporal-core";

export class StableDataNormalizationError extends Error {
	constructor(cause?: unknown) {
		super("Stable data normalization failed", { cause });
		this.name = "StableDataNormalizationError";
	}
}

function invalid(): never {
	throw new StableDataNormalizationError();
}

function normalizeTraversal(value: unknown, ancestors: Set<object>): unknown {
	if (
		value === null ||
		typeof value === "string" ||
		typeof value === "boolean"
	) {
		return value;
	}
	if (typeof value === "number") {
		if (!Number.isFinite(value)) invalid();
		return Object.is(value, -0) ? 0 : value;
	}
	if (isInstant(value)) return value;
	if (typeof value !== "object" || ancestors.has(value)) invalid();
	ancestors.add(value);
	try {
		const prototype = Object.getPrototypeOf(value);
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const keys = Reflect.ownKeys(descriptors);
		if (Array.isArray(value)) {
			const lengthDescriptor = descriptors.length;
			const length =
				lengthDescriptor && "value" in lengthDescriptor
					? lengthDescriptor.value
					: undefined;
			if (
				prototype !== Array.prototype ||
				!Number.isSafeInteger(length) ||
				length < 0 ||
				keys.length !== length + 1 ||
				keys.some(
					(key) =>
						typeof key !== "string" ||
						(key !== "length" &&
							(!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= length)),
				)
			) {
				invalid();
			}
			const clone: unknown[] = [];
			for (let index = 0; index < length; index += 1) {
				const descriptor = descriptors[String(index)];
				if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
				clone.push(normalizeTraversal(descriptor.value, ancestors));
			}
			return Object.freeze(clone);
		}
		if (prototype !== Object.prototype && prototype !== null) invalid();
		const clone = Object.create(prototype) as Record<PropertyKey, unknown>;
		for (const key of keys) {
			if (typeof key !== "string") invalid();
			const descriptor = descriptors[key];
			if (!descriptor?.enumerable || !("value" in descriptor)) invalid();
			Object.defineProperty(clone, key, {
				configurable: true,
				enumerable: true,
				value: normalizeTraversal(descriptor.value, ancestors),
				writable: true,
			});
		}
		return Object.freeze(clone);
	} finally {
		ancestors.delete(value);
	}
}

export function normalizeStableData(value: unknown): unknown {
	try {
		return normalizeTraversal(value, new Set());
	} catch (error) {
		if (error instanceof StableDataNormalizationError) throw error;
		throw new StableDataNormalizationError(error);
	}
}
