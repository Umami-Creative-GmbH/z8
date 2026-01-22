import { createEnv } from "@t3-oss/env-nextjs";
import { z, type ZodError } from "zod";

export const env = createEnv({
  server: {
    // DATABASE_URL: z.string().url(), // Not used, using individual vars
    // Postgres connection details
    POSTGRES_HOST: z.string().optional(),
    POSTGRES_PORT: z.string().optional(),
    POSTGRES_DB: z.string().optional(),
    POSTGRES_USER: z.string().optional(),
    POSTGRES_PASSWORD: z.string().optional(),

    BETTER_AUTH_SECRET: z.string().min(1),
    // Valkey / Redis
    VALKEY_HOST: z.string().optional(),
    VALKEY_PORT: z.string().optional(),
    VALKEY_PASSWORD: z.string().optional(),
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.string().optional(),
    REDIS_PASSWORD: z.string().optional(),
    
    // AWS S3 / Object Storage
    S3_BUCKET: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.string().optional(),
    S3_PUBLIC_URL: z.string().optional(),
    
    // Worker / Jobs
    ENABLE_CRON_JOBS: z.string().optional(),
    WORKER_CONCURRENCY: z.string().optional(),
    
    // Vault
    VAULT_ADDR: z.string().optional(),
    VAULT_TOKEN: z.string().optional(),
    
    // Tolgee (Server side)
    TOLGEE_PROJECT_ID: z.string().optional(),
    TOLGEE_API_KEY: z.string().optional(),
    TOLGEE_API_URL: z.string().optional(),
    
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  },
  client: {
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
    NEXT_PUBLIC_MAIN_DOMAIN: z.string().optional(),
    NEXT_PUBLIC_TOLGEE_API_KEY: z.string().optional(),
    NEXT_PUBLIC_TOLGEE_API_URL: z.string().optional(),
  },
  runtimeEnv: {
    // DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_HOST: process.env.POSTGRES_HOST,
    POSTGRES_PORT: process.env.POSTGRES_PORT,
    POSTGRES_DB: process.env.POSTGRES_DB,
    POSTGRES_USER: process.env.POSTGRES_USER,
    POSTGRES_PASSWORD: process.env.POSTGRES_PASSWORD,

    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    VALKEY_HOST: process.env.VALKEY_HOST,
    VALKEY_PORT: process.env.VALKEY_PORT,
    VALKEY_PASSWORD: process.env.VALKEY_PASSWORD,
    REDIS_HOST: process.env.REDIS_HOST,
    REDIS_PORT: process.env.REDIS_PORT,
    REDIS_PASSWORD: process.env.REDIS_PASSWORD,

    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_REGION: process.env.S3_REGION,
    S3_FORCE_PATH_STYLE: process.env.S3_FORCE_PATH_STYLE,
    S3_PUBLIC_URL: process.env.S3_PUBLIC_URL,

    ENABLE_CRON_JOBS: process.env.ENABLE_CRON_JOBS,
    WORKER_CONCURRENCY: process.env.WORKER_CONCURRENCY,
    VAULT_ADDR: process.env.VAULT_ADDR,
    VAULT_TOKEN: process.env.VAULT_TOKEN,
    TOLGEE_PROJECT_ID: process.env.TOLGEE_PROJECT_ID,
    TOLGEE_API_KEY: process.env.TOLGEE_API_KEY,
    TOLGEE_API_URL: process.env.TOLGEE_API_URL,
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_MAIN_DOMAIN: process.env.NEXT_PUBLIC_MAIN_DOMAIN,
    NEXT_PUBLIC_TOLGEE_API_KEY: process.env.NEXT_PUBLIC_TOLGEE_API_KEY,
    NEXT_PUBLIC_TOLGEE_API_URL: process.env.NEXT_PUBLIC_TOLGEE_API_URL,
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
  emptyStringAsUndefined: true,
  onValidationError: (error: ZodError) => {
    console.error("❌ Invalid environment variables:");
    if (error && "errors" in error) {
      error.errors.forEach((e) => {
        console.error(`   - ${e.path.join(".")}: ${e.message}`);
      });
    } else {
      console.error(error);
    }
    process.exit(1);
  },
});
