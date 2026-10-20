'use strict';
const CACHE='palleta-offline-release-05bf883e917a';
const SHELL=['./','./index.html','./start.html','./app.js','./core.js','./products.json','./recipes.json','./manifest.webmanifest','./assets/app-icon-192.png','./assets/app-icon-512.png','./assets/palleta-favicon-32.png','./favicon.ico','./assets/palleta-logo.webp','./assets/local-point-logo.webp'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('palleta-offline-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{
 const req=event.request, url=new URL(req.url);
 if(req.method!=='GET'||url.origin!==self.location.origin)return;
 // Always check the network for pages and JS. Old cached app shells must not trap visitors.
 event.respondWith(fetch(req,{cache:'no-store'}).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(req,copy)));}
  return response;
 }).catch(async()=>{const cached=await caches.match(req,{ignoreSearch:true});return cached||new Response('Нет подключения. Подключитесь к интернету для первой загрузки.',{status:503,headers:{'Content-Type':'text/plain;charset=utf-8'}});}));
});
