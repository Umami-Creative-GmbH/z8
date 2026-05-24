import type { RedisOptions } from "ioredis";

type RedisTlsOptions = NonNullable<RedisOptions["tls"]>;

type RedisConnectionEnv = {
	REDIS_HOST?: string;
	REDIS_PORT?: string;
	REDIS_USERNAME?: string;
	REDIS_PASSWORD?: string;
	REDIS_TLS?: string;
	REDIS_CA_CERT?: string;
};

export function createRedisTlsOptions(
	enabled: boolean,
	caCert: string | undefined,
): RedisTlsOptions | undefined {
	if (!enabled) {
		return undefined;
	}

	return { ca: caCert };
}

export function createRedisConnectionOptions(env: RedisConnectionEnv): RedisOptions {
	return {
		host: env.REDIS_HOST || "localhost",
		port: Number(env.REDIS_PORT || 6379),
		username: env.REDIS_USERNAME || undefined,
		password: env.REDIS_PASSWORD || undefined,
		tls: createRedisTlsOptions(env.REDIS_TLS === "true", env.REDIS_CA_CERT),
	};
}
