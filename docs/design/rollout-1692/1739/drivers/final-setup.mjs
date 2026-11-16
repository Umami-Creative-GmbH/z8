import {cli,evaluate} from './native-final.mjs';
cli('wait','--fn',`!!document.querySelector('button[aria-label="Clock In"]:not(:disabled)')`);
if(cli('snapshot','-i').includes('button "Not Now"')){cli('find','role','button','click','--name','Not Now');cli('wait','--fn',`!document.querySelector('[role="dialog"]')`);}
cli('find','role','button','click','--name','Account: Person 1');
cli('find','role','menuitem','click','--name','Font size');
cli('find','role','menuitemradio','click','--name','Large');
cli('press','Escape');
console.log(JSON.stringify(evaluate(`({font:getComputedStyle(document.documentElement).fontSize,path:location.pathname})`)));
