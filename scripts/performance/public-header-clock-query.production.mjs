import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {readPublicHeaderClockDOM} from './public-header-clock.mjs';
const readMountedClockQueryState=_button=>readPublicHeaderClockDOM(null,false).dom.mountedClockQuery;
const require=createRequire(new URL('../../apps/webapp/package.json',import.meta.url));
assert.equal(process.env.NODE_ENV,'production');
const {JSDOM}=require('jsdom'),dom=new JSDOM('<main id="root"></main>',{url:'https://synthetic.invalid',pretendToBeVisual:true});
for(const name of ['window','document','Node','HTMLElement'])Object.defineProperty(globalThis,name,{value:dom.window[name],configurable:true});Object.defineProperty(globalThis,'navigator',{value:dom.window.navigator,configurable:true});
dom.window.HTMLElement.prototype.getClientRects=()=>[{}];
const React=require('react'),{createRoot}=require('react-dom/client'),{flushSync}=require('react-dom'),{QueryClient,QueryClientProvider,useQuery}=require('@tanstack/react-query');
let finish;const pending=new Promise(resolve=>{finish=resolve;}),client=new QueryClient({defaultOptions:{queries:{retry:false}}}),key=['time-clock','status'],OUT={hasEmployee:true,isClockedIn:false},IN={hasEmployee:true,isClockedIn:true};client.setQueryData(key,OUT);
function Probe(){const query=useQuery({queryKey:key,queryFn:()=>pending,staleTime:Infinity});return React.createElement('header',null,React.createElement('button',{id:'clock','aria-label':query.data.isClockedIn?'Clock Out':'Clock In'},query.data.isClockedIn?'IN':'OUT'));}
const root=createRoot(document.getElementById('root'));flushSync(()=>root.render(React.createElement(QueryClientProvider,{client},React.createElement(Probe))));
await new Promise(resolve=>setTimeout(resolve,0));const button=document.getElementById('clock'),initial=readMountedClockQueryState(button);assert.equal(initial.known,true);assert.equal(initial.fetchStatus,'idle');assert.equal(initial.cachedIsClockedIn,false);assert.equal(initial.observerCount,1);
const refetch=client.invalidateQueries({queryKey:key});await new Promise(resolve=>setTimeout(resolve,0));const before=client.getQueryState(key),busy=readMountedClockQueryState(button);assert.deepEqual(busy,{known:true,reason:'read-only-provider-query',queryStatus:'success',fetchStatus:'fetching',isInvalidated:true,cachedHasEmployee:true,cachedIsClockedIn:false,observerCount:1,failureCount:0});assert.equal(client.getQueryState(key),before);
finish(IN);await refetch;await new Promise(resolve=>setTimeout(resolve,0));const final=readMountedClockQueryState(button);assert.equal(final.known,true);assert.equal(final.cachedIsClockedIn,true);assert.equal(final.fetchStatus,'idle');
flushSync(()=>root.unmount());const detached=readMountedClockQueryState(button);assert.equal(detached.known,false);client.clear();dom.window.close();console.log(JSON.stringify({productionReactDOM:true,react:require('react/package.json').version,reactDOM:require('react-dom/package.json').version,initial,busy,final,detachedUnknown:true,actualUseTimeClock:false,scope:'production-fiber-availability-only'}));
