import { resolve } from 'node:path';
import original from '../../apps/webapp/vitest.config';
const app=resolve(__dirname,'../../apps/webapp');
export default {
 ...original,root:resolve(__dirname,'../..'),
 test:{...original.test,
  alias:{...original.test?.alias,
   react:resolve(app,'node_modules/react'),
   vitest:resolve(app,'node_modules/vitest'),
   '@testing-library/react':resolve(app,'node_modules/@testing-library/react'),
   '@tolgee/react':resolve(app,'node_modules/@tolgee/react')},
  projects:[{extends:true,test:{name:'audit',include:['.tmp/merge1829-audit/arrival-races.test.tsx'],setupFiles:[resolve(app,'src/test/unit-setup.ts')],env:{Z8_TEST_PROJECT:'unit'}}}]
 }
};
