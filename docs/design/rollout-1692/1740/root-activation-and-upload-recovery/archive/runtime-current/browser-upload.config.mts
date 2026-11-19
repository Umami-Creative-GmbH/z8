import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from '../../apps/webapp/node_modules/vitest/dist/config.js';
import original from '../../apps/webapp/vitest.config';
// jsdom uses the exact installed browser distribution; the uploader and hooks remain real.
export default mergeConfig(original, defineConfig({
  resolve: { alias: { 'tus-js-client': fileURLToPath(new URL('../../node_modules/.pnpm/tus-js-client@4.3.1/node_modules/tus-js-client/lib.esm/browser/index.js', import.meta.url)) } },
  test: { server: { deps: { inline: [/@uppy\/tus/, /tus-js-client/] } } },
}));
