window.__h = {
  async sha(s){ const h=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(h)].map(x=>x.toString(16).padStart(2,'0')).join('').slice(0,12); },
  async fp(){ const S=await import('./core/state.js'); const X=await import('./main/export-flow.js'); const P=S.P;
    const o={ seed:P.seed, boardId:P.boardId, activeLayerIdx:P.activeLayerIdx, frame: await this.sha(JSON.stringify(P.frame)), editorSvg: await this.sha(String(P.editorSvg||'')), editorSvgLen:(P.editorSvg||'').length,
      stamp:X.activeStampLayers().length, exportable:X.exportableStampLayers().length, layers:(window.svgEditor&&window.svgEditor._layers||[]).map(l=>l.name+(l._carve?'*':'')) };
    return o; },
  async direct(){ const S=await import('./core/state.js'); const W=await import('./core/stepWriter.js'); const X=await import('./main/export-flow.js'); const E=await import('./core/state.js');
    const lr=S.lastResult; const P=S.P; const NL=String.fromCharCode(10);
    const shared={ widthIn:P.widthIn, heightIn:P.heightIn, carveZ:P.carveZ, nx:lr.nx, nz:lr.nz, orientation:P.exportOrientation, options:{ clean:true } };
    const t=W.generateThickenedStep(lr.heights, lr.thickenData&&lr.thickenData.offsetPts, { ...shared, baseFilter:'Clean' }, lr.cleanHeights||lr.heights);
    return await this.sha(t.split(NL).slice(4).join(NL)); },
  async send(){ window.fusionJavaScriptHandler.handle('reset_ui','{}'); await new Promise(r=>setTimeout(r,1200)); window.__sends=[]; document.getElementById('btnDownload').click();
    for (let i=0;i<160;i++){ await new Promise(r=>setTimeout(r,500)); if (window.__sends.some(s=>s[0]==='generate_finish'||s[0]==='generate')) break; }
    await new Promise(r=>setTimeout(r,500)); const ch=window.__sends.filter(s=>s[0]==='generate_chunk').map(s=>JSON.parse(s[1])).sort((a,b)=>a.index-b.index).map(c=>c.data);
    const single=window.__sends.find(s=>s[0]==='generate'); const raw=ch.length? ch.join('') : (single&&single[1]); const p=JSON.parse(raw);
    const NL=String.fromCharCode(10); const out={ variants:p.stepVariants.map(v=>v.name) };
    for (const v of p.stepVariants) out['step_'+v.name]=await this.sha(v.stepText.split(NL).slice(4).join(NL));
    out.paramsSha = {}; for (const k of ['frame','boardId','activeLayerIdx','editorSvg','seed','widthIn','heightIn','carveZ','spacing']) out.paramsSha[k]= await this.sha(JSON.stringify(p.params[k]));
    out.hasFramePayload = !!p.frame; out.board = p.board; window.__last=p; return out; }
};
'installed'
