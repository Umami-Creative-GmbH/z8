import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type Redis from "ioredis";

export const SETUP_KEY = "z8:{setup-bootstrap}:code";
export const SETUP_SESSION_KEY = "z8:{setup-bootstrap}:session";
const CODE_LIFETIME_SECONDS = 60 * 60;
const SESSION_LIFETIME_SECONDS = 10 * 60;
const SECRET_PATTERN = /^[a-f0-9]{64}$/;

// Redis owns the clock and all TTL arithmetic. Both keys share a cluster hash slot.
const initializeScript = `
if redis.call('EXISTS', KEYS[1]) == 0 then
  redis.call('DEL', KEYS[2])
  redis.call('HSET', KEYS[1], 'code', ARGV[1], 'exchanged', '0')
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
local ttl = redis.call('PTTL', KEYS[1])
if ttl <= 0 then return redis.error_reply('Invalid bootstrap expiry') end
return {redis.call('HGET', KEYS[1], 'code'), math.floor(ttl / 1000), redis.call('HGET', KEYS[1], 'exchanged')}
`;

const exchangeScript = `
local ttl = math.min(math.floor(redis.call('PTTL', KEYS[1]) / 1000), tonumber(ARGV[3]))
if ttl <= 0 or redis.call('HGET', KEYS[1], 'code') ~= ARGV[1]
  or redis.call('HGET', KEYS[1], 'exchanged') ~= '0' then return 0 end
redis.call('SET', KEYS[2], ARGV[2], 'EX', ttl)
redis.call('HSET', KEYS[1], 'exchanged', '1')
return ttl
`;

const authorizeScript = `
if redis.call('PTTL', KEYS[1]) <= 0 or redis.call('PTTL', KEYS[2]) <= 0
  or redis.call('HGET', KEYS[1], 'exchanged') ~= '1' then return 0 end
if redis.call('GET', KEYS[2]) == ARGV[1] then return 1 end
return 0
`;

const invalidateScript = "return redis.call('DEL', KEYS[1], KEYS[2])";

interface BootstrapDependencies {
	redis: Pick<Redis, "eval">;
	ready: () => Promise<boolean>;
	isConfigured: () => Promise<boolean>;
}

export function createSetupBootstrap({
	redis,
	ready,
	isConfigured,
}: BootstrapDependencies) {
	async function evaluate(script: string, ...args: (string | number)[]) {
		try {
			if (!(await ready())) throw new Error("Redis unavailable");
			return await redis.eval(script, 2, SETUP_KEY, SETUP_SESSION_KEY, ...args);
		} catch {
			// Redis errors may contain command arguments. Never propagate those secrets.
			throw new Error("Setup authorization unavailable");
		}
	}

	async function authorizeRedisSession(
		token: string | undefined,
	): Promise<boolean> {
		if (!token || !SECRET_PATTERN.test(token)) return false;
		const digest = createHash("sha256").update(token).digest("hex");
		return (await evaluate(authorizeScript, digest)) === 1;
	}

	return {
		// Called by instrumentation at real server startup only, never by a public request.
		initialize: async () => {
			if (await isConfigured()) return null;
			const result = await evaluate(
				initializeScript,
				randomBytes(32).toString("hex"),
				CODE_LIFETIME_SECONDS,
			);
			if (
				!Array.isArray(result) ||
				typeof result[0] !== "string" ||
				!SECRET_PATTERN.test(result[0]) ||
				typeof result[1] !== "number" ||
				!["0", "1"].includes(result[2])
			) {
				throw new Error("Setup authorization unavailable");
			}
			return {
				code: result[0],
				remainingSeconds: result[1],
				exchanged: result[2] === "1",
			};
		},
		exchange: async (code: string) => {
			if (!SECRET_PATTERN.test(code) || (await isConfigured())) return null;
			const token = randomBytes(32).toString("hex");
			const digest = createHash("sha256").update(token).digest("hex");
			const maxAge = await evaluate(
				exchangeScript,
				code,
				digest,
				SESSION_LIFETIME_SECONDS,
			);
			if (
				typeof maxAge !== "number" ||
				maxAge <= 0 ||
				maxAge > SESSION_LIFETIME_SECONDS
			)
				return null;
			return { token, maxAge };
		},
		authorize: async (token: string | undefined): Promise<boolean> => {
			if (!token || !SECRET_PATTERN.test(token) || (await isConfigured()))
				return false;
			return authorizeRedisSession(token);
		},
		/**
		 * Trusted setup-service API only: the caller MUST hold the setup advisory
		 * lock and have checked for an existing admin using that same transaction.
		 * Rechecks Redis identity/expiry without acquiring another DB connection.
		 * Request handlers must use authorize(), which also checks the database.
		 */
		authorizeWithinSetupTransaction: authorizeRedisSession,
		invalidate: async (): Promise<void> => {
			await evaluate(invalidateScript);
		},
	};
}
