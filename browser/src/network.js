export async function request(url, options={}) {
  const signal=options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(options.timeout||90000)]) : AbortSignal.timeout(options.timeout||90000);
  const r=await fetch(url,{...options,signal});
  if(!r.ok) { const error=new Error(`Data service returned HTTP ${r.status}.`);error.status=r.status;throw error; }
  return r;
}
export async function pooled(items, limit, task, signal) {
  const results=new Array(items.length);let next=0,failed=false;
  await Promise.all(Array.from({length:Math.min(limit,items.length)},async()=>{while(!failed&&next<items.length){signal?.throwIfAborted();const i=next++;try{results[i]=await task(items[i],i);}catch(e){failed=true;throw e;}}}));
  return results;
}
export function pause(ms,signal) {
  return new Promise((resolve,reject)=>{const t=setTimeout(resolve,ms);signal?.addEventListener('abort',()=>{clearTimeout(t);reject(new DOMException('Cancelled','AbortError'));},{once:true});});
}
