import path from 'node:path';
import base from '../../../apps/webapp/vitest.config';
const repo=path.resolve(__dirname,'../../..').replaceAll('\\','/');
const app=path.resolve(repo,'apps/webapp');
const aliases=Object.fromEntries(['react','react-dom','@testing-library/react','vitest','@tolgee/react','next'].map(name=>[name,path.resolve(app,'node_modules',name).replaceAll('\\','/')]));
export default {...base,root:repo,test:{...base.test,alias:{...base.test?.alias,...aliases},projects:[{extends:true,test:{root:repo,name:'unit',include:['.tmp/1729-root-checks/acceptance/delete-activation.public.test.tsx'],exclude:[],env:{Z8_TEST_PROJECT:'unit'},setupFiles:[path.resolve(app,'src/test/unit-setup.ts').replaceAll('\\','/')]}}]}};
