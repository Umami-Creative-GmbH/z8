import path from 'node:path';
import base from '../../apps/webapp/vitest.config';
export default { ...base, test: { ...base.test, projects: [{ extends: true, test: { name: 'unit', include: [path.resolve(__dirname, 'employee-arrival.public.test.tsx')], env: { Z8_TEST_PROJECT: 'unit' }, setupFiles: [path.resolve(__dirname, '../../apps/webapp/src/test/unit-setup.ts')] } }] } };
