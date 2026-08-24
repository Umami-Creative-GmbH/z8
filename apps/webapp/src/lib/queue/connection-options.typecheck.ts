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

const redisConnectionOptions = createRedisConnectionOptions(env);
const connection: ConnectionOptions = {
	host: redisConnectionOptions.host,
	port: redisConnectionOptions.port,
	username: redisConnectionOptions.username,
	password: redisConnectionOptions.password,
	tls: redisConnectionOptions.tls,
	maxRetriesPerRequest: null,
};

void connection;
