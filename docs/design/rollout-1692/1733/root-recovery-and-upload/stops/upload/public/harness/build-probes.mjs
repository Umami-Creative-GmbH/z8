import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
const out='.tmp/1733-command-checks/runtime';mkdirSync(out,{recursive:true});
let s=readFileSync('.tmp/1733-root-checks/runtime/command-probe.test.tsx','utf8').replaceAll('\r\n','\n');
s=s.slice(0,s.indexOf('it.each([false, true])'));
s=s.replace('fetch: vi.fn(),','fetch: vi.fn(),\n success: vi.fn(), error: vi.fn(),');
s=s.replace('vi.mock("@/lib/auth-client",','vi.mock("sonner", () => ({toast:{success:boundary.success,error:boundary.error}}));\nvi.mock("@/lib/auth-client",');
s+=String.raw`
const scenarios = ["confirm", "edit"].flatMap(kind => ["success", "refusal", "rejection"].flatMap(outcome => ["hidden", "resumed"].map(settlement => ({kind,outcome,settlement}))));
it.each(scenarios)("independent $kind / $outcome / settle-$settlement guards requests until current readback", async ({kind,outcome,settlement}) => {
 let complete: ((v:unknown)=>void)|undefined, reject: ((e:Error)=>void)|undefined, read: ((v:unknown)=>void)|undefined;
 const action=kind==="confirm"?boundary.confirm:boundary.update;
 const fresh=readyPreview();fresh.files[0].fileName="authoritative.pdf";
 boundary.get.mockResolvedValue({success:true,data:readyPreview()});
 action.mockImplementationOnce(()=>new Promise((yes,no)=>{complete=yes;reject=no;}));
 action.mockResolvedValue({success:false,error:"Fresh deliberate refusal"});
 const sub=setup();
 const start=async()=>{
   if(kind==="confirm"){
     fireEvent.click(await screen.findByRole("button",{name:"Save 1 payslips"}));
     const decision=screen.queryByRole("button",{name:"Save payslips"});if(decision)fireEvent.click(decision);
   }else fireEvent.click(await screen.findByRole("checkbox",{name:/Include (100|authoritative)\.pdf/}));
 };
 try {
   await start();await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));
   sub.view.rerender(sub.tree("hidden"));sub.view.rerender(sub.tree("visible"));
   await waitFor(()=>expect(boundary.get).toHaveBeenCalledTimes(2));await waitFor(()=>expect(sub.client.isFetching()).toBe(0));
   const save=screen.getByRole("button",{name:"Save 1 payslips"});expect(save.hasAttribute("disabled")).toBe(true);
   fireEvent.click(save);const decision=screen.queryByRole("button",{name:"Save payslips"});if(decision)fireEvent.click(decision);
   expect(action).toHaveBeenCalledTimes(1);expect(kind==="confirm"?boundary.update:boundary.confirm).not.toHaveBeenCalled();
   if(settlement==="hidden")sub.view.rerender(sub.tree("hidden"));
   boundary.get.mockImplementationOnce(()=>new Promise(yes=>{read=yes;}));
   await act(async()=>{
     if(outcome==="rejection")reject!(new Error("Retired private diagnostic"));
     else complete!(outcome==="refusal"?{success:false,error:"Retired refusal"}:{success:true,data:{batch:readyPreview().batch,created:[],failed:[]}});
   });
   if(settlement==="hidden"){
     expect(boundary.get).toHaveBeenCalledTimes(2);sub.view.rerender(sub.tree("visible"));
   }
   await waitFor(()=>expect(read).toBeTypeOf("function"));
   expect(action).toHaveBeenCalledTimes(1);expect(screen.queryByText("authoritative.pdf")).toBeNull();
   const whileRead=screen.getByRole("button",{name:"Save 1 payslips"});expect(whileRead.hasAttribute("disabled")).toBe(true);fireEvent.click(whileRead);
   expect(action).toHaveBeenCalledTimes(1);
   await act(async()=>read!({success:true,data:fresh}));await screen.findByText("authoritative.pdf");
   await waitFor(()=>expect(screen.getByRole("button",{name:"Save 1 payslips"}).hasAttribute("disabled")).toBe(false));
   expect(boundary.success).not.toHaveBeenCalled();expect(boundary.error).not.toHaveBeenCalled();expect(screen.queryByRole("alert")).toBeNull();
   expect(action).toHaveBeenCalledTimes(1);await start();await waitFor(()=>expect(action).toHaveBeenCalledTimes(2));
 } finally {sub.view.unmount();await act(async()=>{complete?.({success:false,error:"Cleanup"});read?.({success:true,data:fresh});});sub.client.clear();}
});
it.each(["confirm","edit"])("independent %s failed retired readback gates stale preview and uses local Retry",async kind=>{
 let finish:((v:unknown)=>void)|undefined;
 boundary.get.mockResolvedValue({success:true,data:readyPreview()});
 const action=kind==="confirm"?boundary.confirm:boundary.update;
 action.mockImplementationOnce(()=>new Promise(yes=>finish=yes));const sub=setup();
 try {
   if(kind==="confirm"){fireEvent.click(await screen.findByRole("button",{name:"Save 1 payslips"}));fireEvent.click(screen.getByRole("button",{name:"Save payslips"}));}
   else fireEvent.click(await screen.findByRole("checkbox",{name:"Include 100.pdf"}));
   await waitFor(()=>expect(action).toHaveBeenCalledTimes(1));sub.view.rerender(sub.tree("hidden"));sub.view.rerender(sub.tree("visible"));
   await waitFor(()=>expect(boundary.get).toHaveBeenCalledTimes(2));await waitFor(()=>expect(sub.client.isFetching()).toBe(0));
   boundary.get.mockResolvedValueOnce({success:false,error:"Authoritative read failed"});
   await act(async()=>finish!({success:false,error:"Retired refusal"}));
   expect((await screen.findByRole("alert")).textContent).toContain("The payslip batch could not be loaded.");
   expect(screen.queryByText("100.pdf")).toBeNull();expect(screen.queryByRole("button",{name:"Save 1 payslips"})).toBeNull();
   fireEvent.click(screen.getByRole("button",{name:"Retry"}));await screen.findByText("100.pdf");
   await waitFor(()=>expect(sub.client.isFetching()).toBe(0));expect(action).toHaveBeenCalledTimes(1);
   expect(boundary.error).not.toHaveBeenCalled();expect(boundary.success).not.toHaveBeenCalled();
 } finally {sub.view.unmount();await act(async()=>finish?.({success:false,error:"Cleanup"}));sub.client.clear();}
});
`;
const files=[['command-probe.test.tsx','independent1733v2-command-probe.test.tsx',s],['heading-probe.test.tsx','independent1733v2-heading-probe.test.tsx',readFileSync('.tmp/1733-root-checks/runtime/heading-probe.test.tsx','utf8')]];
for(const [publicName,name,code]of files){const path='apps/webapp/src/components/personnel-file/'+name;assert.ok(!existsSync(path));writeFileSync(out+'/'+publicName,code);writeFileSync(path,code);}
writeFileSync(out+'/bridge-ownership.json',JSON.stringify({files:files.map(([publicName,name])=>({publicName,path:'apps/webapp/src/components/personnel-file/'+name}))},null,2)+'\n');
