import type { Node, SourceFile } from "typescript/unstable/ast";
import {
	createVirtualFileSystem,
	type FileSystem,
} from "typescript/unstable/fs";
import {
	API,
	type Checker,
	type Program,
	type Snapshot,
	type Symbol as TypeScriptSymbol,
} from "typescript/unstable/sync";

const CONFIG_FILE_NAME = "/__native_source_analysis__/tsconfig.json";
const CALLBACK_SCOPE_ERROR =
	"Native source analysis callback results must not escape callback-scoped TypeScript objects or lazy iterators";

interface NativeRuntime {
	api: API;
	fileSystem: FileSystem;
	projectOpen: boolean;
	sourceFileNames: Set<string>;
	sources: Map<string, string>;
}

export interface NativeSourceContext {
	checker: Checker;
	program: Program;
	sourceFile: SourceFile;
}

type DisallowedResult =
	| PromiseLike<unknown>
	| AsyncIterable<unknown>
	| Iterator<unknown>
	| CallableFunction
	| Node
	| Program
	| Checker
	| TypeScriptSymbol;
type IsAny<T> = 0 extends 1 & T ? true : false;
type ContainsDisallowedResult<T> =
	IsAny<T> extends true
		? true
		: [Extract<T, DisallowedResult>] extends [never]
			? false
			: true;
type SynchronousCallback<T> = ((context: NativeSourceContext) => T) &
	(ContainsDisallowedResult<T> extends true ? never : unknown);

let runtime: NativeRuntime | undefined;

function normalizeFileName(fileName: string): string {
	const segments: string[] = [];
	for (const segment of fileName.replaceAll("\\", "/").split("/")) {
		if (!segment || segment === ".") continue;
		if (segment === "..") {
			segments.pop();
			continue;
		}
		segments.push(segment);
	}
	return `/${segments.join("/")}`;
}

function getRuntime(): NativeRuntime {
	if (runtime) {
		return runtime;
	}

	const fileSystem = createVirtualFileSystem({});
	runtime = {
		api: new API({ fs: fileSystem }),
		fileSystem,
		projectOpen: false,
		sourceFileNames: new Set(),
		sources: new Map(),
	};
	return runtime;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
	return (
		((typeof value === "object" && value !== null) ||
			typeof value === "function") &&
		"then" in value &&
		typeof value.then === "function"
	);
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
	if (
		!(
			(typeof value === "object" && value !== null) ||
			typeof value === "function"
		)
	) {
		return false;
	}
	return (
		typeof (value as { [Symbol.asyncIterator]?: unknown })[
			Symbol.asyncIterator
		] === "function"
	);
}

function isPlainObject(value: object): boolean {
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function ownResultData(value: object): {
	hasAccessor: boolean;
	values: unknown[];
} {
	const descriptors = Object.getOwnPropertyDescriptors(value);
	const values: unknown[] = [];
	let hasAccessor = false;
	for (const key of Reflect.ownKeys(descriptors)) {
		const descriptor = Reflect.get(descriptors, key) as
			| PropertyDescriptor
			| undefined;
		if (!descriptor || !("value" in descriptor)) {
			hasAccessor = true;
		} else {
			values.push(descriptor.value);
		}
	}
	return { hasAccessor, values };
}

function hasOwnAccessor(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	return ownResultData(value).hasAccessor;
}

function isCallbackScopedResult(
	value: unknown,
	seen = new WeakSet<object>(),
): boolean {
	if (typeof value === "function") return true;
	if (typeof value !== "object" || value === null) return false;
	if (seen.has(value)) return false;
	seen.add(value);
	const { hasAccessor, values: ownValues } = ownResultData(value);
	let disallowed = hasAccessor;
	if (!hasAccessor && isPromiseLike(value)) {
		void Promise.resolve(value).then(
			() => undefined,
			() => undefined,
		);
		disallowed = true;
	}
	for (const item of ownValues) {
		if (isCallbackScopedResult(item, seen)) disallowed = true;
	}
	if (Array.isArray(value)) {
		return disallowed;
	}
	if (value instanceof Map) {
		for (const [key, item] of value) {
			if (isCallbackScopedResult(key, seen)) disallowed = true;
			if (isCallbackScopedResult(item, seen)) disallowed = true;
		}
		return disallowed;
	}
	if (value instanceof Set) {
		for (const item of value) {
			if (isCallbackScopedResult(item, seen)) disallowed = true;
		}
		return disallowed;
	}
	if (!isPlainObject(value)) return true;
	return disallowed;
}

function isAsyncFunction(
	callback: (context: NativeSourceContext) => unknown,
): boolean {
	const tag = Object.prototype.toString.call(callback);
	return (
		tag === "[object AsyncFunction]" ||
		tag === "[object AsyncGeneratorFunction]"
	);
}

function isGeneratorFunction(
	callback: (context: NativeSourceContext) => unknown,
): boolean {
	return (
		Object.prototype.toString.call(callback) === "[object GeneratorFunction]"
	);
}

function invalidateRuntime(currentRuntime: NativeRuntime): void {
	if (runtime === currentRuntime) {
		runtime = undefined;
	}
	try {
		currentRuntime.api.close();
	} catch {
		// The disposal failure remains the useful error; this close is best-effort cleanup.
	}
}

function disposeSnapshot(
	snapshot: Snapshot,
	currentRuntime: NativeRuntime,
	suppressError: boolean,
): void {
	try {
		snapshot.dispose();
	} catch (error) {
		invalidateRuntime(currentRuntime);
		if (!suppressError) {
			throw error;
		}
	}
}

/**
 * The callback must synchronously derive plain values without retaining remote TypeScript
 * objects. Remote and lazy values are rejected throughout arrays, maps, sets, and plain object
 * graphs without invoking accessors. Top-level unknown proxies may observe promise/async-iterator
 * probes after their own descriptors have been checked.
 */
export function withNativeProgram<T>(
	sources: ReadonlyMap<string, string>,
	entryFileName: string,
	callback: SynchronousCallback<T>,
): T {
	if (isAsyncFunction(callback)) {
		throw new Error("Native source analysis callbacks must be synchronous");
	}
	if (isGeneratorFunction(callback)) {
		throw new Error(CALLBACK_SCOPE_ERROR);
	}

	const normalizedEntryFileName = normalizeFileName(entryFileName);
	const normalizedSources = new Map<string, string>();
	const originalFileNames = new Map<string, string>();
	for (const [fileName, source] of sources) {
		const normalizedFileName = normalizeFileName(fileName);
		const originalFileName = originalFileNames.get(normalizedFileName);
		if (originalFileName !== undefined && originalFileName !== fileName) {
			throw new Error(
				`Native source path collision at ${normalizedFileName}: ${originalFileName}, ${fileName}`,
			);
		}
		originalFileNames.set(normalizedFileName, fileName);
		normalizedSources.set(normalizedFileName, source);
	}

	if (!normalizedSources.has(normalizedEntryFileName)) {
		throw new Error(
			`Native source entry is missing: ${normalizedEntryFileName}`,
		);
	}

	const currentRuntime = getRuntime();
	let snapshot: Snapshot | undefined;
	let setupComplete = false;
	let failed = false;
	try {
		const previousSourceFileNames = currentRuntime.sourceFileNames;
		const sourcesUnchanged =
			currentRuntime.sources.size === normalizedSources.size &&
			[...normalizedSources].every(
				([fileName, source]) => currentRuntime.sources.get(fileName) === source,
			);
		if (!sourcesUnchanged) {
			for (const previousFileName of previousSourceFileNames) {
				if (!normalizedSources.has(previousFileName)) {
					currentRuntime.fileSystem.removeFile?.(previousFileName);
				}
			}
			for (const [fileName, source] of normalizedSources) {
				currentRuntime.fileSystem.writeFile?.(fileName, source);
			}
			currentRuntime.fileSystem.writeFile?.(
				CONFIG_FILE_NAME,
				JSON.stringify({
					compilerOptions: {
						allowJs: true,
						module: "ESNext",
						moduleDetection: "force",
						noCheck: true,
						noLib: true,
						noResolve: true,
						target: "ESNext",
					},
					files: [...normalizedSources.keys()],
				}),
			);
		}
		currentRuntime.sourceFileNames = new Set(normalizedSources.keys());
		currentRuntime.sources = normalizedSources;

		if (currentRuntime.projectOpen) {
			if (!sourcesUnchanged) {
				const invalidationSnapshot = currentRuntime.api.updateSnapshot({
					fileChanges: { invalidateAll: true },
				});
				disposeSnapshot(invalidationSnapshot, currentRuntime, false);
			}
			snapshot = currentRuntime.api.updateSnapshot({
				fileChanges: {
					changed: sourcesUnchanged
						? []
						: [
								CONFIG_FILE_NAME,
								...[...normalizedSources.keys()].filter((fileName) =>
									previousSourceFileNames.has(fileName),
								),
							],
					created: [...normalizedSources.keys()].filter(
						(fileName) => !previousSourceFileNames.has(fileName),
					),
					deleted: [...previousSourceFileNames].filter(
						(fileName) => !normalizedSources.has(fileName),
					),
				},
			});
		} else {
			snapshot = currentRuntime.api.updateSnapshot({
				fileChanges: { invalidateAll: true },
				openProjects: [CONFIG_FILE_NAME],
			});
			currentRuntime.projectOpen = true;
		}
		currentRuntime.api.clearSourceFileCache();
		const project = snapshot.getProject(CONFIG_FILE_NAME);
		if (!project) {
			throw new Error(
				`Native project could not be retrieved for: ${normalizedEntryFileName}`,
			);
		}
		const sourceFile = project.program.getSourceFile(normalizedEntryFileName);
		if (!sourceFile) {
			throw new Error(
				`Native entry source could not be retrieved: ${normalizedEntryFileName}`,
			);
		}
		setupComplete = true;

		const result = callback({
			checker: project.checker,
			program: project.program,
			sourceFile,
		});
		const resultHasOwnAccessor = hasOwnAccessor(result);
		if (!resultHasOwnAccessor && isPromiseLike(result)) {
			void Promise.resolve(result).then(
				() => undefined,
				() => undefined,
			);
			throw new Error("Native source analysis callbacks must be synchronous");
		}
		if (!resultHasOwnAccessor && isAsyncIterable(result)) {
			throw new Error("Native source analysis callbacks must be synchronous");
		}
		if (isCallbackScopedResult(result)) {
			throw new Error(CALLBACK_SCOPE_ERROR);
		}
		return result;
	} catch (error) {
		failed = true;
		if (!setupComplete) invalidateRuntime(currentRuntime);
		throw error;
	} finally {
		if (snapshot) disposeSnapshot(snapshot, currentRuntime, failed);
	}
}

export function withNativeSource<T>(
	source: string,
	fileName: string,
	callback: SynchronousCallback<T>,
): T {
	return withNativeProgram(new Map([[fileName, source]]), fileName, callback);
}

export function closeNativeSourceAnalysis(): void {
	const currentRuntime = runtime;
	runtime = undefined;
	if (!currentRuntime) {
		return;
	}

	currentRuntime.api.close();
}
