'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {chromium}=require('playwright-core');
const html=fs.readFileSync('index.html','utf8');
assert.equal((html.match(/<h1/g)||[]).length,1);
assert(html.includes('assets/approved-grocery-cover.webp'));
assert.equal(fs.readFileSync('CNAME','utf8').trim(),'palleta.store','Pages apex configured');
assert(html.includes('content="index,follow"'),'production homepage indexable');
assert(html.includes('rel="canonical" href="https://palleta.store/"'),'canonical points to apex');
assert(!html.includes('Тестовая версия сайта.'),'preview banner removed');
assert(html.includes('href="menu/start.html"'),'real menu link');
assert(html.includes('tel:+79882040001'),'correct store phone');
assert(!html.includes('79882040000'),'wrong old phone');
assert(!html.includes('—'),'no em dash');
assert(!html.includes('Онлайн-каталог'),'catalog not misrepresented');
assert(html.includes('href="https://t.me/PALLETA01"'),'official Palleta Telegram');
assert(html.includes('href="https://max.ru/u/f9LHodD0cOKYEWc4RJmLceBHb6KkAUR8mcx2h9XsGQ9ywbv4rfaQWYUG5AY"'),'official Palleta MAX');
assert(html.includes('id="other-projects"'),'other projects separate section');
assert(html.includes('https://berbena.pro/prorecepty?utm_source=palleta_store'),'verified berbena landing page');
assert(html.includes('href="https://wa.me/79637940001?text='),'LP WA message separate from store');
assert(!html.includes('https://t.me/+79882040001'),'outdated Telegram removed');
(async()=>{const browser=await chromium.launch({executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
try{
 for(const width of [320,360,390,768,1024,1440]){
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
  const contacts=page.locator('#contacts');
  const related=page.locator('#other-projects');
  assert.equal(await contacts.locator('.contact-link').count(),3,'store socials have 3 links');
  assert.equal(await related.locator('.related-project-card').count(),2,'two other projects');
  assert.equal(await related.locator('a[href*="berbena.pro/prorecepty"]').count(),1);
  const lp=related.locator('a[href^="https://wa.me/79637940001"]');
  assert.equal(await lp.count(),1);
  assert.equal(await related.locator('a[href^="tel:"]').count(),0,'no confusing partner contact numbers');
  assert.equal(await contacts.locator('a[href^="https://wa.me/79637940001"]').count(),0,'LP contact not mixed in store');
  assert.equal(await contacts.locator('a[href="https://t.me/PALLETA01"]').count(),1);
  assert.equal(await contacts.locator('a[href="https://max.ru/u/f9LHodD0cOKYEWc4RJmLceBHb6KkAUR8mcx2h9XsGQ9ywbv4rfaQWYUG5AY"]').count(),1);
  assert(await related.locator('img[alt="Логотип Local Point"]').evaluate(x=>x.complete&&x.naturalWidth>0),'real LP logo loads');
  assert(await page.evaluate(()=>document.querySelector('#contacts').compareDocumentPosition(document.querySelector('#other-projects'))&Node.DOCUMENT_POSITION_FOLLOWING),'other projects come after store contact block');
  if(width<=390){
    await related.scrollIntoViewIfNeeded();
    await page.screenshot({path:'/tmp/palleta-other-projects-'+width+'.png'});
    assert(await related.locator('.related-project-card').first().isVisible());
  }
  const header=page.locator('.header');
  const toggle=page.locator('.header-menu-button');
  const nav=page.locator('#header-navigation');
  const headHeight=await header.evaluate(el=>el.getBoundingClientRect().height);
  if(width<=850){
    assert(headHeight<=72,'sticky mobile header must be <=72px: '+headHeight);
    assert(await toggle.isVisible(),'mobile toggle visible');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false','menu initially closed');
    assert.equal(await nav.isVisible(),false,'mobile navigation hidden by default');
    assert.equal(await page.locator('.header-phone').getAttribute('href'),'tel:+79882040001');
    assert(await page.locator('.header-phone').isVisible(),'compact call icon visible');
    await page.evaluate(()=>window.scrollTo(0,650));
    await page.waitForTimeout(60);
    assert(Math.abs(await header.evaluate(el=>el.getBoundingClientRect().top))<=1,'compact header stays at viewport top');
    await toggle.click();
    assert(await nav.isVisible(),'mobile navigation can open');
    assert.equal(await toggle.getAttribute('aria-expanded'),'true');
    const openedHeight=await header.evaluate(el=>el.getBoundingClientRect().height);
    assert(openedHeight<=72,'open menu must overlay content, not expand sticky header');
    const navHref=await nav.locator('a[href="#menu"]').getAttribute('href');
    assert.equal(navHref,'#menu');
    await page.screenshot({path:'/tmp/palleta-header-open-'+width+'.png'});
    await page.keyboard.press('Escape');
    assert.equal(await nav.isVisible(),false,'Escape closes navigation');
    assert.equal(await toggle.getAttribute('aria-expanded'),'false');
    await toggle.click();
    await nav.locator('a[href="#menu"]').click();
    assert.equal(await nav.isVisible(),false,'section selection closes menu');
    assert.equal(await page.evaluate(()=>location.hash),'#menu');
  }else{
    assert.equal(await toggle.isVisible(),false,'desktop menu button hidden');
    assert(await nav.isVisible(),'desktop full navigation stays visible');
  }
  const scroll=await page.evaluate(()=>({vw:window.innerWidth,sw:document.documentElement.scrollWidth}));
  assert(scroll.sw<=width+1,'horizontal overflow '+JSON.stringify(scroll));
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.waitForTimeout(70);
  await page.screenshot({path:'/tmp/palleta-home-'+width+'.png',fullPage:width<=390});
  assert.deepEqual(errors,[]);
  console.log('PASS approved Palleta homepage at '+width+'px');
  await page.close();
 }
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
