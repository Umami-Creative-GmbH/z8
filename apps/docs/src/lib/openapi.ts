import { createOpenAPI } from 'fumadocs-openapi/server';

/**
 * The Z8 Public API v1 spec (#763). The webapp generates it from its route
 * schemas and commits it; the docs render it as the API reference. The path is
 * relative to apps/docs and is also the schema id the generated pages name.
 */
export const PUBLIC_API_SPEC = '../webapp/openapi/public-api-v1.json';

export const openapi = createOpenAPI({ input: [PUBLIC_API_SPEC] });
