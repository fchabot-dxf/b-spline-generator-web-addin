(async()=>{ const h=window.__h; const S=await import('./core/state.js'); const PM=await import('./main/param-manager.js'); const r={};
 PM.applyParam('seed', 31337); await new Promise(r=>setTimeout(r,3500));
 r.noSendDirect=await h.direct(); r.fp0=await h.fp(); r.S1=(await h.send()).step_Clean; r.directAfterSend=await h.direct(); r.fp1=await h.fp();
 S.flushSessionSave(); r.stored=!!localStorage.length; return JSON.stringify(r); })()
