const fs=require('node:fs');
let source=fs.readFileSync(`${__dirname}/upload-review.test.tsx`,'utf8').split("it.each(['steady','Activity'])")[0];
source=source.replace("import {Toaster, toast} from 'sonner';", "import {Toaster, toast} from 'sonner';\nimport {TeamAbsencesWorkspace} from '@/app/[locale]/(app)/team/absences/team-absences-workspace';");
source=source.replace('organizationSettings:null,updatedAt:', "organizationSettings:{organizationId:'review-org',shiftsEnabled:false,projectsEnabled:false,surchargesEnabled:false,demoDataEnabled:false,worksCouncilEnabled:false,billableTimeEnabled:false,personnelFilesEnabled:true,equipmentEnabled:false,timezone:'UTC',deletedAt:null},updatedAt:");
source+=`
const row={id:'review-target',userId:'review-target-user',name:'Review Person',email:'review-person@example.invalid',image:null,employeeNumber:null,position:null,role:'employee' as const,teamName:null,vacationAllowance:null,usedVacationDays:null,pendingVacationDays:null,remainingVacationDays:null,overdrawnVacationDays:null,sickDays:0};
const sick={...category,id:'sick',name:'Review sick leave',type:'sick'};
const props={actor:{userId:'review-actor',organizationId:'review-org',employeeId:'review-manager',role:'manager'},requestKey:'2026',search:'',categories:[category,sick],sickNotesEnabled:true,listResult:{success:true as const,data:{rows:[row],teams:[],total:1,page:1,pageSize:25,year:2026,teamId:null,sort:'employee' as const,direction:'asc' as const,pageCount:1}},calendarResult:{success:true as const,data:{year:2026,teamId:null,entries:[]}}};
it.each(['steady','failed-list-return'])('assembled workspace sick-note HTTP contract: %s',async(mode)=>{
 const requests:XMLHttpRequest[]=[];
 vi.spyOn(XMLHttpRequest.prototype,'send').mockImplementation(function(this:XMLHttpRequest){requests.push(this)});
 const tree=(failed=false)=><Providers><TeamAbsencesWorkspace {...props} listResult={failed?{success:false,error:'Synthetic unavailable list'}:props.listResult}/></Providers>;
 const view=render(tree()); const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'Record absence for Review Person'})); await fillDialog();
 await user.click(screen.getByRole('combobox',{name:/Category/i})); await user.click(await screen.findByRole('option',{name:'Review sick leave'}));
 await user.click(screen.getByRole('combobox',{name:/Sick detail/i})); await user.click(await screen.findByRole('option',{name:'Without certificate'}));
 const file=new File(['%PDF-1.4 synthetic'],'review-note.pdf',{type:'application/pdf'});
 fireEvent.change(screen.getByTestId('sick-note-file-input'),{target:{files:[file]}});
 const submit=()=>screen.getByRole('button',{name:/^(Record absence|Recording)/});
 fireEvent.click(submit()); await waitFor(()=>expect(requests).toHaveLength(1)); expect(transport.record).not.toHaveBeenCalled();
 let post=0;
 if(mode==='failed-list-return'){
   view.rerender(tree(true)); expect(submit()).toHaveProperty('disabled',true);
   view.rerender(tree()); await settle();
   expect(screen.getByRole('textbox',{name:/Notes/i})).toHaveProperty('value','Retain review input'); expect(screen.getByText('review-note.pdf')).toBeTruthy(); expect(submit()).toHaveProperty('disabled',false);
   fireEvent.click(submit()); await settle();
   console.info('SAFE assembled recovery observation',JSON.stringify({requests:requests.length,commands:transport.record.mock.calls.length,errorNotifications:vi.mocked(toast.error).mock.calls.length,draftRetained:true,fileRetained:true}));
   expect({requests:requests.length,commands:transport.record.mock.calls.length,errorNotifications:vi.mocked(toast.error).mock.calls.map(call=>call[0])}).toEqual({requests:2,commands:0,errorNotifications:[]}); post=1;
 }
 await act(async()=>respond(requests[post],201,{location:'http://localhost:3000/api/tus/replacement-proof','tus-resumable':'1.0.0'}));
 await waitFor(()=>expect(requests).toHaveLength(post+2));
 await act(async()=>respond(requests[post+1],204,{'upload-offset':String(file.size),'tus-resumable':'1.0.0'}));
 await waitFor(()=>expect(transport.record).toHaveBeenCalledTimes(1)); await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('Review refusal'));
 expect(transport.record.mock.calls[0][0]).toMatchObject({employeeId:'review-target',categoryId:'sick',sickDetail:'without_certificate',notes:'Retain review input'});
 expect(transport.record.mock.calls[0][1]).toEqual([expect.objectContaining({tusFileKey:'replacement-proof',fileName:'review-note.pdf'})]);
});
`;
fs.writeFileSync(`${__dirname}/workspace-recovery.test.tsx`,source);
