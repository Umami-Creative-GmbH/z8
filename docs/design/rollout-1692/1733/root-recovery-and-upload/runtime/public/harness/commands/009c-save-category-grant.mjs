const option=await p.waitForFunction(()=>[...document.querySelectorAll('[role=option]')].find(e=>e.checkVisibility()&&e.querySelector('.font-medium')?.textContent.trim()==='Person 1'));await option.click();await p.waitForFunction(()=>![...document.querySelectorAll('[role=dialog]')].some(e=>e.checkVisibility()));await p.click('[role=radio][aria-label="All employees"]');
for(const category of ['contract','certificate','sick_note','other'])await p.click('#personnel-file-officer-category-'+category);
await h.click(p,'Save personnel file officer');await p.waitForFunction(()=>!document.querySelector('form button[type=submit]')&&document.querySelector('main')?.innerText.includes('Payslip'));
results.publicGrant={actor:'small-manager',categories:['payslip'],scope:'all',publicUiOnly:true,source:await h.source()};check('public settings UI creates payslip-only officer grant',true);
return{grantCreated:true,category:'payslip',scope:'all'};
