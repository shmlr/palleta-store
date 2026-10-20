'use strict';
// READ ONLY: audit the customer flow; never click the external WhatsApp link.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright-core');
const C=require('../menu/core.js');
const root=process.env.TEST_URL||'http://127.0.0.1:8877/';
const out='/tmp/palleta-purchase-flow-audit';
fs.mkdirSync(out,{recursive:true});
const results=[];
const finding=(id,severity,status,title,evidence)=>{
 results.push({id,severity,status,title,evidence});
 console.log([status,severity,id,title,evidence].join(' | '));
};
const parseMsg=href=>new URL(href).searchParams.get('text')||'';
const catalog=JSON.parse(fs.readFileSync('menu/products.json','utf8'));
const homeHTML=fs.readFileSync('index.html','utf8');
const appJS=fs.readFileSync('menu/app.js','utf8');
const sourceNotes=Array.isArray(catalog.source_notes)?catalog.source_notes:[];
const internalNotes=sourceNotes.filter(n=>/склад|1С|УТ|внутрен|код для поиска|оптов|руб|артикул|остатк|кг|резерв/i.test(n));
const prices=catalog.products.filter(p=>Number.isFinite(p.price)&&p.price_as_of);
const stocked=catalog.products.filter(p=>C.availability(p,catalog)==='in_stock');
const newestPrice=prices.map(p=>p.price_as_of).sort().at(-1)||null;
const latestImport=catalog.last_reference_import?.as_of||null;

finding('DATA-01','P0',internalNotes.length?'FAIL':'PASS','Public catalog contains internal source notes','Internal operational notes: '+internalNotes.length+' of '+sourceNotes.length+'; content intentionally omitted from audit log');
finding('DATA-02','P1',stocked.length===0?'LIMITATION':'PASS','No current sellable inventory confirmed','In-stock products: '+stocked.length+'/'+catalog.products.length+'; store order must remain preliminary');
finding('DATA-03','P1','LIMITATION','Club price data not live','Latest product price date: '+newestPrice+'; verified reference import: '+latestImport+'; prices need confirmation');
finding('DATA-04','P1',appJS.includes('Какие SKU стоит проверить')?'FAIL':'PASS','Internal SKU reconciliation text appears in buyer UI','Buyer text contains internal SKU heading: '+appJS.includes('Какие SKU стоит проверить'));
finding('DATA-05','P1',homeHTML.includes('yandex.ru/maps')||homeHTML.includes('2gis.ru')||homeHTML.includes('maps.google')?'PASS':'NEEDS_HUMAN','Store address and route','No verified map route detected in homepage HTML, address needs owner verification');
finding('DATA-06','P1',catalog.products.some(x=>x.cost!==null&&x.cost!==undefined||x.purchase_price!==null&&x.purchase_price!==undefined||Number.isFinite(x.stock_quantity))?'FAIL':'PASS','No procurement cost or raw stock quantities in public product records','Checked '+catalog.products.length+' products; does not cover notes or git history');
finding('DATA-07','P2',appJS.includes('prefs.budget')&&!/score[^;]*budget/.test(fs.readFileSync('menu/core.js','utf8'))?'LIMITATION':'PASS','Budget is a preference, not guaranteed limit','Budget not a constraint in core recipe ranking');
finding('DATA-08','P2',homeHTML.includes('href="https://t.me/PALLETA01"')&&homeHTML.includes('id="other-projects"')?'PASS':'FAIL','Shop support separated from other projects','Homepage has separate partner section and store Telegram');

;(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
  for(const width of [360,390]){
   const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
   const page=await context.newPage();
   const errors=[];
   page.on('pageerror',x=>errors.push(x.message));
   const response=await page.goto(new URL('menu/start.html',root).href,{waitUntil:'networkidle',timeout:30000});
   assert(response?.ok(),'menu HTML response');
   await page.getByRole('heading',{name:'Что приготовить на этой неделе?'}).waitFor();
   await page.screenshot({path:path.join(out,'menu-start-'+width+'.png')});
   assert(await page.locator('a[href^="tel:+79637940001"]').count()>0);
   await page.getByRole('button',{name:'Посмотреть пример меню'}).click();
   await page.getByRole('heading',{name:'Семейное меню на 3 дня'}).waitFor();
   assert.equal(await page.locator('.slot').count(),9);
   const row=page.locator('input.shopping-check').first();
   assert(await row.count()>0,'basket has shop items');
   const wa=page.locator('#whatsapp');
   const waHrefBefore=await wa.getAttribute('href');
   const before=parseMsg(waHrefBefore);
   assert(waHrefBefore.startsWith('https://wa.me/79882040001?text='));
   assert(before.includes('Заявка предварительная.'),'no false order promise');
   assert(before.includes('Список покупок:'));
   await row.check();
   const afterBought=parseMsg(await wa.getAttribute('href'));
   const boughtStillOrdered=afterBought===before;
   finding('CART-01-'+width,'P0',boughtStillOrdered?'FAIL':'PASS','Bought checkbox must not leave item in outbound WhatsApp cart',boughtStillOrdered?'Checkbox checked; message remains unchanged':'WhatsApp list changes on bought action');
   const homeToggle=page.locator('input[data-home]').first();
   const ingredient=await homeToggle.getAttribute('data-home');
   await homeToggle.check();
   const afterHome=parseMsg(await page.locator('#whatsapp').getAttribute('href'));
   const changed=afterHome!==afterBought;
   const atHome=await page.locator('#at-home').isVisible();
   finding('CART-02-'+width,'P1',changed&&atHome?'PASS':'FAIL','Home inventory removes ingredient from preliminary store request','Message changed: '+changed+'; separate home block: '+atHome+'; ingredient: '+ingredient);
   await page.reload({waitUntil:'networkidle'});
   await page.getByRole('heading',{name:'Что приготовить на этой неделе?'}).waitFor();
   const canResume=await page.getByRole('button',{name:'Продолжить сохранённое меню'}).isVisible();
   if(canResume)await page.getByRole('button',{name:'Продолжить сохранённое меню'}).click();
   finding('SAVE-01-'+width,'P1',canResume&&await page.locator('#at-home').isVisible()?'PASS':'FAIL','Saved family settings survive browser reload','Resume shown: '+canResume);
   await page.screenshot({path:path.join(out,'shopping-'+width+'.png')});

   await page.getByRole('button',{name:'← На главную'}).click();
   await page.getByRole('button',{name:'Составить меню'}).click();
   for(const v of ['7','4','60','12000'])await page.locator('[data-answer="'+v+'"]').click();
   await page.locator('#next').click();
   assert.equal(await page.locator('.slot').count(),21);
   await page.getByRole('button',{name:'В выходные обед-пикник'}).click();
   const noWeekendHome=await page.locator('[data-attendance="5-lunch"]').inputValue()==='picnic'&&await page.locator('[data-attendance="6-lunch"]').inputValue()==='picnic';
   await page.getByRole('button',{name:'Пропустить обеды в будни'}).click();
   const summary=await page.locator('#app').innerText();
   const combined=summary.includes('14 из 14 домашних блюд')&&await page.locator('[data-attendance="5-lunch"]').inputValue()==='picnic';
   finding('MEAL-01-'+width,'P1',noWeekendHome&&combined?'PASS':'FAIL','7-day attendance and picnic presets compose','Weekend picnic: '+noWeekendHome+'; combined weekday/weekend: '+combined);
   const updated=parseMsg(await page.locator('#whatsapp').getAttribute('href'));
   finding('ORDER-01-'+width,'P1',updated.includes('14 блюд, 7 приёмов пищи без готовки дома')&&updated.includes('Заявка предварительная.')?'PASS':'FAIL','Outbound request reflects meal attendance without false checkout','Message remains preliminary; no external click');
   const budget=await page.locator('#shopping').innerText();
   finding('PRICE-01-'+width,'P1',budget.includes('Полный итог пока неизвестен')?'PASS':'FAIL','Do not present a fictional confirmed checkout amount','Current total hidden: '+budget.includes('Полный итог пока неизвестен'));
   const scroll=await page.evaluate(()=>({screen:innerWidth,doc:document.documentElement.scrollWidth}));
   finding('UX-01-'+width,'P1',scroll.doc<=width+1?'PASS':'FAIL','No mobile horizontal overflow',JSON.stringify(scroll));
   finding('UX-02-'+width,'P1',errors.length?'FAIL':'PASS','No unhandled JavaScript exceptions','Page errors: '+errors.length);
   await context.close();
  }
  const row=results.map(r=>'| '+r.id+' | '+r.severity+' | '+r.status+' | '+r.title+' | '+r.evidence.replaceAll('|','/')+' |').join('\n');
  const counts=results.reduce((a,r)=>(a[r.status]=(a[r.status]||0)+1,a),{});
  const report='# Palleta Purchase Flow Audit | automated evidence\n\n'+
   'Run: '+new Date().toISOString()+'\n\n'+
   '**Scope:** local snapshot of shmlr/palleta-store, real headless Chromium 360/390px. NO WhatsApp message sent; no production changes.\n\n'+
   '**Counts:** '+JSON.stringify(counts)+'\n\n'+
   '| ID | Priority | Status | Check | Evidence |\n|---|---|---|---|---|\n'+row+'\n\n'+
   '## Review limitations\nThis is a code and simulated-browser audit, not a payment, purchase, WhatsApp delivery, employee response, 1C live inventory, legal opinion, or customer usability study. Human sign-off still required.\n';
  fs.writeFileSync(path.join(out,'report.md'),report);
  fs.writeFileSync(path.join(out,'findings.json'),JSON.stringify({scope:'read-only-browser-audit',run:new Date().toISOString(),counts,findings:results},null,2));
  console.log('AUDIT COMPLETE',JSON.stringify(counts));
 }finally{await browser.close();}
})().catch(e=>{
 fs.writeFileSync(path.join(out,'fatal.txt'),String(e.stack||e));
 console.error(e);
 process.exitCode=1;
});