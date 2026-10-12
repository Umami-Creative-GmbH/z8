/**
 * Regenerates the API reference pages under content/docs/api-reference from
 * the webapp's committed OpenAPI spec (#763). Run after the spec changes:
 * `pnpm generate:api-reference` in apps/docs.
 */
import { generateFiles } from 'fumadocs-openapi';
import { createOpenAPI } from 'fumadocs-openapi/server';

await generateFiles({
  // The same spec src/lib/openapi.ts renders; a relative path keeps the
  // generated pages free of machine-specific paths.
  input: createOpenAPI({ input: ['../webapp/openapi/public-api-v1.json'] }),
  output: './content/docs/api-reference',
  per: 'operation',
  includeDescription: true,
});
