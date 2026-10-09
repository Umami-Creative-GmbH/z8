import { createHash } from "node:crypto";
import type Redis from "ioredis";

type RatelimitRedis = {
	evalsha: <TArgs extends unknown[], TData = unknown>(
		sha: string,
		keys: string[],
		args: TArgs,
	) => Promise<TData>;
	eval: <TArgs extends unknown[], TData = unknown>(
		script: string,
		keys: string[],
		args: TArgs,
	) => Promise<TData>;
	get: <TData = string>(key: string) => Promise<TData | null>;
	set: (
		key: string,
		value: string,
		opts?: { ex?: number },
	) => Promise<string | null>;
};

/** Adapt Upstash scripts to standalone Redis/Valkey without changing their Lua body.
 * The removed hint is specific to Upstash. EVAL remains atomic on our cache servers.
 */
export function createRatelimitRedisAdapter(
	client: Pick<Redis, "evalsha" | "eval" | "get" | "set">,
): RatelimitRedis {
	const hashes = new Map<string, string>();
	return {
		evalsha: async <TArgs extends unknown[], TData = unknown>(
			sha: string,
			keys: string[],
			args: TArgs,
		): Promise<TData> =>
			(await client.evalsha(
				hashes.get(sha) ?? sha,
				keys.length,
				...keys,
				...args.map(String),
			)) as TData,
		eval: async <TArgs extends unknown[], TData = unknown>(
			script: string,
			keys: string[],
			args: TArgs,
		): Promise<TData> => {
			const compatible = script.replace(
				/^#!lua flags=allow-key-locking\r?\n/,
				"",
			);
			const originalHash = createHash("sha1").update(script).digest("hex");
			const compatibleHash = createHash("sha1")
				.update(compatible)
				.digest("hex");
			hashes.set(originalHash, compatibleHash);
			return (await client.eval(
				compatible,
				keys.length,
				...keys,
				...args.map(String),
			)) as TData;
		},
		get: async <TData = string>(key: string) =>
			(await client.get(key)) as TData | null,
		set: async (key, value, opts) =>
			opts?.ex ? client.set(key, value, "EX", opts.ex) : client.set(key, value),
	};
}
