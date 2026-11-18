from review import *
src=(ROOT/'apps/webapp/src/components/travel-expenses/legacy-draft-conversion-consumers.test.tsx').read_text()
src=src.replace('import { LegacyClaimActions } from "./legacy-draft-conversion";', 'import { TravelExpenseList } from "@/components/travel-expenses/travel-expense-list";')
src=src.replace('from "./travel-expense-management"','from "@/components/travel-expenses/travel-expense-management"')
src=src.replace('<LegacyClaimActions claim={claim} />','<TravelExpenseList claims={[{id:claim.id,type:"receipt",status:"draft",calculatedAmount:"120.50",calculatedCurrency:"EUR"}]} />')
src+='''
it.each(["history","retained list"])("positive assembled %s double activation converts once and navigates while current",async consumer=>{
 boundary.history.mockResolvedValue({success:true,data:[claim]});
 const pending=Promise.withResolvers<any>(); boundary.convert.mockReturnValueOnce(pending.promise);
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 const view=render(<QueryClientProvider client={client}>{consumer === "history" ? <TravelExpenseManagement organizationId="org-a" employeeId="employee-a"/> : <TravelExpenseList claims={[{id:claim.id,type:"receipt",status:"draft",calculatedAmount:"120.50",calculatedCurrency:"EUR"}]} />}</QueryClientProvider>);
 const button=await screen.findByRole("button",{name:"Continue as report"});
 act(()=>{button.click();button.click();}); await vi.waitFor(()=>expect(boundary.convert).toHaveBeenCalledTimes(1));
 await act(async()=>{pending.resolve({success:true,data:{kind:"converted",reportId:"current-report"}}); await pending.promise;});
 await vi.waitFor(()=>expect(boundary.push).toHaveBeenCalledExactlyOnceWith("/travel-expenses/reports/current-report"));
 view.unmount(); client.clear();
});
'''
p='apps/webapp/src/test/review1748-actual-consumers.test.tsx'; assert not (ROOT/p).exists(); (ROOT/p).write_text(src)
entries=json.loads((SAFE/'bridges.json').read_text()); b=(ROOT/p).read_bytes(); entries.append(dict(path=p,bytes=len(b),sha256=digest(b))); save('bridges.json',entries)
receipt=json.loads((ROOT/'docs/design/rollout-1692/1748/root-conversion-withdrawal-correction.json').read_text())
save('selection.json',dict(physicalFiles=receipt['commands']['compatibilityFiles'],inheritedRootCount=518,overlap='Must rerun; historical result is not acceptance.',quality=receipt['commands']['qualityScope']))
bin=OUT/'bin'; bin.mkdir(exist_ok=True)
(bin/'pnpm').write_text('#!/usr/bin/env bash\nexec /c/Users/KaiHentschel/AppData/Local/pnpm/bin/pnpm --config.verify-deps-before-run=false "$@"\n')
