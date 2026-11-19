import subprocess,pathlib,os,json,hashlib
root=pathlib.Path.cwd();s=pathlib.Path(os.environ['TEMP'])/'z8-r165-review-bceb0ee-SAFE';folder=root/'apps/webapp/src/components/travel-expenses';pins=[]
for relative,dest in [('travel-expense-management.tsx','r165-root-management.tsx'),('expense-history.tsx','r165-root-expense-history.tsx'),('report/new-receipt-expense-button.tsx','report/r165-root-new-buttons.tsx')]:
 path='apps/webapp/src/components/travel-expenses/'+relative;raw=subprocess.check_output(['git','show','bceb0ee32ca64e1d0fcf36906e89b0509665c479:'+path]);(s/('root-'+pathlib.Path(relative).name)).write_bytes(raw)
 bridge=raw
 if relative=='travel-expense-management.tsx':bridge=bridge.replace(b'from "./expense-history"',b'from "./r165-root-expense-history"').replace(b'from "./report/new-receipt-expense-button"',b'from "./report/r165-root-new-buttons"')
 (folder/dest).write_bytes(bridge);pins.append({'path':str(folder/dest),'sha256':hashlib.sha256(bridge).hexdigest(),'source':path,'rootRawSha256':hashlib.sha256(raw).hexdigest(),'gitBlob':hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()})
raw=(s/'r165-review-priority.test.tsx').read_text(encoding='utf-8-sig');raw=raw[:raw.index('it.each(')]
raw+='''
import { TravelExpenseManagement as RootManagement } from './r165-root-management';
it('initial canonical refusal remains unknown and local Retry restores only fresh evidence',async()=>{
 edge.history.mockResolvedValueOnce({success:false,error:'Unauthorized'}); mount();
 await screen.findByRole('alert'); expect(screen.queryByText('Public fixture receipt')).toBeNull();
 expect(screen.queryByText('No travel expenses yet')).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Retry'}));
 expect(await screen.findByText('Public fixture receipt')).toBeTruthy();
 expect(edge.history).toHaveBeenCalledTimes(2);
});
it.each(['incoming','premerge-root'] as const)('minimal repeat and classification %s: refusal then outage cannot retain retired rows; fresh success recovers',async(owner)=>{
 mount(owner==='premerge-root'?<RootManagement organizationId='fixture-org' employeeId='fixture-employee'/>:undefined);
 await screen.findByText('Public fixture receipt');
 edge.history.mockResolvedValueOnce({success:false,error:'Unauthorized'});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Review header refresh'}));await new Promise(r=>setTimeout(r,25));});
 await screen.findByRole('alert');
 const afterRefusal=Boolean(screen.queryByRole('link',{name:'Public fixture receipt'}));
 edge.history.mockRejectedValueOnce(new Error('Fixture transport offline'));
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Retry'}));await new Promise(r=>setTimeout(r,25));});
 await screen.findByRole('alert');
 const afterOutage=Boolean(screen.queryByRole('link',{name:'Public fixture receipt'}));
 edge.history.mockResolvedValueOnce({success:true,data:[{...row,title:'Fresh authorized fixture'}]});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Retry'}));await new Promise(r=>setTimeout(r,25));});
 expect(await screen.findByRole('link',{name:'Fresh authorized fixture'})).toBeTruthy();
 expect(screen.queryByText('Public fixture receipt')).toBeNull();
 expect(screen.queryByRole('alert')).toBeNull();expect(edge.history).toHaveBeenCalledTimes(4);
 console.info(JSON.stringify({owner,afterRefusal,afterOutage,freshSuccessRecovered:true,historyReads:4}));
 expect({afterRefusal,afterOutage}).toEqual({afterRefusal:false,afterOutage:false});
});
'''
p=folder/'r165-review-classification.test.tsx';p.write_text(raw,encoding='utf-8');(s/p.name).write_bytes(p.read_bytes());pins.append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
p=folder/'r165-review-priority.test.tsx';pins.append({'path':str(p),'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
(s/'bridges.json').write_text(json.dumps(pins,indent=2));print('Created three pinned premerge source bridges and a three-case minimal repeat/classification probe.')
