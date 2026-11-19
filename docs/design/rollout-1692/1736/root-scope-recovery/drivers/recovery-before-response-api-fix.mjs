import assert from "node:assert/strict";
import { join } from "node:path";
import { outputDir, sourceProof, fixtureFromPointer, normalSignIn, requireRoot, save, failure, sha, nextMcp } from "./common.mjs";

// From the repo, run: node <recovery.mjs> <private-pointer-path> <before|after> <unique-output-dir> [expected-after-ref]
// Source overlay/restoration and stopping/restarting Next belong to the caller.
const [pointer,phase,output,expectedRef] = process.argv.slice(2), out = await outputDir(output);
const result = {phase,status:"failed-setup",setupComplete:false,checks:[],consumers:[],browserErrors:[],interceptionErrors:[],cleanup:{},
 qualification:"Public header Refresh aborts only the actual GET /api/auth/context transport. No response body, query state, session or authority is invented. Corrected acceptance requires the local inline Retry to reissue the original GET, receive completed HTTP200 and recover its consumer. Historical phase reproduces settled scope-loading without Retry, then uses the public header Refresh to recover. Own ephemeral Chromium contexts use normal sign-in, with no cookie/state save, restore or transfer."};
const check = (name,condition) => {assert.ok(condition,name);result.checks.push(name);};
let browser,failed=false,activeConsumer;
try {
 result.source = await sourceProof(phase,expectedRef);
 const {runtime,fixture} = await fixtureFromPointer(pointer);
 const actorName=process.env.Z8_RUNTIME_ACTOR??"small-admin", actor=fixture.actors[actorName]; assert.ok(actor,"Expected existing generated admin actor");
 result.actor=actorName;
 const puppeteer=requireRoot("puppeteer-core");
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH??"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:true});
 for (const config of [
  {name:"project-reports",path:"/en/reports/projects",heading:"Project Reports",loading:"Loading the current report scope",failure:"The current report scope could not be loaded."},
  {name:"settings-share-links",path:"/en/settings/report-share-links",heading:"Report Share Links",loading:"Loading the current share-link scope",failure:"The current share-link scope could not be loaded."},
 ]) {
  const observation={...config,status:"failed-setup",setupComplete:false,requests:[],responses:[],transportFailures:[],captures:[],checks:[]};
  result.consumers.push(observation);activeConsumer=observation;
  const context=await browser.createBrowserContext(), page=await context.newPage();
  let abortContext=false;
  page.setDefaultTimeout(45000);await page.setViewport({width:1600,height:1000});
  page.on("pageerror",error=>result.browserErrors.push({consumer:config.name,message:error.message}));
  await page.setRequestInterception(true);
  page.on("request",request=>{
   const isContext=new URL(request.url()).pathname==="/api/auth/context";
   if(isContext) observation.requests.push({method:request.method(),mode:abortContext?"abort":"continue",at:new Date().toISOString()});
   void (isContext&&abortContext?request.abort("failed"):request.continue()).catch(error=>result.interceptionErrors.push(error.message));
  });
  page.on("response",response=>{
   if(new URL(response.url()).pathname==="/api/auth/context")
    observation.responses.push({status:response.status(),method:response.request().method(),at:new Date().toISOString()});
  });
  page.on("requestfailed",request=>{
   if(new URL(request.url()).pathname==="/api/auth/context")
    observation.transportFailures.push({method:request.method(),error:request.failure()?.errorText,at:new Date().toISOString()});
  });
  observation.auth=await normalSignIn(page,runtime,actor);
  await page.goto(runtime.origin+config.path,{waitUntil:"domcontentloaded",timeout:90000});
  const ready=async()=>{
   await page.waitForFunction(name=>{
    const main=document.querySelector("main");if(!main)return false;
    if(name==="project-reports")return [...main.querySelectorAll("button")].some(element=>element.checkVisibility()&&element.textContent.trim()==="Generate Report"&&!element.disabled);
    return main.innerText.includes("No share links yet.")||[...main.querySelectorAll("li button")].some(element=>element.checkVisibility()&&/\bviews?\b/.test(element.textContent));
   },{},config.name);
  };
  const clickRefresh=async()=>{
   await page.setViewport({width:1600,height:1000});
   await page.waitForFunction(()=>[...document.querySelectorAll('button[aria-label="Refresh data"]')].some(element=>element.checkVisibility()&&!element.disabled));
   for(const element of await page.$$('button[aria-label="Refresh data"]')){
    if(await element.evaluate(element=>element.checkVisibility()&&!element.disabled)){
     observation.refreshActivations??=[];
     await element.focus();
     const focused=await element.evaluate(element=>({focused:document.activeElement===element,label:element.getAttribute('aria-label'),disabled:element.disabled,busy:element.getAttribute('aria-busy')}));
     observation.refreshActivations.push(focused);assert.equal(focused.focused,true,'Real keyboard Refresh focus');
     await page.keyboard.press('Enter');return;
    }
   }
   throw new Error("No visible enabled public header Refresh");
  };
  const capture=async state=>{
   for(const [width,height,size] of [[1600,1000,"desktop"],[390,844,"phone"]]){
    await page.setViewport({width,height});await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>{
     const key=JSON.stringify({width:innerWidth,scroll:document.documentElement.scrollWidth,headings:[...document.querySelectorAll('main h1')].filter(element=>element.checkVisibility()).map(element=>{const r=element.getBoundingClientRect();return[element.textContent,r.x,r.y,r.width];})});
     const previous=window.__root1736Geometry,now=performance.now();
     if(!previous||previous.key!==key){window.__root1736Geometry={key,at:now};return false;}
     return now-previous.at>=300;
    },{polling:100,timeout:10000});
    const measure=()=>page.evaluate(()=>({path:location.pathname,viewport:{width:innerWidth,height:innerHeight},documentWidth:document.documentElement.scrollWidth,
     headings:[...document.querySelectorAll("main h1")].filter(element=>element.checkVisibility()).map(element=>({text:element.textContent.trim(),x:element.getBoundingClientRect().x,y:element.getBoundingClientRect().y,width:element.getBoundingClientRect().width})),
     mainText:document.querySelector("main")?.innerText??"",rootFont:getComputedStyle(document.documentElement).fontSize,
     statuses:[...document.querySelectorAll("main [role=status]")].filter(element=>element.checkVisibility()).map(element=>element.textContent.trim()),
     inlineRetries:[...document.querySelectorAll('main [role="alert"] button')].filter(element=>element.checkVisibility()&&element.textContent.trim()==="Retry").map(element=>({disabled:element.disabled,busy:element.getAttribute("aria-busy")}))}));
    const first=await measure();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const second=await measure();
    assert.equal(first.path,config.path);assert.deepEqual(first.headings,second.headings,"Settled task heading geometry");assert.equal(first.documentWidth,second.documentWidth);
    assert.equal(first.headings.length,1,"One task heading");assert.equal(first.headings[0].text,config.heading);assert.ok(first.documentWidth<=width,"No page horizontal overflow");
    const name=phase+"-"+config.name+"-"+state+"-"+size+".png",bytes=await page.screenshot({path:join(out,name)});
    observation.captures.push({name,state,sha256:sha(bytes),measurement:second,source:result.source});
   }
  };
  await ready();observation.setupComplete=true;observation.status="running";result.setupComplete=true;
  await capture("ready");abortContext=true;
  const failedRequest=page.waitForRequest(request=>new URL(request.url()).pathname==="/api/auth/context",{timeout:45000});
  await clickRefresh();await failedRequest;
  await page.waitForFunction(()=>[...document.querySelectorAll('button[aria-label="Refresh data"]')].some(element=>element.checkVisibility()&&!element.disabled));
  check(config.name+": actual context transport failed",observation.transportFailures.length>=1);
  if(phase==="after"){
   await page.waitForFunction(message=>document.querySelector("main")?.innerText.includes(message),{},config.failure);
   await page.waitForFunction(()=>[...document.querySelectorAll('main [role="alert"] button')].some(element=>element.checkVisibility()&&element.textContent.trim()==="Retry"&&!element.disabled));
   await capture("scope-failure");
   abortContext=false;
   const recoveredResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/auth/context"&&response.status()===200,{timeout:45000});
   const retry=await page.waitForSelector('main [role="alert"] button');
   assert.equal(await retry.evaluate(element=>element.textContent.trim()),"Retry");
   await retry.click();const response=await recoveredResponse;assert.equal(await response.finished(),null,"Actual context HTTP200 completed without transport error");
   await ready();check(config.name+": inline Retry completed original HTTP200 and recovered",response.status()===200);
   await capture("recovered");observation.status="accepted-recovery";
  }else{
   await page.waitForFunction(text=>document.querySelector("main")?.innerText.includes(text),{},config.loading);
   await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,1000)));
   check(config.name+": exact historical consumer remains on scope loading after completed failed transport",await page.evaluate(text=>
    document.querySelector("main")?.innerText.includes(text)&&![...document.querySelectorAll("main button")].some(element=>element.checkVisibility()&&element.textContent.trim()==="Retry"),config.loading));
   await capture("scope-stuck");
   abortContext=false;
   const recoveredResponse=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/auth/context"&&response.status()===200,{timeout:45000});
   await clickRefresh();const response=await recoveredResponse;assert.equal(await response.finished(),null,"Actual context HTTP200 completed without transport error");await ready();
   observation.recoveryQualification="Historical consumer has no inline Retry. A second external header Refresh recovers via unchanged HTTP200 solely to complete cleanup and demonstrate the provider/transport remain usable.";
   observation.status="accepted-defect-reproduction";
  }
  observation.next=await nextMcp(runtime.origin);
  await context.close();observation.cleanup="Own ephemeral browser context closed";
 }
 check("No browser exceptions",result.browserErrors.length===0);
 check("No interception infrastructure errors",result.interceptionErrors.length===0);
 result.sourceAtEnd=await sourceProof(phase,expectedRef);assert.deepEqual(result.source.source,result.sourceAtEnd.source,"Source bytes remained stable for this run");
 result.status=phase==="before"?"accepted-defect-reproduction":"accepted-recovery";
}catch(error){
 failed=true;result.status=result.setupComplete?"failed-run":"failed-setup";result.failure=failure(error);
 if(activeConsumer)activeConsumer.status=activeConsumer.setupComplete?"failed-run":"failed-setup";
}finally{
 if(browser)try{await browser.close();result.cleanup.browser="Own launched Chromium closed";}catch(error){failed=true;result.status="failed-cleanup";result.cleanup.failure=failure(error);}
 await save(out,"runtime-"+(phase??"unknown")+".json",result);
}
console.log(JSON.stringify({phase,status:result.status,consumers:result.consumers.map(item=>({name:item.name,status:item.status,failedTransport:item.transportFailures.length,responseStatuses:item.responses.map(value=>value.status),captures:item.captures.length}))}));
if(failed)process.exitCode=1;

