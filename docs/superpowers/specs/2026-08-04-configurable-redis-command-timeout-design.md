# Configurable Redis Command Timeout Design

## Goal

Allow deployments to tune the Redis connection and command timeout while retaining the current two-second behavior by default.

## Configuration

Add the optional server environment variable `REDIS_COMMAND_TIMEOUT_MS`. It accepts a positive integer represented as a string and defaults to `"2000"` when unset.

The validated value is exposed through `runtimeEnv` and converted to milliseconds when constructing the ioredis client. One value controls both `connectTimeout` and `commandTimeout`, preserving their existing alignment.

Invalid, zero, negative, and non-integer values fail environment validation rather than producing an invalid Redis client configuration.

## Testing

Environment tests cover the default and a custom valid value. Redis client tests verify that the configured value is passed to both timeout options.
