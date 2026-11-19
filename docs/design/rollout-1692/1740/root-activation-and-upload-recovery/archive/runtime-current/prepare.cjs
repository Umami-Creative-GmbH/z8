const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
let source = fs.readFileSync(path.join(dir, 'workspace-recovery.test.tsx'), 'utf8');
source = source.replace("  record:vi.fn(),refresh", "  discard:vi.fn(async()=>({success:true})),record:vi.fn(),refresh");
source = source.replace("discardStagedSickNoteUploadsAction:vi.fn(async()=>({success:true}))", "discardStagedSickNoteUploadsAction:transport.discard");
source = source.replace("transport.record.mockReset().mockResolvedValue", "transport.discard.mockClear();\n  transport.record.mockReset().mockResolvedValue");
source = source.replace("it.each(['steady','failed-list-return'])", "it.each(['steady','failed-list-return','Activity','target','open','feature'])");
source = source.replace("const tree=(failed=false)=><Providers><TeamAbsencesWorkspace {...props} listResult={failed?{success:false,error:'Synthetic unavailable list'}:props.listResult}/></Providers>;", `const tree=(failed=false)=><Providers><Activity mode={failed&&mode==='Activity'?'hidden':'visible'}>{['target','open','feature'].includes(mode)?<RecordAbsenceDialog open={!(failed&&mode==='open')} employee={{id:failed&&mode==='target'?'other-target':'review-target',name:'Review Person'}} categories={props.categories} sickNotesEnabled={!(failed&&mode==='feature')} onOpenChange={transport.push}/>:<TeamAbsencesWorkspace {...props} listResult={failed&&mode==='failed-list-return'?{success:false,error:'Synthetic unavailable list'}:props.listResult}/>}</Activity></Providers>;`);
source = source.replace("await user.click(screen.getByRole('button',{name:'Record absence for Review Person'})); await fillDialog();", "if(!['target','open','feature'].includes(mode)) await user.click(screen.getByRole('button',{name:'Record absence for Review Person'})); await fillDialog();");
source = source.replace("if(mode==='failed-list-return'){", "if(mode!=='steady'){");
source = source.replace("view.rerender(tree(true)); expect(submit()).toHaveProperty('disabled',true);", "view.rerender(tree(true)); if(mode==='failed-list-return') expect(submit()).toHaveProperty('disabled',true);");
source = source.replace("errorNotifications:[]}); post=1;", `errorNotifications:[]}); post=1;
   // An already retired HTTP request must not trigger PATCH or old commands.
   await act(async()=>respond(requests[0],201,{location:'http://localhost:3000/api/tus/obsolete-proof','tus-resumable':'1.0.0'}));
   await settle(); expect(requests).toHaveLength(2); expect(transport.record).not.toHaveBeenCalled();`);
fs.writeFileSync(path.join(dir,'upload-expanded.test.tsx'),source);
const prelude=source.slice(0,source.indexOf("it.each(['steady'"));
fs.writeFileSync(path.join(dir,'partial-cleanup.test.tsx'),prelude+`
it('actual workspace discards only finished unattached first file and replaces the retained two-file draft',async()=>{
 const methods=new WeakMap<XMLHttpRequest,string>();const realOpen=XMLHttpRequest.prototype.open;vi.spyOn(XMLHttpRequest.prototype,'open').mockImplementation(function(this:XMLHttpRequest,...args:any[]){methods.set(this,args[0]);return (realOpen as any).apply(this,args)});
 const requests:XMLHttpRequest[]=[];vi.spyOn(XMLHttpRequest.prototype,'send').mockImplementation(function(this:XMLHttpRequest){requests.push(this)});
 const tree=(failed=false)=><Providers><TeamAbsencesWorkspace {...props} listResult={failed?{success:false,error:'List unavailable'}:props.listResult}/></Providers>;
 const view=render(tree());const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Record absence for Review Person'}));await fillDialog();
 await user.click(screen.getByRole('combobox',{name:/Category/i}));await user.click(await screen.findByRole('option',{name:'Review sick leave'}));await user.click(screen.getByRole('combobox',{name:/Sick detail/i}));await user.click(await screen.findByRole('option',{name:'Without certificate'}));
 const first=new File(['%PDF first'],'first.pdf',{type:'application/pdf'}),second=new File(['%PDF second'],'second.pdf',{type:'application/pdf'});fireEvent.change(screen.getByTestId('sick-note-file-input'),{target:{files:[first,second]}});
 const submit=()=>screen.getByRole('button',{name:/^(Record absence|Recording)/});
 const finish=async(start:number,key:string,file:File)=>{let index=start;await waitFor(()=>expect(requests).toHaveLength(index+1));if(methods.get(requests[index])==='HEAD'){await act(async()=>respond(requests[index],404,{'tus-resumable':'1.0.0'}));index++;await waitFor(()=>expect(requests).toHaveLength(index+1));}expect(methods.get(requests[index])).toBe('POST');await act(async()=>respond(requests[index],201,{location:'http://localhost:3000/api/tus/'+key,'tus-resumable':'1.0.0'}));await waitFor(()=>expect(requests).toHaveLength(index+2));expect(methods.get(requests[index+1])).toBe('PATCH');await act(async()=>respond(requests[index+1],204,{'upload-offset':String(file.size),'tus-resumable':'1.0.0'}));return index+2;};
 fireEvent.click(submit());await finish(0,'old-first',first);await waitFor(()=>expect(requests).toHaveLength(3));expect(transport.record).not.toHaveBeenCalled();
 view.rerender(tree(true));view.rerender(tree());await settle();expect(transport.discard).toHaveBeenCalledExactlyOnceWith(['old-first']);expect(toast.error).not.toHaveBeenCalled();
 expect(screen.getByText('first.pdf')).toBeTruthy();expect(screen.getByText('second.pdf')).toBeTruthy();fireEvent.click(submit());
 const next=await finish(3,'new-first',first);await finish(next,'new-second',second);await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));
 expect(transport.record.mock.calls[0][1]).toEqual([expect.objectContaining({tusFileKey:'new-first',fileName:'first.pdf'}),expect.objectContaining({tusFileKey:'new-second',fileName:'second.pdf'})]);expect(transport.discard).toHaveBeenCalledExactlyOnceWith(['old-first']);await waitFor(()=>expect(toast.error).toHaveBeenCalledExactlyOnceWith('Review refusal'));
});
`);
fs.writeFileSync(path.join(dir,'late-commands.test.tsx'),prelude+`
const deferred=()=>{let resolve!:(v:any)=>void;let reject!:(e:Error)=>void;const promise=new Promise<any>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
it.each(['success','refusal','rejection'])('assembled uploaded command late %s after list return cannot settle replacement',async(kind)=>{
 const old=deferred(),fresh=deferred();transport.record.mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
 const methods=new WeakMap<XMLHttpRequest,string>();const realOpen=XMLHttpRequest.prototype.open;vi.spyOn(XMLHttpRequest.prototype,'open').mockImplementation(function(this:XMLHttpRequest,...args:any[]){methods.set(this,args[0]);return (realOpen as any).apply(this,args)});
 const requests:XMLHttpRequest[]=[];vi.spyOn(XMLHttpRequest.prototype,'send').mockImplementation(function(this:XMLHttpRequest){requests.push(this);console.info('SAFE method',requests.length,methods.get(this))});
 const tree=(failed=false)=><Providers><TeamAbsencesWorkspace {...props} listResult={failed?{success:false,error:'List unavailable'}:props.listResult}/></Providers>;
 const view=render(tree());const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'Record absence for Review Person'}));await fillDialog();
 await user.click(screen.getByRole('combobox',{name:/Category/i}));await user.click(await screen.findByRole('option',{name:'Review sick leave'}));
 await user.click(screen.getByRole('combobox',{name:/Sick detail/i}));await user.click(await screen.findByRole('option',{name:'Without certificate'}));
 const file=new File(['%PDF synthetic'],'review-note.pdf',{type:'application/pdf'});fireEvent.change(screen.getByTestId('sick-note-file-input'),{target:{files:[file]}});
 const submit=()=>screen.getByRole('button',{name:/^(Record absence|Recording)/});
 const complete=async(index:number,key:string)=>{await waitFor(()=>expect(requests.length).toBe(index+1));if(methods.get(requests[index])==='HEAD'){await act(async()=>respond(requests[index],404,{'tus-resumable':'1.0.0'}));index++;await waitFor(()=>expect(requests.length).toBe(index+1));}expect(methods.get(requests[index])).toBe('POST');await act(async()=>respond(requests[index],201,{location:'http://localhost:3000/api/tus/'+key,'tus-resumable':'1.0.0'}));await waitFor(()=>expect(requests.length).toBe(index+2));expect(methods.get(requests[index+1])).toBe('PATCH');await act(async()=>respond(requests[index+1],204,{'upload-offset':String(file.size),'tus-resumable':'1.0.0'}));};
 fireEvent.click(submit());await complete(0,'old-command');await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1));
 view.rerender(tree(true));view.rerender(tree());await settle();fireEvent.click(submit());await complete(2,'new-command');await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(2));
 await act(async()=>{if(kind==='rejection')old.reject(new Error('Old rejection'));else old.resolve(kind==='success'?{success:true,data:{absenceId:'old'}}:{success:false,error:'Old refusal'});});await settle();
 expect(screen.getByRole('dialog')).toBeTruthy();expect(screen.getByRole('textbox',{name:/Notes/i})).toHaveProperty('value','Retain review input');expect(submit()).toHaveProperty('disabled',true);
 expect(toast.error).not.toHaveBeenCalled();expect(toast.success).not.toHaveBeenCalled();expect(transport.refresh).not.toHaveBeenCalled();
 expect(transport.discard.mock.calls).toEqual(kind==='rejection'?[[['old-command']]]:[]);
 fireEvent.click(submit());expect(transport.record).toHaveBeenCalledTimes(2);
 fresh.resolve({success:false,error:'Fresh refusal'});await waitFor(()=>expect(toast.error).toHaveBeenCalledExactlyOnceWith('Fresh refusal'));expect(submit()).toHaveProperty('disabled',false);
 expect(transport.record.mock.calls[1][1]).toEqual([expect.objectContaining({tusFileKey:'new-command'})]);
});
`);
