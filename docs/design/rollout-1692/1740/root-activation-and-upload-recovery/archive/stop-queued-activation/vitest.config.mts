import base from '../../apps/webapp/vitest.config';
import { fileURLToPath } from 'node:url';
export default {
  ...base,
  root: fileURLToPath(new URL('../../apps/webapp', import.meta.url)),
  test: {
    ...base.test,
    projects: [{extends: true, test: {
      name: 'unit',
      include: [fileURLToPath(new URL('./public-acceptance.test.tsx', import.meta.url))],
      setupFiles: ['./src/test/unit-setup.ts'],
      env: { Z8_TEST_PROJECT: 'unit' },
      testTimeout: 15000,
    }}],
  },
};
