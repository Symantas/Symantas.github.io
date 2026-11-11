/* Offline support for the mistake trainer. Only same-origin files are cached; Chess.com requests are never touched. */
const CACHE='mistake-trainer-v1';
const SHELL=['./','index.html','app.js','manifest.webmanifest','icon-192.png','vendor/chess.js','vendor/stockfish.wasm.js','vendor/stockfish.wasm'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==self.location.origin)return;
  const put=r=>{if(r&&r.ok){const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy))}return r};
  if(u.pathname.includes('/vendor/')||/\.png$/.test(u.pathname))      // libraries and icons never change: cache first
    e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(put)));
  else                                                                 // the app itself: newest version when online, cached copy when not
    e.respondWith(fetch(e.request).then(put).catch(()=>caches.match(e.request,{ignoreSearch:true}).then(r=>r||caches.match('index.html'))));
});
