import React from "react";
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {createRequire} from "node:module";
import path from "node:path";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import {act,cleanup,render,screen,waitFor} from "@testing-library/react";
import {afterAll,afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({status:vi.fn(),post:vi.fn()}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions",()=>({getTimeClockStatus:mocks.status,addBreakToActiveSession:vi.fn(),updateTimeEntryNotes:vi.fn(),startBreakInProgress:vi.fn(),resumeBreakInProgress:vi.fn()}));
vi.mock("@/hooks/use-offline-clock",()=>({useOfflineClock:()=>({isOnline:true,isOffline:false,pendingCount:0,waitingCount:0,isSyncing:false,queueClockEvent:vi.fn(),commandCapabilities:null,workerCommandVersions:[],submitClockCommand:vi.fn()})}));
vi.mock("@/lib/auth-client",()=>({useSession:()=>({data:{user:{id:"user-synthetic"},session:{activeOrganizationId:"org-synthetic"}}})}));
vi.mock("@/lib/time-tracking/position-capture/use-clock-position",()=>({useClockPosition:()=>({capture:async()=>({position:null,consentQuestion:null}),askAfterEvent:vi.fn()})}));
vi.mock("@/lib/time-tracking/time-clock-client",()=>({postClockIn:mocks.post,postClockOut:vi.fn()}));
vi.mock("@/lib/time-tracking/timezone-capture",()=>({getBrowserTimezone:()=>"Europe/Berlin"}));
import {readPublicHeaderClockDOM} from "./public-header-clock.mjs";
function observeMounted(_button:HTMLElement|null){return readPublicHeaderClockDOM(null,false).dom.mountedClockQuery;}
import {useTimeClock as headHook} from "../../apps/webapp/src/lib/query/use-time-clock";
import {useTimeClock as originalHook} from "@clock-original-hook";
const OUT={hasEmployee:true,employeeId:"employee-synthetic",isClockedIn:false,activeWorkPeriod:null};
const IN={...OUT,isClockedIn:true,activeWorkPeriod:{id:"period-synthetic",startTime:new Date("2026-10-28T08:00:00Z")}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return {promise,resolve};}
const requireApp=createRequire(path.resolve(__dirname,"../../apps/webapp/package.json")),queueFile=requireApp.resolve("next/dist/client/components/app-router-instance.js"),queueSource=readFileSync(queueFile,"utf8"),queueSHA=createHash("sha256").update(queueSource).digest("hex"),callFile=requireApp.resolve("next/dist/client/sequential-call-server.js"),callSource=readFileSync(callFile,"utf8"),callSHA=createHash("sha256").update(callSource).digest("hex");
// Execute the WHOLE unmodified installed CommonJS module. Only the router reducer
// transport boundary and unused navigator imports are inert. No FIFO code is copied.
function installedQueue(reducer:(state:unknown,action:any)=>unknown){
 const module={exports:{}};const realRequire=createRequire(queueFile);
 const requireBoundary=(name:string)=>{if(name==="react")return React;if(name==="./router-reducer/router-reducer")return {reducer};if(name==="./router-reducer/router-reducer-types"||name==="../../shared/lib/is-thenable")return realRequire(name);return {};};
 new Function("require","module","exports",queueSource)(requireBoundary,module,module.exports);
 const queue=(module.exports as {createMutableActionQueue:(state:unknown)=>any}).createMutableActionQueue({synthetic:true});
 const callModule={exports:{}};
 const requireCall=(name:string)=>{if(name==="react")return React;if(name==="./components/router-reducer/router-reducer-types")return realRequire("./router-reducer/router-reducer-types");if(name==="./components/use-action-queue")return {dispatchAppRouterAction:(action:unknown)=>queue.dispatch(action,()=>{})};throw Error("unexpected callServer dependency");};
 new Function("require","module","exports",callSource)(requireCall,callModule,callModule.exports);
 return {queue,callServer:(callModule.exports as {callServer:(id:string,args:unknown[])=>Promise<unknown>}).callServer};
}
const clients:QueryClient[]=[],facts:unknown[]=[];
beforeEach(()=>{vi.clearAllMocks();vi.spyOn(HTMLElement.prototype,"getClientRects").mockReturnValue([{}] as any);});afterEach(()=>{cleanup();vi.restoreAllMocks();for(const client of clients)client.clear();clients.length=0;});
for(const [phase,useClock]of [["original-c6ee",originalHook],["head-5ac",headHook]]as const){describe(phase,()=>{
 for(const heldHead of [true,false])it(`installed FIFO ${heldHead?"blocks":"does not block"} status transport after accepted REST`,async()=>{
  const timeline:string[]=[],dashboard=deferred<{success:true,data:never[]}>(),status=deferred<typeof IN>();let statusTransportStarts=0,dashboardTransportStarts=0;
  const {queue,callServer}=installedQueue((state,action)=>{if(action.actionId==="synthetic-dashboard-birthdays"){dashboardTransportStarts++;timeline.push("dashboard-transport-start");return dashboard.promise.then(value=>{timeline.push("dashboard-reducer-settled");action.resolve(value);return state;});}if(action.actionId==="synthetic-clock-status"){statusTransportStarts++;timeline.push("status-transport-start");return status.promise.then(value=>{timeline.push("status-reducer-settled");action.resolve(value);return state;});}throw Error("unexpected action");});
  const call=(id:string)=>{timeline.push(id==="synthetic-clock-status"?"status-enqueue":"dashboard-enqueue");return callServer(id,[]);};
  let dashboardCall:Promise<unknown>|null=null;if(heldHead)dashboardCall=call("synthetic-dashboard-birthdays");
  mocks.status.mockImplementation(()=>call("synthetic-clock-status"));mocks.post.mockImplementation(async()=>{timeline.push("REST-write-accepted");return {success:true,data:{id:"entry-synthetic"}};});
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});clients.push(client);client.setQueryData(["time-clock","status"],OUT);const wrapper=({children}:{children:React.ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const first={current:null as any},second={current:null as any};function Consumer({target,id}:{target:any,id:string}){target.current=useClock();return <header><button aria-label={target.current.isClockedIn?"Clock Out":"Clock In"} data-testid={id}>{target.current.isClockedIn?"IN":"OUT"}</button></header>;}render(<><Consumer target={first} id="first"/><Consumer target={second} id="second"/></>,{wrapper});const button=screen.getByTestId("first");let mutationReturned=false;
  await act(async()=>{await first.current.clockIn({browserTimezone:"Europe/Berlin"});timeline.push("mutateAsync-return");mutationReturned=true;});
  expect(mutationReturned).toBe(true);expect(mocks.post).toHaveBeenCalledTimes(1);expect(mocks.status).toHaveBeenCalledTimes(1);expect(first.current.isClockedIn).toBe(false);expect(second.current.isClockedIn).toBe(false);await waitFor(()=>{expect(first.current.isFetching).toBe(true);expect(second.current.isFetching).toBe(true);});
  const beforeState=client.getQueryState(["time-clock","status"]),cache=client.getQueryCache(),query=cache.get('["time-clock","status"]')!,beforeObservers=query.getObserversCount(),beforeQueries=cache.getAll().length,beforePending=queue.pending;
  const forbidden=["invalidateQueries","cancelQueries","refetchQueries","fetchQuery","setQueryData"].map(name=>vi.spyOn(client,name as any));for(const spy of forbidden)spy.mockClear();const subscribe=vi.spyOn(cache,"subscribe"),addObserver=vi.spyOn(query,"addObserver");
  const observations=Array.from({length:10},()=>observeMounted(button));for(const row of observations)expect(row).toEqual({known:true,reason:"read-only-provider-query",queryStatus:"success",fetchStatus:"fetching",isInvalidated:true,cachedHasEmployee:true,cachedIsClockedIn:false,observerCount:2,failureCount:0});
  expect(client.getQueryState(["time-clock","status"])).toBe(beforeState);expect(query.getObserversCount()).toBe(beforeObservers);expect(cache.getAll()).toHaveLength(beforeQueries);expect(queue.pending).toBe(beforePending);expect(mocks.status).toHaveBeenCalledTimes(1);for(const spy of forbidden){expect(spy).not.toHaveBeenCalled();spy.mockRestore();}expect(subscribe).not.toHaveBeenCalled();expect(addObserver).not.toHaveBeenCalled();subscribe.mockRestore();addObserver.mockRestore();
  const startsBeforeHeadRelease=statusTransportStarts;expect(startsBeforeHeadRelease).toBe(heldHead?0:1);expect(dashboardTransportStarts).toBe(heldHead?1:0);
  if(heldHead){expect(queue.pending.payload.actionId).toBe("synthetic-dashboard-birthdays");expect(queue.pending.next.payload.actionId).toBe("synthetic-clock-status");await act(async()=>{timeline.push("release-only-dashboard-head");dashboard.resolve({success:true,data:[]});await dashboardCall;});}
  expect(statusTransportStarts).toBe(1);expect(first.current.isClockedIn).toBe(false);expect(second.current.isClockedIn).toBe(false);
  await act(async()=>{timeline.push("status-IN-result");status.resolve(IN);});await waitFor(()=>{expect(first.current.isClockedIn).toBe(true);expect(second.current.isClockedIn).toBe(true);});expect(queue.pending).toBe(null);expect(mocks.post).toHaveBeenCalledTimes(1);expect(mocks.status).toHaveBeenCalledTimes(1);
  expect(observeMounted(button)).toEqual({known:true,reason:"read-only-provider-query",queryStatus:"success",fetchStatus:"idle",isInvalidated:false,cachedHasEmployee:true,cachedIsClockedIn:true,observerCount:2,failureCount:0});
  facts.push({phase,heldHead,timeline,passiveObservation:observations[0],reads:10,readOnly:true,consumers:2,clockWrites:1,statusQueryCalls:1,startsBeforeHeadRelease,statusTransportStarts,finalBothIN:true,forcedCancel:false,injectedRefreshError:false});
 });
});}

it("absent and multiple mounted providers remain diagnostic UNKNOWN",()=>{const one=new QueryClient(),two=new QueryClient();clients.push(one,two);one.setQueryData(["time-clock","status"],OUT);two.setQueryData(["time-clock","status"],OUT);const outer=render(<header><button aria-label="Clock In" data-testid="absent">OUT</button></header>);expect(observeMounted(screen.getByTestId("absent")).known).toBe(false);outer.unmount();render(<QueryClientProvider client={one}><QueryClientProvider client={two}><header><button aria-label="Clock In" data-testid="multiple">OUT</button></header></QueryClientProvider></QueryClientProvider>);expect(observeMounted(screen.getByTestId("multiple"))).toMatchObject({known:false,reason:"provider-multiple"});expect(observeMounted(null)).toMatchObject({known:false});});

it("an absent status query is unknown and a real inactive query reports observed zero subscribers",()=>{const client=new QueryClient();clients.push(client);render(<QueryClientProvider client={client}><header><button aria-label="Clock In" data-testid="inactive">OUT</button></header></QueryClientProvider>);const button=screen.getByTestId("inactive");expect(observeMounted(button)).toMatchObject({known:false,reason:"query-absent",observerCount:null});client.setQueryData(["time-clock","status"],OUT);expect(observeMounted(button)).toMatchObject({known:true,fetchStatus:"idle",isInvalidated:false,observerCount:0});});
it("a shadowed read method getter is never executed and remains unknown",()=>{const client=new QueryClient();clients.push(client);client.setQueryData(["time-clock","status"],OUT);render(<QueryClientProvider client={client}><header><button aria-label="Clock In" data-testid="getter">OUT</button></header></QueryClientProvider>);let reads=0;Object.defineProperty(client,"getQueryState",{configurable:true,get(){reads++;throw Error("PRIVATE_SENTINEL");}});const result=observeMounted(screen.getByTestId("getter"));expect(result).toMatchObject({known:false,reason:"read-failed"});expect(reads).toBe(0);expect(JSON.stringify(result)).not.toMatch(/PRIVATE|employee|organization|period|Date|http/);delete (client as any).getQueryState;});

it("integrated callback reads only bounded own-data employee and failure scalars without supplying readiness",()=>{
 const client=new QueryClient();clients.push(client);const key=["time-clock","status"];client.setQueryData(key,{hasEmployee:false,isClockedIn:true,private:"PRIVATE_DATA"});
 render(<QueryClientProvider client={client}><header><button aria-label="Clock Out" data-testid="scalars">IN</button></header></QueryClientProvider>);
 const state=client.getQueryState(key)!;state.fetchFailureCount=3;const before=client.getQueryState(key),observation=readPublicHeaderClockDOM(null,false);
 expect(observation.value).toBe(null);expect(observation.dom.mountedClockQuery).toMatchObject({known:true,cachedHasEmployee:false,cachedIsClockedIn:true,failureCount:3,observerCount:0});expect(client.getQueryState(key)).toBe(before);
 let getters=0;Object.defineProperty(state.data,"hasEmployee",{configurable:true,get(){getters++;throw Error("PRIVATE_GETTER");}});
 expect(observeMounted(screen.getByTestId("scalars"))).toMatchObject({known:true,cachedHasEmployee:null});expect(getters).toBe(0);
 state.fetchFailureCount=10001;const unknown=observeMounted(screen.getByTestId("scalars"));expect(unknown).toMatchObject({known:false,reason:"state-unknown",failureCount:null});expect(JSON.stringify(unknown)).not.toMatch(/PRIVATE|employee-synthetic|period-synthetic/);
});

it("integrated callback bounds host properties and ancestor traversal and reports detached UNKNOWN",()=>{
 const client=new QueryClient();clients.push(client);client.setQueryData(["time-clock","status"],OUT);
 const view=render(<QueryClientProvider client={client}><header><button aria-label="Clock In" data-testid="bounds">OUT</button></header></QueryClientProvider>),button=screen.getByTestId("bounds");
 const fiberKey=Object.getOwnPropertyNames(button).find(key=>key.startsWith("__reactFiber$"))!,descriptor=Object.getOwnPropertyDescriptor(button,fiberKey)!;
 const chain=Array.from({length:97},(_,i)=>({tag:i===0?5:0,stateNode:i===0?button:null,return:null as unknown}));for(let i=0;i<chain.length-1;i++)chain[i].return=chain[i+1];
 Object.defineProperty(button,fiberKey,{...descriptor,value:chain[0]});try{expect(observeMounted(button)).toMatchObject({known:false,reason:"current-fiber-unknown"});}finally{Object.defineProperty(button,fiberKey,descriptor);}
 for(let i=0;i<33;i++)Object.defineProperty(button,"boundedDiagnostic"+i,{value:0,configurable:true});expect(observeMounted(button)).toMatchObject({known:false,reason:"host-bound"});for(let i=0;i<33;i++)delete (button as any)["boundedDiagnostic"+i];
 view.unmount();expect(observeMounted(button)).toMatchObject({known:false});
});
