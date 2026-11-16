await p.waitForFunction(()=>![...document.querySelectorAll('[data-mobile=true]')].some(e=>e.checkVisibility()));
const o=await p.evaluate(()=>({focused:{tag:document.activeElement?.tagName,text:document.activeElement?.textContent?.trim().slice(0,100),label:document.activeElement?.getAttribute('aria-label')},triggers:[...document.querySelectorAll('button')].filter(e=>e.textContent.trim()==='Toggle Sidebar').map(e=>({visible:e.checkVisibility(),focused:document.activeElement===e}))}));
results.phoneEscapeSettled=o;return o;
