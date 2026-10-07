export class ModelPool {
  constructor(count=1){this.workers=[];this.queue=[];this.id=0;this.closed=false;for(let i=0;i<count;i++)this.create();}
  create(){
    const slot={worker:new Worker(new URL('./model.worker.js',import.meta.url),{type:'module'}),job:null};
    slot.worker.onmessage=({data})=>{if(!slot.job)return;if(data.progress){slot.job.report?.(data.progress);return;}const job=slot.job;slot.job=null;data.error?job.reject(new Error(data.error)):job.resolve(data.result);this.pump();};
    slot.worker.onerror=e=>{const error=new Error(e.message||'Model worker could not start. Reload the page and retry.');slot.job?.reject(error);slot.job=null;this.close(error);};this.workers.push(slot);
  }
  run(kind,payload,report){if(this.closed)return Promise.reject(new Error('Cancelled.'));return new Promise((resolve,reject)=>{this.queue.push({id:++this.id,kind,payload,report,resolve,reject});this.pump();});}
  pump(){for(const slot of this.workers)if(!slot.job&&this.queue.length){slot.job=this.queue.shift();const {id,kind,payload}=slot.job;slot.worker.postMessage({id,kind,payload});}}
  close(error=new DOMException('Cancelled','AbortError')){this.closed=true;for(const slot of this.workers){slot.job?.reject(error);slot.worker.terminate();}for(const job of this.queue)job.reject(error);this.queue=[];}
}
export function workerCount(tiles, requested=0){const cpu=navigator.hardwareConcurrency||4,memory=navigator.deviceMemory||4;return Math.max(1,Math.min(tiles,requested||Math.min(Math.max(1,cpu-1),Math.max(1,Math.floor(memory/2)),6)));}
