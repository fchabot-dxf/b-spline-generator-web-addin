// STM bus arrivals + route geometry for the Nest Hub display.
//
//   GET  /bus              -> live arrivals for the saved config
//   GET  /bus/index        -> every STM route (for the settings picker)
//   GET  /bus/route/:id    -> shape + stops + metro termini for one route
//   GET  /bus/config       -> saved display config
//   PUT  /bus/config       -> save it
//   GET  /bus/streets?r=id -> street geometry for that route's bbox (KV-cached)
//
// Returns null for every other path so existing worker routes fall through.
// Needs the STM_API_KEY secret and the BUS_DATA KV binding.
// Body size: capped by body.js like every other route.

import { readBoundedBody } from './body.js';

const STM_BASE = 'https://api.stm.info/pub/od/gtfs-rt/ic/v2';
const CACHE_SECONDS = 20;

const DEFAULT_CONFIG = {
  route: '34',
  dirs: [{ dir: 0, stop: '53343', walk: 0 }, { dir: 1, stop: '61593', walk: 3 }],
};

function busJson(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': status === 200 ? 'public, max-age=' + CACHE_SECONDS : 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

function profId(url) {
  const p = (url.searchParams.get('p') || 'default').toLowerCase();
  return p.replace(/[^a-z0-9_-]/g, '').slice(0, 32) || 'default';
}

// Each screen has its own small config record. Route geometry is NOT per
// profile - every profile reads the same shared BUS_DATA route library.
async function getConfig(env, prof) {
  try {
    const raw = await env.BUS_DATA.get('config:' + (prof || 'default'));
    if (raw) return JSON.parse(raw);
    if ((prof || 'default') === 'default') {
      const legacy = await env.BUS_DATA.get('config');   // pre-profile key
      if (legacy) return JSON.parse(legacy);
    }
  } catch (e) {}
  return DEFAULT_CONFIG;
}
async function getRoute(env, id) {
  const raw = await env.BUS_DATA.get('route:' + id);
  return raw ? JSON.parse(raw) : null;
}

export async function handleBus(request, env, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/bus';
  if (p !== '/bus' && !p.startsWith('/bus/')) return null;
  if (!env.BUS_DATA) return busJson({ error: 'BUS_DATA KV binding missing' }, 500);

  try {
    if (p === '/bus/index') {
      const raw = await env.BUS_DATA.get('index');
      return busJson(raw ? JSON.parse(raw) : [], 200);
    }
    if (p.startsWith('/bus/route/')) {
      const r = await getRoute(env, decodeURIComponent(p.slice('/bus/route/'.length)));
      return r ? busJson(r, 200) : busJson({ error: 'unknown route' }, 404);
    }
    if (p === '/bus/whereami') {
      // What Cloudflare infers from the caller's IP alone - no permission needed,
      // but it is ISP-level, not street-level.
      const cf = request.cf || {};
      return busJson({
        city: cf.city || null, region: cf.region || null, country: cf.country || null,
        postalCode: cf.postalCode || null, timezone: cf.timezone || null,
        latitude: cf.latitude || null, longitude: cf.longitude || null,
        asOrganization: cf.asOrganization || null, colo: cf.colo || null,
      }, 200);
    }
    if (p === '/bus/collecte-grid') {
      if (request.method === 'PUT') {
        const r = await readBoundedBody(request); if (r.error) return r.error; const body = r.body;
        try { JSON.parse(body); } catch (e) { return busJson({ error: 'invalid JSON' }, 400); }
        await env.BUS_DATA.put('collecte:grid', body, { metadata: { savedAt: Date.now() } });
        return busJson({ ok: true, bytes: body.length }, 200);
      }
      const raw = await env.BUS_DATA.get('collecte:grid');
      if (!raw) return busJson({ error: 'grid not built' }, 404);
      const g = JSON.parse(raw);
      return busJson({ lat0: g.lat0, lon0: g.lon0, dlat: g.dlat, dlon: g.dlon,
                       nlat: g.nlat, nlon: g.nlon, cells: Object.keys(g.grid).length,
                       schedules: g.schedules.length }, 200);
    }

    if (p === '/bus/collecte') {
      // Montreal Info-collectes schedule, resolved once from the city's GeoJSON
      // sectors and primed per profile (see prime_collecte.py).
      const prof = profId(url);
      if (request.method === 'PUT') {
        const r = await readBoundedBody(request); if (r.error) return r.error; const body = r.body;
        let g;
        try { g = JSON.parse(body); } catch (e) { return busJson({ error: 'invalid JSON' }, 400); }
        await env.BUS_DATA.put('collecte:' + prof, JSON.stringify(g),
          { metadata: { savedAt: Date.now() } });
        return busJson({ ok: true, profile: prof, types: (g.types || []).length }, 200);
      }
      // a located screen resolves its own cell; otherwise fall back to the
      // shared record for this home
      const qlat = Number(url.searchParams.get('lat'));
      const qlon = Number(url.searchParams.get('lon'));
      if (isFinite(qlat) && isFinite(qlon)) {
        const graw = await env.BUS_DATA.get('collecte:grid');
        if (graw) {
          const g = JSON.parse(graw);
          const r = Math.floor((qlat - g.lat0) / g.dlat);
          const c = Math.floor((qlon - g.lon0) / g.dlon);
          if (r >= 0 && r < g.nlat && c >= 0 && c < g.nlon) {
            const ids = g.grid[r + ',' + c];
            if (ids && ids.length) {
              return busJson({ lat: qlat, lon: qlon, source: 'grid',
                               types: ids.map(function (i) { return g.schedules[i]; }) }, 200);
            }
          }
          return busJson({ lat: qlat, lon: qlon, source: 'grid', outside: true, types: [] }, 200);
        }
      }
      let raw = await env.BUS_DATA.get('collecte:' + prof);
      if (!raw && prof !== 'default') raw = await env.BUS_DATA.get('collecte:default');
      return busJson(raw ? JSON.parse(raw) : { types: [] }, 200);
    }
    if (p === '/bus/places') {
      // Named points (home, work, studio). Shared across devices; which one a
      // screen uses is remembered locally, or 'auto' for live location.
      if (request.method === 'PUT') {
        const r = await readBoundedBody(request); if (r.error) return r.error; const body = r.body;
        let list;
        try { list = JSON.parse(body); } catch (e) { return busJson({ error: 'invalid JSON' }, 400); }
        if (!Array.isArray(list)) return busJson({ error: 'expected an array' }, 400);
        const clean = list.slice(0, 24).map(function (x) {
          return { id: String(x.id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24),
                   name: String(x.name || '').slice(0, 40),
                   lat: Number(x.lat), lon: Number(x.lon) };
        }).filter(function (x) { return x.id && isFinite(x.lat) && isFinite(x.lon); });
        await env.BUS_DATA.put('places', JSON.stringify(clean),
          { metadata: { savedAt: Date.now(), count: clean.length } });
        return busJson({ ok: true, places: clean }, 200);
      }
      const raw = await env.BUS_DATA.get('places');
      return busJson(raw ? JSON.parse(raw) : [], 200);
    }

    if (p === '/bus/near') {
      const lat = Number(url.searchParams.get('lat'));
      const lon = Number(url.searchParams.get('lon'));
      const want = Math.min(20, Math.max(1, Number(url.searchParams.get('n')) || 6));
      if (!isFinite(lat) || !isFinite(lon)) return busJson({ error: 'lat and lon required' }, 400);
      const raw = await env.BUS_DATA.get('stops:all');
      if (!raw) return busJson({ error: 'stop index not built' }, 503);
      const idx = JSON.parse(raw);
      // equirectangular is plenty at city scale and far cheaper than haversine
      const k = Math.cos(lat * Math.PI / 180), R = 111320;
      const scored = [];
      for (const st of idx.stops) {
        const dx = (st[3] - lon) * k, dy = st[2] - lat;
        scored.push([dx * dx + dy * dy, st]);
      }
      scored.sort(function (a, b) { return a[0] - b[0]; });
      const out = scored.slice(0, want).map(function (e) {
        const st = e[1];
        return { code: st[0], name: st[1], lat: st[2], lon: st[3],
                 metres: Math.round(Math.sqrt(e[0]) * R),
                 routes: st[4].map(function (r) {
                   return { id: r[0], short: idx.names[r[0]] || r[0], dir: r[1] }; }) };
      });
      return busJson({ lat: lat, lon: lon, stops: out }, 200);
    }

    if (p === '/bus/profiles') {
      const list = await env.BUS_DATA.list({ prefix: 'config:' });
      const names = list.keys.map(function (k) {
        return { id: k.name.slice('config:'.length),
                 savedAt: (k.metadata && k.metadata.savedAt) || null }; });
      if (!names.some(function (n) { return n.id === 'default'; }))
        names.unshift({ id: 'default', savedAt: null });
      return busJson(names, 200);
    }
    if (p === '/bus/config') {
      const prof = profId(url);
      if (request.method === 'DELETE') {
        if (prof === 'default') return busJson({ error: 'cannot delete default' }, 400);
        await env.BUS_DATA.delete('config:' + prof);
        return busJson({ ok: true, deleted: prof }, 200);
      }
      if (request.method === 'PUT') {
        const r = await readBoundedBody(request); if (r.error) return r.error; const body = r.body;
        let cfg;
        try { cfg = JSON.parse(body); } catch (e) { return busJson({ error: 'invalid JSON' }, 400); }
        if (!cfg.route || !Array.isArray(cfg.dirs) || !cfg.dirs.length) {
          return busJson({ error: 'config needs a route and at least one direction' }, 400);
        }
        await env.BUS_DATA.put('config:' + prof, JSON.stringify(cfg),
          { metadata: { savedAt: Date.now() } });
        return busJson({ ok: true, profile: prof, config: cfg }, 200);
      }
      return busJson(await getConfig(env, prof), 200);
    }
    if (p === '/bus/streets') {
      const rid = url.searchParams.get('r') || '34';
      if (request.method === 'PUT') {
        const r = await readBoundedBody(request); if (r.error) return r.error; const body = r.body;
        let g;
        try { g = JSON.parse(body); } catch (e) { return busJson({ error: 'invalid JSON' }, 400); }
        if (!Array.isArray(g.major) || !Array.isArray(g.minor)) {
          return busJson({ error: 'expected {major:[],minor:[]}' }, 400);
        }
        await env.BUS_DATA.put('streets:' + rid, JSON.stringify(g),
          { metadata: { savedAt: Date.now(), ways: g.major.length + g.minor.length } });
        return busJson({ ok: true, route: rid, ways: g.major.length + g.minor.length }, 200);
      }
      return await handleStreets(env, rid);
    }
    if (p === '/bus') return await handleLive(env, profId(url));
    return busJson({ error: 'not found' }, 404);
  } catch (err) {
    return busJson({ error: String((err && err.message) || err) }, 502);
  }
}

// â”€â”€ live arrivals â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function stmFetch(endpoint, key) {
  const res = await fetch(STM_BASE + '/' + endpoint, {
    headers: { apikey: String(key).trim() },   // shells can add a trailing newline
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });
  if (!res.ok) {
    let body = '';
    try { body = (await res.text()).slice(0, 200); } catch (e) {}
    throw new Error('STM ' + endpoint + ' returned ' + res.status + ': ' + body);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function handleLive(env, prof) {
  if (!env.STM_API_KEY) return busJson({ error: 'STM_API_KEY secret is not set' }, 500);
  const cfg = await getConfig(env, prof);
  const route = await getRoute(env, cfg.route);
  if (!route) return busJson({ error: 'route ' + cfg.route + ' not in BUS_DATA' }, 404);

  const tripsBuf = await stmFetch('tripUpdates', env.STM_API_KEY);
  let vehBuf = null;
  try { vehBuf = await stmFetch('vehiclePositions', env.STM_API_KEY); } catch (e) { vehBuf = null; }

  const now = Math.floor(Date.now() / 1000);
  const feed = parseFeed(tripsBuf, cfg.route);

  const directions = cfg.dirs.map(function (c) {
    const dd = route.dirs[String(c.dir)] || null;
    const stopRec = dd ? dd.stops.find(function (x) { return x[0] === c.stop; }) : null;
    const walk = c.walk || 0;
    const deps = [];
    for (const tu of feed.trips) {
      if (!tu.trip || tu.trip.route_id !== cfg.route) continue;
      for (const st of tu.stops) {
        if (st.stop_id !== c.stop) continue;
        const ev = st.departure || st.arrival;
        if (!ev || !ev.time) continue;
        const mins = (ev.time - now) / 60;
        if (mins < -1 || mins > 120) continue;
        deps.push({ t: ev.time, mins: Math.round(mins * 10) / 10,
                    leaveIn: Math.round((mins - walk) * 10) / 10,
                    trip: tu.trip.trip_id || null });
      }
    }
    deps.sort(function (a, b) { return a.t - b.t; });
    const seen = {};
    const uniq = deps.filter(function (d) {
      const k = d.trip + '@' + d.t;
      if (seen[k]) return false; seen[k] = 1; return true;
    });
    return {
      id: c.dir === 1 ? 'ouest' : 'est',
      dir: c.dir, stopCode: c.stop, walkMin: walk,
      stop: stopRec ? stopRec[1] : c.stop,
      stopLat: stopRec ? stopRec[2] : null, stopLon: stopRec ? stopRec[3] : null,
      label: (dd && dd.h) || (c.dir === 1 ? 'Ouest' : 'Est'),
      toward: dd && dd.stops.length ? dd.stops[dd.stops.length - 1][1] : '',
      metro: dd ? dd.metro : [],
      departures: uniq.slice(0, 10),
    };
  });

  let vehicles = [];
  if (vehBuf) {
    vehicles = parseFeed(vehBuf, cfg.route).vehicles
      .filter(function (v) { return v.pos && v.pos.lat; })
      .map(function (v) {
        return { id: (v.vehicle && v.vehicle.id) || null,
                 dir: v.trip.direction_id == null ? null : v.trip.direction_id,
                 lat: Math.round(v.pos.lat * 1e5) / 1e5,
                 lon: Math.round(v.pos.lon * 1e5) / 1e5,
                 bearing: v.pos.bearing == null ? null : Math.round(v.pos.bearing) };
      });
  }

  return busJson({
    now: now, generated: new Date().toISOString(), profile: prof || 'default',
    route: { id: route.id, short: route.short, long: route.long, color: route.color },
    directions: directions, vehicles: vehicles,
  }, 200);
}

// â”€â”€ streets (Overpass, cached in KV per route) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const MAJOR = { motorway: 1, trunk: 1, primary: 1, secondary: 1 };

async function handleStreets(env, routeId) {
  const key = 'streets:' + routeId;
  const hit = await env.BUS_DATA.get(key);
  if (hit) return busJson(JSON.parse(hit), 200);

  const route = await getRoute(env, routeId);
  if (!route) return busJson({ error: 'unknown route' }, 404);

  let minLa = 90, maxLa = -90, minLo = 180, maxLo = -180;
  for (const d of Object.keys(route.dirs)) {
    for (const p of route.dirs[d].shape) {
      if (p[0] < minLa) minLa = p[0];
      if (p[0] > maxLa) maxLa = p[0];
      if (p[1] < minLo) minLo = p[1];
      if (p[1] > maxLo) maxLo = p[1];
    }
  }
  const padLa = (maxLa - minLa) * 0.06 + 0.002, padLo = (maxLo - minLo) * 0.06 + 0.002;
  const bbox = [(minLa - padLa).toFixed(4), (minLo - padLo).toFixed(4),
                (maxLa + padLa).toFixed(4), (maxLo + padLo).toFixed(4)].join(',');

  const q = '[out:json][timeout:60];(way["highway"~"^(motorway|trunk|primary|secondary|' +
            'tertiary|residential|unclassified|living_street)$"](' + bbox + '););out geom;';
  const MIRRORS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://overpass.osm.jp/api/interpreter',
  ];
  let data = null, notes = [];
  for (const m of MIRRORS) {
    try {
      const res = await fetch(m, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded',
                   'User-Agent': 'bus-display/1.0' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) { notes.push(m.split('/')[2] + ':' + res.status); continue; }
      data = await res.json();
      break;
    } catch (e) { notes.push(m.split('/')[2] + ':' + String(e.message || e).slice(0, 40)); }
  }
  if (!data) {
    // streets are decoration; never let them break the map, and don't cache the miss
    return busJson({ bbox: bbox, major: [], minor: [], note: notes.join(' | ') }, 200);
  }

  const major = [], minor = [];
  for (const w of (data.elements || [])) {
    const g = w.geometry;
    if (!g || g.length < 2) continue;
    const pts = [];
    let last = null;
    for (const n of g) {
      if (!last || Math.abs(n.lat - last[0]) + Math.abs(n.lon - last[1]) > 0.00012) {
        pts.push([Math.round(n.lat * 1e5) / 1e5, Math.round(n.lon * 1e5) / 1e5]);
        last = [n.lat, n.lon];
      }
    }
    if (pts.length < 2) continue;
    (MAJOR[w.tags && w.tags.highway] ? major : minor).push(pts);
  }
  const out = { bbox: bbox, major: major, minor: minor };
  try { await env.BUS_DATA.put(key, JSON.stringify(out),
        { metadata: { savedAt: Date.now(), ways: major.length + minor.length } }); } catch (e) {}
  return busJson(out, 200);
}

// â”€â”€ Fast GTFS-Realtime reader (number varints, shared decoder, route pre-filter)
// Optimised GTFS-RT reader: number varints, one shared TextDecoder, and a
// cheap route-id pre-check so non-34 trips never allocate.
const DEC = new TextDecoder();


function makeR(buf){ return {b:buf, p:0}; }
function vi(r){                      // varint -> Number (values here are < 2^53)
  let res=0, shift=1, b;
  do { b=r.b[r.p++]; res += (b & 0x7f) * shift; shift *= 128; } while (b & 0x80);
  return res;
}
function skipField(r, wt){
  if(wt===0) vi(r);
  else if(wt===2){ const n=vi(r); r.p += n; }   // consume length BEFORE advancing
  else if(wt===5) r.p += 4;
  else if(wt===1) r.p += 8;
  else throw new Error("wt"+wt);
}
function str(r,end){ return DEC.decode(r.b.subarray(r.p,end)); }

// Read only route_id/direction_id/trip_id from a TripDescriptor
function readTrip(b, s, e){
  const r={b,p:s}; const t={};
  while(r.p<e){
    const k=vi(r), fn=k>>>3, wt=k&7;
    if(wt===2){ const len=vi(r); const lim=r.p+len;
      if(fn===1) t.trip_id=str(r,lim);
      else if(fn===5) t.route_id=str(r,lim);
      r.p=lim;
    } else if(fn===6 && wt===0){ t.direction_id=vi(r); }
    else skipField(r,wt);
  }
  return t;
}
function readEvent(b,s,e){
  const r={b,p:s}; const ev={};
  while(r.p<e){ const k=vi(r), fn=k>>>3, wt=k&7;
    if(fn===1&&wt===0) ev.delay=vi(r);
    else if(fn===2&&wt===0) ev.time=vi(r);
    else skipField(r,wt); }
  return ev;
}
function readSTU(b,s,e){
  const r={b,p:s}; const o={};
  while(r.p<e){ const k=vi(r), fn=k>>>3, wt=k&7;
    if(wt===2){ const len=vi(r); const lim=r.p+len;
      if(fn===4) o.stop_id=str(r,lim);
      else if(fn===2) o.arrival=readEvent(b,r.p,lim);
      else if(fn===3) o.departure=readEvent(b,r.p,lim);
      r.p=lim;
    } else skipField(r,wt); }
  return o;
}

export function parseFeed(bytes, ROUTE){
  const out={trips:[],vehicles:[]};
  const r=makeR(bytes), end=bytes.length;
  while(r.p<end){
    const k=vi(r), fn=k>>>3, wt=k&7;
    if(fn!==2||wt!==2){ skipField(r,wt); continue; }
    const eLen=vi(r), eEnd=r.p+eLen;
    // walk the FeedEntity
    const er={b:bytes,p:r.p};
    while(er.p<eEnd){
      const k2=vi(er), f2=k2>>>3, w2=k2&7;
      if(w2!==2){ skipField(er,w2); continue; }
      const l2=vi(er), lim2=er.p+l2;
      if(f2===3){                       // trip_update
        // PASS 1 (cheap): find the TripDescriptor, check route, allocate nothing else
        const pr={b:bytes,p:er.p}; let tripS=-1,tripE=-1;
        while(pr.p<lim2){
          const k3=vi(pr), f3=k3>>>3, w3=k3&7;
          if(w3===2){ const l3=vi(pr); if(f3===1){tripS=pr.p;tripE=pr.p+l3;break;} pr.p+=l3; }
          else skipField(pr,w3);
        }
        if(tripS>=0){
          const trip=readTrip(bytes,tripS,tripE);
          if(trip.route_id===ROUTE){    // PASS 2 (rare): only for our route
            const tu={trip,stops:[]};
            const sr={b:bytes,p:er.p};
            while(sr.p<lim2){
              const k4=vi(sr), f4=k4>>>3, w4=k4&7;
              if(w4===2){ const l4=vi(sr); const lim4=sr.p+l4;
                if(f4===2) tu.stops.push(readSTU(bytes,sr.p,lim4));
                sr.p=lim4;
              } else skipField(sr,w4);
            }
            out.trips.push(tu);
          }
        }
      } else if(f2===4){                // vehicle
        const vr={b:bytes,p:er.p}; const v={};
        while(vr.p<lim2){
          const k5=vi(vr), f5=k5>>>3, w5=k5&7;
          if(w5===2){ const l5=vi(vr); const lim5=vr.p+l5;
            if(f5===1) v.trip=readTrip(bytes,vr.p,lim5);
            else if(f5===2){ const pr2={b:bytes,p:vr.p}; const pos={};
              while(pr2.p<lim5){ const k6=vi(pr2), f6=k6>>>3, w6=k6&7;
                if(w6===5){ const dv=new DataView(bytes.buffer,bytes.byteOffset+pr2.p,4);
                  const fv=dv.getFloat32(0,true); pr2.p+=4;
                  if(f6===1)pos.lat=fv; else if(f6===2)pos.lon=fv; else if(f6===3)pos.bearing=fv;
                } else skipField(pr2,w6); }
              v.pos=pos;
            }
            else if(f5===8){ const vd={b:bytes,p:vr.p};
              while(vd.p<lim5){ const k7=vi(vd), f7=k7>>>3, w7=k7&7;
                if(w7===2){ const l7=vi(vd); if(f7===1) v.vehicle={id:str(vd,vd.p+l7)}; vd.p+=l7; }
                else skipField(vd,w7); } }
            vr.p=lim5;
          } else skipField(vr,w5);
        }
        if(v.trip && v.trip.route_id===ROUTE) out.vehicles.push(v);
      }
      er.p=lim2;
    }
    r.p=eEnd;
  }
  return out;
}
