import path from 'node:path';
import base from '../../apps/webapp/vitest.config';
const repo = path.resolve(__dirname, '../..').replaceAll('\\', '/');
export default { ...base, root: repo, test: { ...base.test, projects: [{ extends: true, test: { root: repo, name: 'unit', include: ['.tmp/merge1729-audit/employee-arrival.public.test.tsx'], exclude: [], env: { Z8_TEST_PROJECT: 'unit' }, setupFiles: [path.resolve(__dirname, '../../apps/webapp/src/test/unit-setup.ts').replaceAll('\\', '/')] } }] } };
