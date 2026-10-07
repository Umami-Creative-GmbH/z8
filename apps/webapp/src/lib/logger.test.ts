import pino from "pino";
import { describe, expect, it } from "vitest";
import { logger } from "./logger";

type Serializer = (value: unknown) => unknown;

function serializeError(value: unknown): unknown {
	const serializers = (logger as unknown as Record<symbol, Record<string, Serializer>>)[
		pino.symbols.serializersSym
	];
	return serializers.error?.(value);
}

describe("logger", () => {
	it("logs an Error under `error` with its type, message and stack, not as {}", () => {
		const serialized = serializeError(new TypeError("deletePrivateObject is not defined"));

		expect(serialized).toMatchObject({
			type: "TypeError",
			message: "deletePrivateObject is not defined",
			stack: expect.stringContaining("deletePrivateObject is not defined"),
		});
	});

	it("leaves a non-Error `error` value as it is", () => {
		expect(serializeError("NoSuchKey")).toBe("NoSuchKey");
		expect(serializeError({ code: "E1" })).toEqual({ code: "E1" });
	});
});
