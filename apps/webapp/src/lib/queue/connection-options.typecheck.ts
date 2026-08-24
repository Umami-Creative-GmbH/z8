import type { ConnectionOptions } from "bullmq";
import { createRedisConnectionOptions } from "@/lib/redis-config";

declare const env: {
	REDIS_HOST?: string;
	REDIS_PORT?: string;
	REDIS_USERNAME?: string;
	REDIS_PASSWORD?: string;
	REDIS_TLS?: string;
	REDIS_CA_CERT?: string;
};

const connection: ConnectionOptions = {
	...createRedisConnectionOptions(env),
	maxRetriesPerRequest: null,
};

void connection;
