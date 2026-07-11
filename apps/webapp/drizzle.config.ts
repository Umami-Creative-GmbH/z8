import { defineConfig } from "drizzle-kit";
import { getPostgresSslConfig } from "./src/db/postgres-ssl";
import { withUtcPostgresSession } from "./src/db/postgres-utc";

process.env.TZ = "UTC";
const postgresOptions = withUtcPostgresSession({ options: process.env.PGOPTIONS }).options;
process.env.PGOPTIONS = postgresOptions;

export default defineConfig({
	out: "./drizzle",
	schema: ["./src/db/auth-schema.ts", "./src/db/schema/index.ts"],
	dialect: "postgresql",
	dbCredentials: {
		host: process.env.POSTGRES_HOST!,
		port: Number(process.env.POSTGRES_PORT!),
		database: process.env.POSTGRES_DB!,
		user: process.env.POSTGRES_USER!,
		password: process.env.POSTGRES_PASSWORD!,
		ssl: getPostgresSslConfig(),
	},
});
