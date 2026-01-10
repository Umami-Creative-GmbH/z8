import { defineConfig } from "drizzle-kit";

export default defineConfig({
	out: "./drizzle",
	schema: ["./src/db/auth-schema.ts", "./src/db/schema.ts"],
	dialect: "postgresql",
	dbCredentials: {
		host: process.env.POSTGRES_HOST!,
		port: Number(process.env.POSTGRES_PORT!),
		database: process.env.POSTGRES_DB!,
		user: process.env.POSTGRES_USER!,
		password: process.env.POSTGRES_PASSWORD!,
		ssl: false,
	},
});
