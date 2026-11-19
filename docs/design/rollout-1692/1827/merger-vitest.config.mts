import {defineConfig} from '../../apps/webapp/node_modules/vitest/dist/config.js';
import original from '../../apps/webapp/vitest.config.ts';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../',import.meta.url));
const packagePath=(p:string)=>fileURLToPath(new URL('../../apps/webapp/node_modules/'+p,import.meta.url));
export default defineConfig({...original,root,resolve:{alias:{react:packagePath('react'),'react-dom':packagePath('react-dom'),'@testing-library/react':packagePath('@testing-library/react'),'@testing-library/user-event':packagePath('@testing-library/user-event'),'@tolgee/react':packagePath('@tolgee/react'),'@tanstack/react-query':packagePath('@tanstack/react-query'),sonner:packagePath('sonner'),vitest:packagePath('vitest')}},test:{...original.test,setupFiles:[fileURLToPath(new URL('../../apps/webapp/src/test/unit-setup.ts',import.meta.url))],projects:[{extends:true,test:{...original.test.projects[0].test,name:'audit',include:['.tmp/merge1827-audit/adversarial.test.tsx','.tmp/merge1727-audit/adversarial.test.tsx'],setupFiles:[fileURLToPath(new URL('../../apps/webapp/src/test/unit-setup.ts',import.meta.url))]}}]}});
