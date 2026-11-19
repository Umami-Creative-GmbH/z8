import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const require=createRequire(resolve('apps/webapp/package.json'));
const ExcelJS=require('exceljs');
const Papa=require('papaparse');
const {getDocument}=await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
const output='docs/design/rollout-1692/1736/downloads';mkdirSync(output,{recursive:true});
const records=[];
for(const kind of ['project','customer','shared']){
 const events=JSON.parse(readFileSync(`.tmp/1736-fixture/${kind}-download-events-private.json`));
 for(const begin of events.filter(x=>x.kind==='begin')){
  const complete=events.find(x=>x.kind==='progress'&&x.guid===begin.guid&&x.state==='completed');
  if(!complete)throw Error('Missing browser completion event');
  const file=resolve('.tmp/1736-fixture/completed-downloads',begin.filename);const data=readFileSync(file);const extension=begin.filename.split('.').at(-1);
  let text='';
  if(extension==='csv'){
   const parsed=Papa.parse(data.toString('utf8'),{skipEmptyLines:true});text=JSON.stringify(parsed.data);
  }else if(extension==='xlsx'){
   const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(data);text=JSON.stringify(workbook.worksheets.map(sheet=>sheet.getSheetValues()));
  }else if(extension==='pdf'){
   const task=getDocument({data:new Uint8Array(data),useSystemFonts:true});const pdf=await task.promise;const pages=[];
   for(let i=1;i<=pdf.numPages;i++){const content=await(await pdf.getPage(i)).getTextContent();pages.push(content.items.map(item=>'str'in item?item.str:'').join(' '));}
   text=pages.join(' ');await task.destroy();
  }else throw Error('Unexpected format');
  if(!text.includes('R062 Delivery')||!text.includes('2026-11-01')||!text.includes('2026-11-30'))throw Error(`Wrong report scope ${kind}/${extension}`);
  if(kind==='shared'&&/Cost|Margin|Kosten|Marge|Person 2|Delivery task|Synthetic report comparison/.test(text))throw Error('Untrimmed shared download');
  if(kind==='project'&&!(/\b500(?:[.,]00)?\b/.test(text)))throw Error('Missing project revenue');
  if(kind==='customer'&&!text.includes('R062 Unpriced'))throw Error('Missing customer project');
  copyFileSync(file,`${output}/${kind}.${extension}`);
  records.push({kind,format:extension,bytes:statSync(file).size,sha256:createHash('sha256').update(data).digest('hex'),completedBrowserEvent:true,parsedScope:{period:['2026-11-01','2026-11-30'],project:'R062 Delivery',hours:kind==='customer'?6:5,customerIncludesUnpricedProject:kind==='customer',sharedRedactionChecked:kind==='shared'},transport:'native agent-browser pointer click; same owned browser CDP allow directory + download completion event; native download subcommand canceled blob captures separately'});
 }
}
if(records.length!==9)throw Error('Expected nine completed files');
writeFileSync('docs/design/rollout-1692/1736/downloads.json',JSON.stringify(records,null,2));
console.log('Parsed nine completed CSV/XLSX/PDF files with exact period/project/customer and shared-content checks.');
