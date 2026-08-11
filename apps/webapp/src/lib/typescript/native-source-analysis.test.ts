import typescriptPackage from "typescript/package.json";
import { type Identifier, isIdentifier } from "typescript/unstable/ast";
import {
	API,
	Snapshot,
	type Symbol as TypeScriptSymbol,
} from "typescript/unstable/sync";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
	closeNativeSourceAnalysis,
	type NativeSourceContext,
	withNativeProgram,
	withNativeSource,
} from "./native-source-analysis";

const CALLBACK_SCOPE_ERROR =
	"Native source analysis callback results must not escape callback-scoped TypeScript objects or lazy iterators";

function assertSyncCallbackTypes(): void {
	// @ts-expect-error Native analysis callbacks must not return Promises.
	withNativeSource("", "async.ts", async () => "async");
	// @ts-expect-error Native analysis callbacks must not return Promise-like values.
	withNativeSource("", "promise.ts", () => Promise.resolve("promise"));
	// @ts-expect-error Native analysis callbacks must not return async generators.
	withNativeSource("", "async-generator.ts", async function* () {
		yield "async";
	});
	withNativeSource(
		"",
		"async-iterable.ts",
		// @ts-expect-error Native analysis callbacks must not return async iterables.
		(): AsyncIterable<string> => ({
			async *[Symbol.asyncIterator]() {
				yield "async";
			},
		}),
	);
	// @ts-expect-error A union containing a Promise is still asynchronous.
	withNativeSource("", "union.ts", (): string | Promise<string> => "sync");
	// @ts-expect-error An any return could hide an asynchronous value.
	withNativeSource("", "any.ts", () => JSON.parse('"unknown"'));
	// @ts-expect-error Native analysis callbacks must not return the remote program.
	withNativeSource("", "program.ts", ({ program }) => program);
	// @ts-expect-error Native analysis callbacks must not return the remote checker.
	withNativeSource("", "checker.ts", ({ checker }) => checker);
	// @ts-expect-error Native analysis callbacks must not return remote AST nodes.
	withNativeSource("", "source-file.ts", ({ sourceFile }) => sourceFile);
	const symbol = null as TypeScriptSymbol | null;
	// @ts-expect-error Native analysis callbacks must not return remote symbols.
	withNativeSource("", "symbol.ts", () => symbol);
	// @ts-expect-error Native analysis callbacks must not return synchronous iterators.
	withNativeSource("", "iterator.ts", () => [1, 2][Symbol.iterator]());
	withNativeSource(
		"",
		"closure.ts",
		// @ts-expect-error Native analysis callbacks must not return closures over remote objects.
		({ program }) =>
			() =>
				program.getSyntacticDiagnostics("/closure.ts"),
	);
}
void assertSyncCallbackTypes;

afterAll(() => {
	closeNativeSourceAnalysis();
});

describe("native source analysis", () => {
	it("uses TypeScript 7.0.2 exactly", () => {
		expect(typescriptPackage.version).toBe("7.0.2");
	});

	it("parses one source and returns a plain derived value", () => {
		const result = withNativeSource(
			"const answer = 42;",
			"fixture.ts",
			({ sourceFile }) => ({
				fileName: sourceFile.fileName,
				text: sourceFile.text,
			}),
		);

		expect(result).toEqual({
			fileName: "/fixture.ts",
			text: "const answer = 42;",
		});
	});

	it("queries symbol names for identifier nodes in one batch", () => {
		const symbolNames = withNativeSource(
			"const first = 1; const second = first;",
			"batched-symbols.ts",
			({ checker, sourceFile }) => {
				const identifiers: Identifier[] = [];
				sourceFile.forEachChild(function visit(node) {
					if (isIdentifier(node)) identifiers.push(node);
					node.forEachChild(visit);
				});

				return checker
					.getSymbolAtLocation(identifiers)
					.map((symbol) => symbol?.name);
			},
		);

		expect(symbolNames).toEqual(["first", "second", "first"]);
	});

	it("allows common plain derived result containers", () => {
		const result = withNativeSource(
			"const answer = 42;",
			"plain-results.ts",
			({ sourceFile }) => ({
				array: [sourceFile.fileName, sourceFile.text],
				map: new Map([[sourceFile.fileName, sourceFile.text]]),
			}),
		);

		expect(result).toEqual({
			array: ["/plain-results.ts", "const answer = 42;"],
			map: new Map([["/plain-results.ts", "const answer = 42;"]]),
		});
	});

	it("returns fresh source content across sequential calls", () => {
		const first = withNativeSource(
			"const first = 1;",
			"/fixture.ts",
			({ sourceFile }) => sourceFile.statements[0]?.getText(sourceFile),
		);
		const second = withNativeSource(
			"const second = 2;",
			"/fixture.ts",
			({ sourceFile }) => sourceFile.statements[0]?.getText(sourceFile),
		);

		expect(first).toBe("const first = 1;");
		expect(second).toBe("const second = 2;");
	});

	it("does not bind script globals across source files", () => {
		const declarationFile = withNativeProgram(
			new Map([
				["declaration.ts", "const sharedValue = 1;"],
				["use.ts", "const result = sharedValue;"],
			]),
			"use.ts",
			({ checker, sourceFile }) => {
				let reference: Identifier | undefined;
				sourceFile.forEachChild(function visit(node) {
					if (isIdentifier(node) && node.text === "sharedValue") {
						reference = node;
						return;
					}
					node.forEachChild(visit);
				});

				if (!reference) {
					throw new Error("Expected sharedValue reference");
				}
				return checker
					.getSymbolAtLocation(reference)
					?.valueDeclaration?.resolve()
					?.getSourceFile().fileName;
			},
		);

		expect(declarationFile).toBeUndefined();
	});

	it("returns syntactic diagnostic 1160 for malformed source", () => {
		const codes = withNativeSource(
			"const broken = `unterminated",
			"broken.ts",
			({ program }) =>
				program
					.getSyntacticDiagnostics("/broken.ts")
					.map((diagnostic) => diagnostic.code),
		);

		expect(codes).toContain(1160);
	});

	it("throws a normalized path-bearing error when the entry is absent", () => {
		expect(() =>
			withNativeProgram(
				new Map([["other.ts", "const other = true;"]]),
				"fixture\\missing.ts",
				() => null,
			),
		).toThrowError("Native source entry is missing: /fixture/missing.ts");
	});

	it.each([
		["dot segments", "./nested/../fixture.ts", "/fixture.ts"],
		["parent segments", "../outside.ts", "/outside.ts"],
		[
			"Windows drive and backslashes",
			"C:\\repo\\nested\\..\\fixture.ts",
			"/C:/repo/fixture.ts",
		],
	] as const)("normalizes %s lexically", (_name, fileName, expected) => {
		expect(
			withNativeSource(
				"const normalized = true;",
				fileName,
				({ sourceFile }) => sourceFile.fileName,
			),
		).toBe(expected);
	});

	it.each([
		["Unix paths", "/repo/nested/../same.ts", "/repo/same.ts", "/repo/same.ts"],
		[
			"Windows paths",
			"C:\\repo\\nested\\..\\same.ts",
			"C:/repo/same.ts",
			"/C:/repo/same.ts",
		],
	] as const)(
		"rejects normalized %s collisions before analysis",
		(_name, first, second, normalized) => {
			expect(() =>
				withNativeProgram(
					new Map([
						[first, "const first = true;"],
						[second, "const second = true;"],
					]),
					first,
					() => null,
				),
			).toThrowError(
				`Native source path collision at ${normalized}: ${first}, ${second}`,
			);
		},
	);

	it.each(["array", "map", "set", "object"] as const)(
		"rejects a remote node nested in a %s",
		(container) => {
			expect(() =>
				withNativeSource("const nested = true;", `nested-${container}.ts`, (({
					sourceFile,
				}: NativeSourceContext): unknown => {
					if (container === "array") return [sourceFile];
					if (container === "map") return new Map([["node", sourceFile]]);
					if (container === "set") return new Set([sourceFile]);
					return { nested: { sourceFile } };
				}) as never),
			).toThrowError(CALLBACK_SCOPE_ERROR);
		},
	);

	it.each([
		["function", () => ({ nested: () => "escaped" })],
		["iterator", () => ({ nested: [1][Symbol.iterator]() })],
		["promise", () => ({ nested: Promise.resolve("escaped") })],
		[
			"async iterable",
			() => ({
				nested: {
					async *[Symbol.asyncIterator]() {
						yield "escaped";
					},
				},
			}),
		],
	] as const)("rejects a nested %s", (_name, result) => {
		expect(() =>
			withNativeSource(
				"const nested = true;",
				"nested-lazy.ts",
				result as never,
			),
		).toThrowError(CALLBACK_SCOPE_ERROR);
	});

	it.each(["array", "map", "set", "object"] as const)(
		"handles a rejected Promise nested in a %s before rejecting the result",
		async (container) => {
			closeNativeSourceAnalysis();
			const unhandledRejections: unknown[] = [];
			const disposeSpy = vi.spyOn(Snapshot.prototype, "dispose");
			const onUnhandledRejection = (reason: unknown) => {
				unhandledRejections.push(reason);
			};
			process.on("unhandledRejection", onUnhandledRejection);

			try {
				const rejection = new Error(`nested ${container} rejection`);
				expect(() =>
					withNativeSource(
						"const nested = true;",
						`nested-rejected-promise-${container}.ts`,
						((): unknown => {
							const promise = Promise.reject(rejection);
							if (container === "array") return [promise];
							if (container === "map") return new Map([["promise", promise]]);
							if (container === "set") return new Set([promise]);
							return { nested: { promise } };
						}) as never,
					),
				).toThrowError(CALLBACK_SCOPE_ERROR);
				expect(disposeSpy).toHaveBeenCalledTimes(1);

				await new Promise((resolve) => setTimeout(resolve, 0));
				expect(unhandledRejections).toEqual([]);
				expect(disposeSpy).toHaveBeenCalledTimes(1);
			} finally {
				process.off("unhandledRejection", onUnhandledRejection);
				disposeSpy.mockRestore();
			}
		},
	);

	it.each(["array", "map", "set", "object"] as const)(
		"rejects a nested %s accessor without invoking it",
		(container) => {
			let getterCalls = 0;
			const value: object =
				container === "array"
					? []
					: container === "map"
						? new Map()
						: container === "set"
							? new Set()
							: {};
			const accessorKey: PropertyKey = "then";
			Object.defineProperty(value, accessorKey, {
				configurable: true,
				get() {
					getterCalls += 1;
					return undefined;
				},
			});

			expect(() =>
				withNativeSource(
					"const accessor = true;",
					`nested-${container}-accessor.ts`,
					(() => ({ nested: value })) as never,
				),
			).toThrowError(CALLBACK_SCOPE_ERROR);
			expect(getterCalls).toBe(0);
		},
	);

	it("allows cyclic plain result containers", () => {
		const result = withNativeSource("const cyclic = true;", "cyclic.ts", () => {
			const object: { self?: unknown; value: string } = { value: "plain" };
			const map = new Map<string, unknown>();
			const set = new Set<unknown>();
			object.self = object;
			map.set("self", map);
			set.add(set);
			return { map, object, set };
		});

		expect(result.object.self).toBe(result.object);
		expect(result.map.get("self")).toBe(result.map);
		expect(result.set.has(result.set)).toBe(true);
	});

	it("disposes a failed callback snapshot before the next call", () => {
		expect(() =>
			withNativeSource("const failure = true;", "failure.ts", () => {
				throw new Error("callback failed");
			}),
		).toThrowError("callback failed");

		expect(
			withNativeSource(
				"const recovered = true;",
				"recovered.ts",
				({ sourceFile }) => sourceFile.text,
			),
		).toBe("const recovered = true;");
	});

	it("closes idempotently and lazily recreates the runtime", () => {
		closeNativeSourceAnalysis();
		closeNativeSourceAnalysis();

		expect(
			withNativeSource(
				"const recreated = true;",
				"recreated.ts",
				({ sourceFile }) => sourceFile.text,
			),
		).toBe("const recreated = true;");
	});

	it("rejects a native async callback before invoking it", async () => {
		let invoked = false;
		let continuationError: unknown;

		expect(() =>
			withNativeSource("const escaped = true;", "escaped.ts", (async ({
				program,
			}: NativeSourceContext) => {
				invoked = true;
				await new Promise((resolve) => setTimeout(resolve, 5));
				try {
					program.getSyntacticDiagnostics("/escaped.ts");
				} catch (error) {
					continuationError = error;
				}
			}) as never),
		).toThrowError("Native source analysis callbacks must be synchronous");

		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(invoked).toBe(false);
		expect(continuationError).toBeUndefined();
	});

	it("rejects an async generator callback before invoking it", () => {
		let invoked = false;
		const callback = new Proxy(
			async function* (_context: NativeSourceContext) {
				yield "async";
			},
			{
				apply: (target, thisArgument, argumentsList) => {
					invoked = true;
					return Reflect.apply(target, thisArgument, argumentsList);
				},
			},
		);

		expect(() =>
			withNativeSource(
				"const escaped = true;",
				"generator.ts",
				callback as never,
			),
		).toThrowError("Native source analysis callbacks must be synchronous");
		expect(invoked).toBe(false);
	});

	it("rejects a synchronous generator callback before invoking it", () => {
		let invoked = false;
		const callback = new Proxy(
			function* (_context: NativeSourceContext) {
				yield "lazy";
			},
			{
				apply: (target, thisArgument, argumentsList) => {
					invoked = true;
					return Reflect.apply(target, thisArgument, argumentsList);
				},
			},
		);

		expect(() =>
			withNativeSource(
				"const escaped = true;",
				"sync-generator.ts",
				callback as never,
			),
		).toThrowError(CALLBACK_SCOPE_ERROR);
		expect(invoked).toBe(false);
		expect(
			withNativeSource(
				"const recovered = true;",
				"after-sync-generator.ts",
				({ sourceFile }) => sourceFile.text,
			),
		).toBe("const recovered = true;");
	});

	it.each([
		[
			"generator result",
			() =>
				(function* () {
					yield "lazy";
				})(),
		],
		["iterator result", () => ["lazy"][Symbol.iterator]()],
	] as const)(
		"rejects a synchronous %s and disposes its snapshot",
		(_name, result) => {
			closeNativeSourceAnalysis();
			const disposeSpy = vi.spyOn(Snapshot.prototype, "dispose");

			try {
				expect(() =>
					withNativeSource(
						"const escaped = true;",
						"sync-iterator-result.ts",
						result as never,
					),
				).toThrowError(CALLBACK_SCOPE_ERROR);
				expect(disposeSpy).toHaveBeenCalledTimes(1);
				expect(
					withNativeSource(
						"const recovered = true;",
						"after-sync-iterator-result.ts",
						({ sourceFile }) => sourceFile.text,
					),
				).toBe("const recovered = true;");
				expect(disposeSpy).toHaveBeenCalledTimes(3);
			} finally {
				disposeSpy.mockRestore();
			}
		},
	);

	it.each(["program", "checker", "sourceFile", "node", "symbol"] as const)(
		"rejects a direct remote %s result, disposes, and recovers",
		(remoteResult) => {
			closeNativeSourceAnalysis();
			const disposeSpy = vi.spyOn(Snapshot.prototype, "dispose");

			try {
				expect(() =>
					withNativeSource(
						"const escapedSymbol = true;",
						`remote-${remoteResult}.ts`,
						((context: NativeSourceContext): unknown => {
							if (remoteResult === "node") {
								return context.sourceFile.statements[0];
							}
							if (remoteResult !== "symbol") return context[remoteResult];
							let identifier: Identifier | undefined;
							context.sourceFile.forEachChild(function visit(node) {
								if (isIdentifier(node) && node.text === "escapedSymbol") {
									identifier = node;
									return;
								}
								node.forEachChild(visit);
							});
							if (!identifier) throw new Error("Expected escapedSymbol");
							return context.checker.getSymbolAtLocation(identifier);
						}) as never,
					),
				).toThrowError(CALLBACK_SCOPE_ERROR);
				expect(disposeSpy).toHaveBeenCalledTimes(1);
				expect(
					withNativeSource(
						"const recovered = true;",
						`after-remote-${remoteResult}.ts`,
						({ sourceFile }) => sourceFile.text,
					),
				).toBe("const recovered = true;");
				expect(disposeSpy).toHaveBeenCalledTimes(3);
			} finally {
				disposeSpy.mockRestore();
			}
		},
	);

	it("rejects a returned closure, disposes its snapshot, and recovers", () => {
		closeNativeSourceAnalysis();
		const disposeSpy = vi.spyOn(Snapshot.prototype, "dispose");

		try {
			expect(() =>
				withNativeSource(
					"const escaped = true;",
					"closure-result.ts",
					(({ program }: NativeSourceContext) =>
						() =>
							program.getSyntacticDiagnostics("/closure-result.ts")) as never,
				),
			).toThrowError(CALLBACK_SCOPE_ERROR);
			expect(disposeSpy).toHaveBeenCalledTimes(1);
			expect(
				withNativeSource(
					"const recovered = true;",
					"after-closure-result.ts",
					({ sourceFile }) => sourceFile.text,
				),
			).toBe("const recovered = true;");
			expect(disposeSpy).toHaveBeenCalledTimes(3);
		} finally {
			disposeSpy.mockRestore();
		}
	});

	it("disposes immediately and handles rejection for returned Promises", async () => {
		closeNativeSourceAnalysis();
		let continuationError: unknown;
		const unhandledRejections: unknown[] = [];
		const disposeSpy = vi.spyOn(Snapshot.prototype, "dispose");
		const onUnhandledRejection = (reason: unknown) => {
			unhandledRejections.push(reason);
		};
		process.on("unhandledRejection", onUnhandledRejection);

		try {
			expect(() =>
				withNativeSource(
					"const delayed = true;",
					"delayed.ts",
					(({ program }: NativeSourceContext) =>
						new Promise<void>((_resolve, reject) => {
							setTimeout(() => {
								try {
									program.getSyntacticDiagnostics("/delayed.ts");
									reject(new Error("Expected disposed snapshot"));
								} catch (error) {
									continuationError = error;
									reject(error);
								}
							}, 5);
						})) as never,
				),
			).toThrowError("Native source analysis callbacks must be synchronous");
			expect(disposeSpy).toHaveBeenCalledTimes(1);

			await new Promise((resolve) => setTimeout(resolve, 10));
			expect(continuationError).toBeInstanceOf(Error);
			expect(unhandledRejections).toEqual([]);
			expect(disposeSpy).toHaveBeenCalledTimes(1);
		} finally {
			process.off("unhandledRejection", onUnhandledRejection);
			disposeSpy.mockRestore();
		}
	});

	it("rejects a top-level AsyncIterable accessor without invoking it", () => {
		closeNativeSourceAnalysis();
		let escaped: unknown;
		let getterReads = 0;
		let iteratorInvoked = false;
		const disposeSpy = vi.spyOn(Snapshot.prototype, "dispose");

		try {
			expect(() => {
				escaped = withNativeSource(
					"const iterable = true;",
					"iterable-getter.ts",
					((): unknown => ({
						get [Symbol.asyncIterator]() {
							getterReads += 1;
							return async function* () {
								iteratorInvoked = true;
								yield "value";
							};
						},
					})) as never,
				);
			}).toThrowError(CALLBACK_SCOPE_ERROR);
			expect(escaped).toBeUndefined();
			expect(getterReads).toBe(0);
			expect(iteratorInvoked).toBe(false);
			expect(disposeSpy).toHaveBeenCalledTimes(1);
		} finally {
			disposeSpy.mockRestore();
		}
	});

	it("rejects an AsyncIterable exposed through a proxy without iterating it", () => {
		closeNativeSourceAnalysis();
		let escaped: unknown;
		let proxyReads = 0;
		let iteratorInvoked = false;
		const iterable = new Proxy<Record<PropertyKey, unknown>>(
			{},
			{
				get: (target, property, receiver) => {
					if (property === Symbol.asyncIterator) {
						proxyReads += 1;
						return async function* () {
							iteratorInvoked = true;
							yield "value";
						};
					}
					return Reflect.get(target, property, receiver);
				},
			},
		);
		const disposeSpy = vi.spyOn(Snapshot.prototype, "dispose");

		try {
			expect(() => {
				escaped = withNativeSource(
					"const iterable = true;",
					"iterable-proxy.ts",
					((): unknown => iterable) as never,
				);
			}).toThrowError("Native source analysis callbacks must be synchronous");
			expect(escaped).toBeUndefined();
			expect(proxyReads).toBeGreaterThan(0);
			expect(iteratorInvoked).toBe(false);
			expect(disposeSpy).toHaveBeenCalledTimes(1);
		} finally {
			disposeSpy.mockRestore();
		}
	});

	it("clears the runtime before close errors and remains idempotent", () => {
		closeNativeSourceAnalysis();
		withNativeSource(
			"const closeFailure = true;",
			"close-failure.ts",
			() => null,
		);
		const originalClose = API.prototype.close;
		const closeSpy = vi
			.spyOn(API.prototype, "close")
			.mockImplementationOnce(function closeThenFail(this: API) {
				originalClose.call(this);
				throw new Error("close failed");
			});

		try {
			expect(() => closeNativeSourceAnalysis()).toThrowError("close failed");
			expect(() => closeNativeSourceAnalysis()).not.toThrow();
			expect(closeSpy).toHaveBeenCalledTimes(1);
			expect(
				withNativeSource(
					"const recreated = true;",
					"after-close-failure.ts",
					({ sourceFile }) => sourceFile.text,
				),
			).toBe("const recreated = true;");
		} finally {
			closeSpy.mockRestore();
		}
	});

	it("preserves callback errors when snapshot disposal also fails", () => {
		closeNativeSourceAnalysis();
		const closeSpy = vi.spyOn(API.prototype, "close");
		const disposeSpy = vi
			.spyOn(Snapshot.prototype, "dispose")
			.mockImplementationOnce(function failBeforeDispose(this: Snapshot) {
				throw new Error("dispose failed");
			});

		try {
			expect(() =>
				withNativeSource(
					"const callbackFailure = true;",
					"callback-failure.ts",
					() => {
						throw new Error("callback failed");
					},
				),
			).toThrowError("callback failed");
			expect(closeSpy).toHaveBeenCalledTimes(1);
		} finally {
			disposeSpy.mockRestore();
			closeSpy.mockRestore();
		}

		expect(
			withNativeSource(
				"const recreated = true;",
				"after-dispose-failure.ts",
				({ sourceFile }) => sourceFile.text,
			),
		).toBe("const recreated = true;");
	});

	it("surfaces snapshot disposal errors when the callback succeeds", () => {
		closeNativeSourceAnalysis();
		const closeSpy = vi.spyOn(API.prototype, "close");
		const disposeSpy = vi
			.spyOn(Snapshot.prototype, "dispose")
			.mockImplementationOnce(function failBeforeDispose(this: Snapshot) {
				throw new Error("dispose failed");
			});

		try {
			expect(() =>
				withNativeSource(
					"const disposalFailure = true;",
					"disposal-failure.ts",
					() => null,
				),
			).toThrowError("dispose failed");
			expect(closeSpy).toHaveBeenCalledTimes(1);
		} finally {
			disposeSpy.mockRestore();
			closeSpy.mockRestore();
		}

		expect(
			withNativeSource(
				"const recreated = true;",
				"after-cleanup-failure.ts",
				({ sourceFile }) => sourceFile.text,
			),
		).toBe("const recreated = true;");
	});

	it("uses separate invalidation and detail snapshots to preserve freshness", () => {
		closeNativeSourceAnalysis();
		withNativeSource("const initial = true;", "initial.ts", () => null);
		const updateSpy = vi.spyOn(API.prototype, "updateSnapshot");

		try {
			withNativeSource("const next = true;", "next.ts", () => null);
			withNativeSource("const final = true;", "final.ts", () => null);
			expect(updateSpy).toHaveBeenCalledTimes(4);
		} finally {
			updateSpy.mockRestore();
		}
	});

	it("refreshes an unchanged source batch without an invalidation snapshot", () => {
		closeNativeSourceAnalysis();
		withNativeSource("const stable = true;", "stable.ts", () => null);
		const updateSpy = vi.spyOn(API.prototype, "updateSnapshot");

		try {
			withNativeSource("const stable = true;", "stable.ts", () => null);
			expect(updateSpy).toHaveBeenCalledTimes(1);
		} finally {
			updateSpy.mockRestore();
		}
	});

	it.each([1, 2] as const)(
		"invalidates and closes the runtime when changed-source updateSnapshot call %s fails before returning",
		(failingCall) => {
			closeNativeSourceAnalysis();
			withNativeSource("const initial = true;", "setup-initial.ts", () => null);
			const originalUpdateSnapshot = API.prototype.updateSnapshot;
			const originalClose = API.prototype.close;
			let updateCalls = 0;
			let closeCalls = 0;
			const disposeSpy = vi.spyOn(Snapshot.prototype, "dispose");
			const updateSpy = vi
				.spyOn(API.prototype, "updateSnapshot")
				.mockImplementation(function failSelectedUpdate(this: API, options) {
					updateCalls += 1;
					if (updateCalls === failingCall) {
						throw new Error(`setup update ${failingCall} failed`);
					}
					return originalUpdateSnapshot.call(this, options);
				});
			const closeSpy = vi
				.spyOn(API.prototype, "close")
				.mockImplementation(function countClose(this: API) {
					closeCalls += 1;
					originalClose.call(this);
					throw new Error("setup close failed");
				});

			try {
				expect(() =>
					withNativeSource(
						"const changed = true;",
						"setup-changed.ts",
						() => null,
					),
				).toThrowError(`setup update ${failingCall} failed`);
				expect(closeCalls).toBe(1);
				expect(disposeSpy).toHaveBeenCalledTimes(failingCall === 1 ? 0 : 1);

				updateSpy.mockRestore();
				closeSpy.mockRestore();
				disposeSpy.mockRestore();
				expect(
					withNativeSource(
						"const recovered = true;",
						`after-setup-update-${failingCall}.ts`,
						({ sourceFile }) => sourceFile.text,
					),
				).toBe("const recovered = true;");
			} finally {
				updateSpy.mockRestore();
				closeSpy.mockRestore();
				disposeSpy.mockRestore();
			}
		},
	);
});
