(async()=>{ const h=window.__h; const S=await import('./core/state.js'); const r={}; await new Promise(r=>setTimeout(r,3000));
 r.fpReloaded=await h.fp(); r.noSendDirect=await h.direct(); r.S2=(await h.send()).step_Clean; r.fpAfter=await h.fp(); return JSON.stringify(r); })()
