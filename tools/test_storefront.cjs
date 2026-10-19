'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const html=fs.readFileSync('index.html','utf8');
assert.equal((html.match(/<h1/g)||[]).length,1);
assert(html.includes('assets/approved-grocery-cover.webp'));
assert(html.includes('noindex,nofollow'),'test domain stays noindex');
assert(html.includes('href="menu/start.html"'),'real menu link');
assert(html.includes('tel:+79882040001'),'correct store phone');
assert(!html.includes('79882040000'),'wrong old phone');
assert(!html.includes('—'),'no em dash');
assert(!html.includes('Онлайн-каталог'),'catalog not misrepresented');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [360,390,768,1440]){
  const page=await browser.newPage({viewport:{width,height:900},deviceScaleFactor:1});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const r=await page.goto('http://127.0.0.1:8877/',{waitUntil:'networkidle'});
  assert(r?.ok());
  assert(await page.locator('.official-logo').evaluate(x=>x.complete&&x.naturalWidth>0),'original logo');
  assert(await page.locator('.hero-grocery').evaluate(x=>x.complete&&x.naturalWidth>0),'approved artwork crop');
  const title=await page.locator('h1').innerText();assert(title.includes('НИЗКИЕ ЦЕНЫ'));
  assert.equal(await page.locator('.panel-cta').getAttribute('href'),'menu/start.html');
  const menu=await page.request.get('http://127.0.0.1:8877/menu/start.html');assert(menu.ok(),'connected menu');
  assert.equal(await page.locator('.hero-benefits>div').count(),5);
  const scroll=await page.evaluate(()=>({vw:window.innerWidth,sw:document.documentElement.scrollWidth}));
  assert(scroll.sw<=width+1,'horizontal overflow '+JSON.stringify(scroll));
  await page.screenshot({path:'/tmp/palleta-home-'+width+'.png',fullPage:width<=390});
  assert.deepEqual(errors,[]);
  console.log('PASS approved Palleta homepage at '+width+'px');
  await page.close();
 }
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
