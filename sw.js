const CACHE='otto-monitor-v1';
const CORE=['/','/index.html','/manifest.webmanifest','/assets/otto-icon-192.png','/assets/otto-icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).catch(()=>{}));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin!==location.origin) return;
  if(url.pathname.startsWith('/api/')){
    e.respondWith(fetch(req));
    return;
  }
  e.respondWith(fetch(req).then(res=>{
    if(res && res.ok){const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy));}
    return res;
  }).catch(()=>caches.match(req).then(r=>r||caches.match('/index.html'))));
});
