import type { RedisOptions } from "ioredis";

type RedisTlsOptions = NonNullable<RedisOptions["tls"]>;

export function createRedisTlsOptions(
	enabled: boolean,
	caCert: string | undefined,
): RedisTlsOptions | undefined {
	if (!enabled) {
		return undefined;
	}

	return caCert ? { ca: caCert } : {};
}
