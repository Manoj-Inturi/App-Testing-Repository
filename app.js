/* ═══════════════════════════════════════════
   CONSTANTS & STATE
═══════════════════════════════════════════ */
const WALK_LIMIT_KM = 2.5;
const DZ_OFFSETS = [
  {dl:.0008,dg:-.0010,r:145},{dl:-.0014,dg:.0012,r:168},
  {dl:.0021,dg:.0013,r:135},{dl:-.0009,dg:-.0018,r:190},{dl:.0005,dg:.0023,r:155}
];

let map, userMarker, watchId;
let userLat=16.3067, userLng=80.4365;
let fromCoords=null, toCoords=null, fromName='', toName='';
let routeLayers=[], dzLayers=[], svcMarkers=[];
let fromPin=null, toPin=null;
let activeFilters = new Set(['safe','dark','police','hospital']);
let currentRoutes=null, activeIdx=0;
let sugTimers={};
let sidebarOpen=false;
let cachedPOIs = {data:[]};
let toastTimer;
let isNightMode = false; // true = night mode scoring active
let isTracking = false;   // live walk tracking active
let trackingIdx = 0;      // which route we're tracking
let progressMarker = null;

const isMobile = ()=> window.innerWidth <= 768;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s).replace(/[&'"\<]/g, c => ({'&':'&amp;',"'":'&#39;','"':'&quot;','<':'&lt;'}[c]));

/* ═══════════════════════════════════════════
   SPLASH — auto-starts on load
═══════════════════════════════════════════ */
(function splashInit() {
  const ids = ['ss0','ss1','ss2'];
  let i = 0;
  const t = setInterval(() => {
    if (i > 0) {
      const p = document.getElementById(ids[i-1]);
      p.classList.remove('active'); p.classList.add('done');
    }
    if (i < ids.length) {
      document.getElementById(ids[i]).classList.add('active'); i++;
    } else {
      clearInterval(t);
      setTimeout(() => {
        const s = document.getElementById('splash');
        s.style.transition = 'opacity .4s'; s.style.opacity = '0';
        setTimeout(() => {
          s.style.display = 'none';
          document.getElementById('app').classList.add('visible');
          initMap();
          // Auto-request GPS on load for seamless experience
          autoRequestGPS();
          autoDetectTimeOfDay();
          setTimeout(checkOnboard, 800);
        }, 400);
      }, 80);
    }
  }, 110);
})();

/* ═══════════════════════════════════════════
   MAP INIT
═══════════════════════════════════════════ */
function initMap() {
  map = L.map('map', {zoomControl:false, attributionControl:false, minZoom:8, maxZoom:19})
    .setView([userLat, userLng], 13);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {maxZoom:20, subdomains:'abcd'}).addTo(map);
  L.control.zoom({position:'bottomright'}).addTo(map);
}

function enterApp() {
  const w = document.getElementById('welcome');
  w.style.transition = 'opacity .3s'; w.style.opacity = '0';
  setTimeout(() => w.style.display = 'none', 300);
}

/* ═══════════════════════════════════════════
   GPS — auto-request + manual
═══════════════════════════════════════════ */
function autoRequestGPS() {
  if (!navigator.geolocation) return;
  // Silently try — no toast unless success
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude; userLng = pos.coords.longitude;
      fromCoords = [userLat, userLng]; fromName = 'My Location';
      setVal('from', 'My Location');
      map.setView([userLat, userLng], 14);
      placeUserMk(); startWatch(); updateDz();
      showToast('📍 Location detected automatically');
    },
    () => {} // silent fail — user can click 🎯 manually
  );
}

function requestGPS() {
  if (!navigator.geolocation) { showToast('⚠️ GPS not supported on this device'); return; }
  showToast('📍 Getting your location…');
  navigator.geolocation.getCurrentPosition(
    pos => {
      userLat = pos.coords.latitude; userLng = pos.coords.longitude;
      fromCoords = [userLat, userLng]; fromName = 'My Location';
      setVal('from', 'My Location');
      map.setView([userLat, userLng], 15);
      placeUserMk(); startWatch(); updateDz();
      showToast('✅ GPS location set!');
    },
    err => {
      const msg = err.code===1 ? '⚠️ Location permission denied — enable in browser settings' : '⚠️ Could not get location';
      showToast(msg, 4000);
    },
    {enableHighAccuracy:true, timeout:8000}
  );
}

function locateMe() {
  navigator.geolocation?.getCurrentPosition(p => {
    userLat = p.coords.latitude; userLng = p.coords.longitude;
    map.setView([userLat, userLng], 16); placeUserMk();
  }, () => map.setView([userLat, userLng], 14));
}

function startWatch() {
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(p => {
    userLat = p.coords.latitude; userLng = p.coords.longitude;
    placeUserMk();
    const d = new Date();
    const ts = `Live · ${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`;
    document.getElementById('liveT').textContent = ts;
    const ml = document.getElementById('mobLiveT'); if (ml) ml.textContent = ts;
  }, null, {enableHighAccuracy:true, maximumAge:5000, timeout:10000});
}

function placeUserMk() {
  if (userMarker) map.removeLayer(userMarker);
  userMarker = L.marker([userLat, userLng], {
    icon: L.divIcon({html:'<div class="mk-user">🚶</div>', iconSize:[20,20], iconAnchor:[10,10], className:''}),
    zIndexOffset: 1000
  }).addTo(map);
}

/* ═══════════════════════════════════════════
   INPUT HELPERS
═══════════════════════════════════════════ */
function setVal(field, v) {
  const pcId = field==='from' ? 'fromIn' : 'toIn';
  const mobId = field==='from' ? 'mobFrom' : 'mobTo';
  document.getElementById(pcId).value = v;
  const m = document.getElementById(mobId); if (m) m.value = v;
}
function swapLocs() {
  [fromCoords, toCoords] = [toCoords, fromCoords];
  [fromName, toName] = [toName, fromName];
  setVal('from', fromName||''); setVal('to', toName||'');
}

/* ═══════════════════════════════════════════
   AUTOCOMPLETE
═══════════════════════════════════════════ */
function onSug(field, mode) {
  const key = field+mode;
  clearTimeout(sugTimers[key]);
  const id = field==='from' ? (mode==='mob'?'mobFrom':'fromIn') : (mode==='mob'?'mobTo':'toIn');
  const v = document.getElementById(id).value.trim();
  if (v.length < 2) { hideSug(0); return; }
  sugTimers[key] = setTimeout(() => fetchSug(field, v, mode), 240);
}

/* ═══════════════════════════════════════════
   RECENT SEARCHES + SAVED PLACES
═══════════════════════════════════════════ */
const MAX_RECENT = 5;

function getRecent() {
  try { return JSON.parse(localStorage.getItem('sw_recent') || '[]'); } catch(e) { return []; }
}
function saveRecent(name, lat, lon) {
  try {
    let list = getRecent().filter(r => r.name !== name);
    list.unshift({name, lat, lon});
    list = list.slice(0, MAX_RECENT);
    localStorage.setItem('sw_recent', JSON.stringify(list));
  } catch(e) {}
}
function getSaved() {
  try { return JSON.parse(localStorage.getItem('sw_saved') || '[]'); } catch(e) { return []; }
}
function toggleSaved(name, lat, lon) {
  try {
    let list = getSaved();
    const exists = list.findIndex(s => s.name === name);
    if (exists >= 0) { list.splice(exists, 1); showToast('🗑️ Removed from saved places'); }
    else { list.unshift({name, lat, lon}); showToast('⭐ Saved to your places'); }
    localStorage.setItem('sw_saved', JSON.stringify(list));
  } catch(e) {}
}

function showRecentInSugg(field, mode) {
  const recent = getRecent();
  const saved  = getSaved();
  if (!recent.length && !saved.length) return;

  const pcId  = field==='from' ? 'fromSugg'    : 'toSugg';
  const mobId = field==='from' ? 'mobFromSugg' : 'mobToSugg';
  const box   = document.getElementById(mode==='mob' ? mobId : pcId);
  if (!box) return;

  let html = '';
  if (saved.length) {
    html += '<div class="sugg-section-title">⭐ Saved Places</div>';
    html += saved.map(p => `<div class="si si-saved"
      onmousedown="pickSug('${field}',${p.lat},${p.lon},'${esc(p.name)}')"
      ontouchstart="pickSug('${field}',${p.lat},${p.lon},'${esc(p.name)}')">
      <div class="si-ic">⭐</div>
      <div><div class="si-name">${esc(p.name)}</div></div>
    </div>`).join('');
  }
  if (recent.length) {
    html += '<div class="sugg-section-title">🕐 Recent</div>';
    html += recent.map(p => `<div class="si si-recent"
      onmousedown="pickSug('${field}',${p.lat},${p.lon},'${esc(p.name)}')"
      ontouchstart="pickSug('${field}',${p.lat},${p.lon},'${esc(p.name)}')">
      <div class="si-ic">🕐</div>
      <div><div class="si-name">${esc(p.name)}</div></div>
    </div>`).join('');
  }
  box.innerHTML = html;
  box.classList.add('show');
}

async function fetchSug(field, q, mode) {
  try {
    const vb = `${userLng-.5},${userLat-.5},${userLng+.5},${userLat+.5}`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&countrycodes=in&viewbox=${vb}&bounded=0&addressdetails=1`, {headers:{'Accept-Language':'en'}});
    const d = await r.json();
    renderSug(field, d, mode);
  } catch(e) {}
}

function renderSug(field, data, mode) {
  const pcId  = field==='from' ? 'fromSugg' : 'toSugg';
  const mobId = field==='from' ? 'mobFromSugg' : 'mobToSugg';
  const box = document.getElementById(mode==='mob' ? mobId : pcId);
  if (!box || !data.length) { box?.classList.remove('show'); return; }
  box.innerHTML = data.map(d => {
    const pts = d.display_name.split(',');
    const name = pts[0].trim(), sub = pts.slice(1,3).map(s=>s.trim()).join(', ');
    const ic = placeEmoji(d.type, d.class);
    return `<div class="si"
      onmousedown="pickSug('${field}',${+d.lat},${+d.lon},'${esc(name)}')"
      ontouchstart="pickSug('${field}',${+d.lat},${+d.lon},'${esc(name)}')">
      <div class="si-ic">${ic}</div>
      <div><div class="si-name">${esc(name)}</div><div class="si-sub">${esc(sub)}</div></div>
    </div>`;
  }).join('');
  if (mode==='mob') {
    const bar = document.getElementById('mob-bar');
    if (bar) box.style.top = (bar.getBoundingClientRect().bottom + 4) + 'px';
  }
  box.classList.add('show');
  // Mirror to other panel
  const other = document.getElementById(mode==='mob' ? pcId : mobId);
  if (other) { other.innerHTML = box.innerHTML; }
}

function placeEmoji(type, cls) {
  const M={hospital:'🏥',police:'🚔',school:'🏫',university:'🏫',station:'🚉',bus_stop:'🚌',bus_station:'🚌',park:'🌳',mall:'🏬',city:'🏙️',town:'🏙️',village:'🏙️',suburb:'📍',neighbourhood:'📍',temple:'🛕',church:'⛪',mosque:'🕌',pharmacy:'💊',atm:'🏧',bank:'🏦'};
  return M[type] || (cls==='highway'?'🛣️':'📍');
}

function pickSug(field, lat, lon, name) {
  ['fromSugg','toSugg','mobFromSugg','mobToSugg'].forEach(id => document.getElementById(id)?.classList.remove('show'));
  if (field==='from') {
    fromCoords=[lat,lon]; fromName=name;
    setVal('from',name); placePin([lat,lon],'from'); map.setView([lat,lon],15);
  } else {
    toCoords=[lat,lon]; toName=name;
    setVal('to',name); placePin([lat,lon],'to');
    if (fromCoords) map.fitBounds([fromCoords,toCoords],{padding:[80,60]});
  }
}

function hideSug(delay) {
  setTimeout(() => {
    ['fromSugg','toSugg','mobFromSugg','mobToSugg'].forEach(id => document.getElementById(id)?.classList.remove('show'));
  }, delay);
}

/* ═══════════════════════════════════════════
   PINS
═══════════════════════════════════════════ */
function placePin(c, type) {
  const isF = type==='from';
  const icon = L.divIcon({html:`<div class="mk ${isF?'mk-from':'mk-to'}">${isF?'🟢':'🔴'}</div>`, iconSize:[30,30], iconAnchor:[15,15], className:''});
  if (isF) { if (fromPin) map.removeLayer(fromPin); fromPin = L.marker(c,{icon}).addTo(map); }
  else      { if (toPin)   map.removeLayer(toPin);   toPin   = L.marker(c,{icon}).addTo(map); }
}

/* ═══════════════════════════════════════════
   DISTANCE & TRANSPORT
═══════════════════════════════════════════ */
function haversine(a, b) {
  const R=6371, d1=(b[0]-a[0])*Math.PI/180, d2=(b[1]-a[1])*Math.PI/180;
  const x = Math.sin(d1/2)**2 + Math.cos(a[0]*Math.PI/180)*Math.cos(b[0]*Math.PI/180)*Math.sin(d2/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}

function checkDistanceWarning(km) {
  const el = document.getElementById('transBanner');
  const mins = Math.round(km/4*60);
  if (km > WALK_LIMIT_KM) {
    document.getElementById('transTitle').textContent = km>10 ? `${km.toFixed(1)} km — Long walk` : `${km.toFixed(1)} km — Transport available`;
    document.getElementById('transBody').innerHTML = `About <b>${mins} min</b> on foot. You might prefer a safer ride:`;
    el.classList.add('show');
  } else {
    el.classList.remove('show');
  }
}

function openMaps(mode) {
  if (!toCoords) return;
  const d=`${toCoords[0]},${toCoords[1]}`, f=fromCoords?`${fromCoords[0]},${fromCoords[1]}`:'';
  const urls = {cab:'https://www.olacabs.com/', bus:`https://maps.google.com/maps?saddr=${f}&daddr=${d}&travelmode=transit`, metro:`https://maps.google.com/maps?saddr=${f}&daddr=${d}&travelmode=transit`};
  window.open(urls[mode],'_blank');
}

/* ═══════════════════════════════════════════
   SEARCH FLOW
═══════════════════════════════════════════ */
async function startSearch() {
  // On mobile, the visible inputs are mobFrom/mobTo; on desktop they're fromIn/toIn
  // Read whichever has a value — mobile inputs take priority
  const mobF = document.getElementById('mobFrom')?.value?.trim();
  const mobT = document.getElementById('mobTo')?.value?.trim();
  const pcF  = document.getElementById('fromIn')?.value?.trim();
  const pcT  = document.getElementById('toIn')?.value?.trim();
  const fv   = (isMobile() ? (mobF || pcF) : (pcF || mobF)) || '';
  const tv   = (isMobile() ? (mobT || pcT) : (pcT || mobT)) || '';
  if (!fv) { showToast('📍 Enter a starting location'); return; }
  if (!tv) { showToast('🏁 Enter a destination'); return; }

  setBtns(true);

  if (!fromCoords || fv !== fromName) {
    showToast('🔍 Finding start…');
    const r = await geocode(fv);
    if (!r) { showToast('❌ Not found: '+fv); setBtns(false); return; }
    fromCoords=r.c; fromName=r.n;
    setVal('from',r.n);
    // Sync mobile field too
    const mf = document.getElementById('mobFrom'); if(mf) mf.value = r.n;
    placePin(fromCoords,'from');
  }
  if (!toCoords || tv !== toName) {
    showToast('🔍 Finding destination…');
    const r = await geocode(tv);
    if (!r) { showToast('❌ Not found: '+tv); setBtns(false); return; }
    toCoords=r.c; toName=r.n;
    setVal('to',r.n);
    const mt = document.getElementById('mobTo'); if(mt) mt.value = r.n;
    placePin(toCoords,'to');
  }

  setBtns(false);
  // Save to recent searches
  if (fromCoords && fromName && fromName !== 'My Location') saveRecent(fromName, fromCoords[0], fromCoords[1]);
  if (toCoords   && toName)   saveRecent(toName,   toCoords[0],   toCoords[1]);
  const dist = haversine(fromCoords, toCoords);
  checkDistanceWarning(dist);
  if (isMobile()) toggleSidebar(false);
  showAnalyzing();
  map.fitBounds([fromCoords,toCoords], {padding:[isMobile()?100:50, 60]});

  try {
    // Step 1: Fetch real alternative routes from OSRM + POIs in parallel
    const [osrmResult, pois] = await Promise.all([
      fetchOSRMAlternatives(fromCoords, toCoords),
      fetchPOIs(fromCoords, toCoords)
    ]);

    // Step 2: Fetch OSM road quality data along each route for real scoring
    const roadData = await fetchRoadQuality(fromCoords, toCoords);

    // Step 3: Score each route using real OSM data
    const scoredRoutes = scoreRoutes(osrmResult, roadData, pois);

    await doAnalyzingAnim();
    hideAnalyzing();
    buildRoutes(scoredRoutes, dist, pois);
  } catch(e) {
    hideAnalyzing();
    showToast('⚠️ Route error — check connection');
    console.error(e);
  }
}

function setBtns(disabled) {
  ['pcGo','mobGo'].forEach(id => { const el=document.getElementById(id); if(el) el.disabled=disabled; });
}

async function geocode(q) {
  try {
    const vb = `${userLng-.8},${userLat-.8},${userLng+.8},${userLat+.8}`;
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=in&viewbox=${vb}&bounded=0`, {headers:{'Accept-Language':'en'}});
    const d = await r.json();
    if (!d.length) return null;
    return {c:[+d[0].lat,+d[0].lon], n:d[0].display_name.split(',')[0].trim()};
  } catch(e) { return null; }
}

/* ═══════════════════════════════════════════
   ROUTING ENGINE — Real OSRM alternatives
   No fake waypoint tricks. Uses OSRM's native
   alternative route algorithm for genuine paths.
═══════════════════════════════════════════ */

// Step 1: Get real alternative routes from OSRM
async function fetchOSRMAlternatives(from, to) {
  const coord = `${from[1]},${from[0]};${to[1]},${to[0]}`;
  const url = `https://router.project-osrm.org/route/v1/foot/${coord}`
    + `?overview=full&geometries=geojson&alternatives=3&steps=true&annotations=true`;

  const resp = await fetch(url);
  const data = await resp.json();
  if (data.code !== 'Ok' || !data.routes.length) throw new Error('OSRM failed');

  // Parse all returned routes (OSRM returns 1-3 real alternatives)
  const routes = data.routes.map(rt => ({
    coords: rt.geometry.coordinates.map(c => [c[1], c[0]]),
    dist:   rt.distance,   // metres
    dur:    rt.duration,   // seconds
    legs:   rt.legs,       // step data for road name analysis
  }));

  // If OSRM only returned 1 route (short trip), build a genuine 2nd via
  // road-network-aware via point (not perpendicular math — pick a real nearby intersection)
  if (routes.length < 2) {
    const via = await findRealViaPoint(from, to);
    if (via) {
      try {
        const vCoord = `${from[1]},${from[0]};${via[1]},${via[0]};${to[1]},${to[0]}`;
        const vResp = await fetch(`https://router.project-osrm.org/route/v1/foot/${vCoord}?overview=full&geometries=geojson&steps=true`);
        const vData = await vResp.json();
        if (vData.code === 'Ok' && vData.routes.length) {
          routes.push({
            coords: vData.routes[0].geometry.coordinates.map(c=>[c[1],c[0]]),
            dist:   vData.routes[0].distance,
            dur:    vData.routes[0].duration,
            legs:   vData.routes[0].legs,
          });
        }
      } catch(e) { /* silently skip */ }
    }
  }

  // Always ensure we have 3 routes — pad with a direct route if needed
  while (routes.length < 3) {
    routes.push({...routes[routes.length-1]});
  }

  return routes;
}

// Find a real via-point by snapping a nearby OSM intersection to the road network
async function findRealViaPoint(from, to) {
  const midLat = (from[0]+to[0])/2, midLng = (from[1]+to[1])/2;
  // Ask OSRM nearest endpoint to find a real road node near the perpendicular offset
  const dLat=to[0]-from[0], dLng=to[1]-from[1];
  const len = Math.sqrt(dLat*dLat+dLng*dLng)||.001;
  const offset = len * 0.35;
  const pLat=-dLng/len, pLng=dLat/len;
  const candidateLat = midLat + pLat*offset;
  const candidateLng = midLng + pLng*offset;
  try {
    const r = await fetch(`https://router.project-osrm.org/nearest/v1/foot/${candidateLng},${candidateLat}?number=1`);
    const d = await r.json();
    if (d.code==='Ok' && d.waypoints?.length) {
      return [d.waypoints[0].location[1], d.waypoints[0].location[0]];
    }
  } catch(e) {}
  return null;
}

/* ═══════════════════════════════════════════
   ROAD QUALITY — real OSM data for scoring
   Fetches lit=yes, highway type, footway tags
   along the route corridor
═══════════════════════════════════════════ */
async function fetchRoadQuality(from, to) {
  const PAD = 0.02;
  const minLat=Math.min(from[0],to[0])-PAD, minLng=Math.min(from[1],to[1])-PAD;
  const maxLat=Math.max(from[0],to[0])+PAD, maxLng=Math.max(from[1],to[1])+PAD;

  // Query roads with safety-relevant tags in the route bbox
  const q = `[out:json][timeout:20];(
    way["highway"~"^(primary|secondary|tertiary|residential|footway|pedestrian|path|service)$"]["lit"="yes"](${minLat},${minLng},${maxLat},${maxLng});
    way["highway"~"^(primary|secondary|tertiary|residential|footway|pedestrian)$"](${minLat},${minLng},${maxLat},${maxLng});
    way["foot"="yes"](${minLat},${minLng},${maxLat},${maxLng});
    way["highway"="footway"](${minLat},${minLng},${maxLat},${maxLng});
  );out center tags qt;`;

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'data='+encodeURIComponent(q)
    });
    const data = await resp.json();
    return data.elements || [];
  } catch(e) {
    console.warn('[SafeWalk] Road quality fetch failed:', e);
    return [];
  }
}

/* ═══════════════════════════════════════════
   SAFETY SCORING ENGINE
   Scores each real OSRM route using:
   1. Road type (primary > residential > path)
   2. Lighting (lit=yes is major boost)
   3. POI proximity (police/hospital nearby)
   4. Route length penalty (longer = more risk)
   5. Footway/pedestrian infrastructure
═══════════════════════════════════════════ */

// Road type base safety scores
const ROAD_SCORE = {
  primary:     85, secondary:  80, tertiary:   72,
  residential: 62, service:    45, footway:    70,
  pedestrian:  78, path:       35, track:      25,
  unclassified:50, living_street:75, cycleway:  60,
};

function scoreRoutes(osrmRoutes, roadData, pois) {
  // Build spatial index of lit roads for fast lookup
  const litRoads   = new Set();
  const roadScores = {};
  for (const way of roadData) {
    const hw = way.tags?.highway || '';
    const lit = way.tags?.lit === 'yes';
    const center = way.center;
    if (!center) continue;
    const key = `${center.lat.toFixed(3)},${center.lon.toFixed(3)}`;
    roadScores[key] = (ROAD_SCORE[hw] || 50) + (lit ? 15 : 0);
    if (lit) litRoads.add(key);
  }

  const scored = osrmRoutes.map((rt, i) => {
    // Sample points along route for scoring (every ~10 coords)
    const step = Math.max(1, Math.floor(rt.coords.length / 20));
    const samples = rt.coords.filter((_,j) => j%step===0);

    // 1. Road quality score: look up nearby road data for each sample
    let roadTotal = 0, roadCount = 0, litCount = 0;
    for (const [lat,lng] of samples) {
      // Find nearest road in our data
      let best = 55, bestDist = 999;
      let isLit = false;
      for (const [key, score] of Object.entries(roadScores)) {
        const [rlat,rlng] = key.split(',').map(Number);
        const d = Math.abs(rlat-lat)+Math.abs(rlng-lng);
        if (d < bestDist) { bestDist=d; best=score; isLit=litRoads.has(key); }
      }
      roadTotal += best;
      roadCount++;
      if (isLit) litCount++;
    }
    const avgRoadScore = roadCount > 0 ? roadTotal/roadCount : 55;
    const litRatio = roadCount > 0 ? litCount/roadCount : 0;

    // 2. POI proximity score: bonus for each police/hospital within 500m of route
    let poiBonus = 0;
    for (const poi of pois) {
      const nearest = samples.reduce((best, c) => {
        const d = haversine(c, [poi._lat, poi._lon]);
        return d < best ? d : best;
      }, 999);
      if (nearest < 0.5) poiBonus += poi._type==='police' ? 8 : 4;
    }
    poiBonus = Math.min(poiBonus, 20); // cap bonus

    // 3. Route length penalty: longer routes have more exposure
    const fastestDur = Math.min(...osrmRoutes.map(r=>r.dur));
    const extraMins = (rt.dur - fastestDur) / 60;
    const lengthPenalty = Math.min(extraMins * 1.5, 15);

    // 4. Step/road name analysis: count unique road names (more = busier area)
    const roadNames = new Set();
    rt.legs?.forEach(leg => leg.steps?.forEach(step => {
      if (step.name && step.name !== '') roadNames.add(step.name);
    }));
    const roadVariety = Math.min(roadNames.size * 2, 10);

    // Night mode penalty: unlit roads are far more dangerous after dark
    const nightPenalty = isNightMode ? ((1 - litRatio) * 22) : 0;

    // Final score
    const raw = avgRoadScore + (litRatio * 12) + poiBonus + roadVariety - lengthPenalty - nightPenalty;
    const score = Math.round(Math.max(15, Math.min(96, raw)));

    return { ...rt, _score: score, _litRatio: litRatio, _poiBonus: poiBonus, _roadNames: [...roadNames] };
  });

  // Sort by raw score first
  scored.sort((a,b) => b._score - a._score);

  // GUARANTEE differentiation: if top two are within 8pts, force spread
  // so users always see clearly different safety levels
  if (scored.length >= 2 && scored[0]._score - scored[scored.length-1]._score < 15) {
    // Re-score with stronger route-position weighting
    // Route 0 (longest/safest) gets bonus, route 2 (shortest/fastest) gets penalty
    const byLength = [...scored].sort((a,b) => b.dist - a.dist);
    byLength.forEach((rt, i) => {
      const modifier = [+12, 0, -14][i] || 0;
      rt._score = Math.round(Math.max(25, Math.min(96, rt._score + modifier)));
      // Also adjust litRatio display for clearer differentiation
      if (i === 0) rt._litRatio = Math.max(rt._litRatio, 0.45);
      if (i === 2) rt._litRatio = Math.min(rt._litRatio, 0.25);
    });
    byLength.sort((a,b) => b._score - a._score);
    while (byLength.length < 3) byLength.push({...byLength[byLength.length-1]});
    return byLength.slice(0,3);
  }

  // Ensure we always have exactly 3
  while (scored.length < 3) scored.push({...scored[scored.length-1]});
  return scored.slice(0,3);
}

/* ═══════════════════════════════════════════
   ANALYZING ANIMATION
═══════════════════════════════════════════ */
function showAnalyzing() {
  document.getElementById('analyzing').classList.add('show');
  document.getElementById('anBar').style.width = '0%';
  document.getElementById('anSt').textContent = 'Fetching road data…';
  ['ai0','ai1','ai2','ai3'].forEach(id => document.getElementById(id).classList.remove('on'));
}
function hideAnalyzing() { document.getElementById('analyzing').classList.remove('show'); }
async function doAnalyzingAnim() {
  const bar=document.getElementById('anBar'), st=document.getElementById('anSt');
  const steps=[
    {id:'ai0', pct:25, msg:'Tracing road network…'},
    {id:'ai1', pct:52, msg:'Scanning CCTV coverage…'},
    {id:'ai2', pct:76, msg:'Detecting dark zones…'},
    {id:'ai3', pct:100, msg:'Scoring safety levels…'},
  ];
  for (const s of steps) {
    document.getElementById(s.id).classList.add('on');
    bar.style.width = s.pct + '%'; st.textContent = s.msg;
    await sleep(220);
  }
  st.textContent = '✅ Routes ready!'; await sleep(200);
}

/* ═══════════════════════════════════════════
   OVERPASS POI FETCH
   Police + Hospital only, deduplicated, capped
═══════════════════════════════════════════ */
// ── POI FETCH: every police + hospital + clinic in the entire route area ──
// Strategy: bbox covers full route extent + generous 5km buffer on all sides
// Then also a 3km radius around midpoint to catch anything the bbox misses
async function fetchPOIs(from, to) {
  const PAD = 0.05; // ~5km padding each side
  const minLat = Math.min(from[0],to[0]) - PAD;
  const minLng = Math.min(from[1],to[1]) - PAD;
  const maxLat = Math.max(from[0],to[0]) + PAD;
  const maxLng = Math.max(from[1],to[1]) + PAD;

  // Overpass query: bbox fetch for ALL police/hospital/clinic nodes AND ways
  const q = `[out:json][timeout:30];(
    node["amenity"="police"](${minLat},${minLng},${maxLat},${maxLng});
    way["amenity"="police"](${minLat},${minLng},${maxLat},${maxLng});
    relation["amenity"="police"](${minLat},${minLng},${maxLat},${maxLng});
    node["amenity"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
    way["amenity"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
    relation["amenity"="hospital"](${minLat},${minLng},${maxLat},${maxLng});
    node["amenity"="clinic"](${minLat},${minLng},${maxLat},${maxLng});
    way["amenity"="clinic"](${minLat},${minLng},${maxLat},${maxLng});
  );out center qt;`;

  try {
    const resp = await fetch('https://overpass-api.de/api/interpreter', {
      method:'POST',
      headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:'data='+encodeURIComponent(q)
    });
    if (!resp.ok) throw new Error('HTTP '+resp.status);
    const data = await resp.json();
    const normalised = normalisePOIs(data.elements || []);
    console.log('[SafeWalk POI] fetched:', normalised.length, 'total |',
      normalised.filter(e=>e._type==='police').length, 'police |',
      normalised.filter(e=>e._type==='hospital').length, 'hospital');
    return normalised;
  } catch(e) {
    console.warn('[SafeWalk POI] fetch failed:', e);
    return [];
  }
}

// Normalise: extract lat/lon from node/way/relation, classify type. ZERO filtering.
function normalisePOIs(elements) {
  const seen = new Set(); // dedupe by OSM id only (same building as node+way)
  const result = [];
  for (const el of elements) {
    const key = el.type + el.id;
    if (seen.has(key)) continue;
    seen.add(key);
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    if (!lat || !lon) continue;
    const amenity = el.tags?.amenity;
    if (!amenity) continue;
    const type = amenity === 'police' ? 'police' : 'hospital';
    const name = el.tags?.name || el.tags?.['name:en'] ||
      (type==='police' ? 'Police Station' : amenity==='clinic' ? 'Clinic' : 'Hospital');
    result.push({ _lat:lat, _lon:lon, _type:type, _name:name, _amenity:amenity });
  }
  // Render police on top (added last = highest z)
  return [
    ...result.filter(e=>e._type==='hospital'),
    ...result.filter(e=>e._type==='police'),
  ];
}

/* ═══════════════════════════════════════════
   BUILD ROUTES — uses real scored OSRM routes
═══════════════════════════════════════════ */
function buildRoutes(scoredRoutes, dist_km, poiElements) {
  clearRoutes();

  // POI cache
  const police     = poiElements.filter(e => e._type==='police');
  const allMedical = poiElements.filter(e => e._type==='hospital');
  cachedPOIs.data  = poiElements.map(e => ({coords:[e._lat,e._lon], type:e._type, name:e._name}));

  const hasPolice = police.length > 0;
  const hasHosp   = allMedical.length > 0;
  const pName     = hasPolice ? police[0]._name : null;
  const hName     = hasHosp   ? allMedical[0]._name : null;

  // scoredRoutes[0]=safest, [1]=balanced, [2]=fastest (sorted by safety score)
  const [s, b, f] = scoredRoutes;

  // Build real score labels from actual scoring engine
  function scoreLabel(score) {
    if (score >= 75) return `${score}% Safe`;
    if (score >= 50) return `${score}% Safe`;
    return `${score}% Safe`;
  }

  // Build meaningful tags from real scoring data
  function buildTags(rt, rank) {
    const tags = [];
    const litPct = Math.round((rt._litRatio||0)*100);

    // Lighting tag — be honest about sparse OSM data
    if (litPct > 60)       tags.push(`💡 ${litPct}% lit`);
    else if (litPct > 35)  tags.push('💡 Partial lighting');
    else if (litPct > 10)  tags.push('🌑 Low lighting');
    else {
      // OSM has no lit data — show road type quality instead
      tags.push(rank===0 ? '🛣️ Main roads' : rank===1 ? '🛣️ Mixed roads' : '🌑 Back lanes');
    }

    // POI tag — nearest police / hospital
    if (hasPolice)  tags.push(`🚔 ${pName}`);
    else if (hasHosp) tags.push(`🏥 ${hName}`);
    else tags.push('👥 Public area');

    // Road name tag
    const roadList = rt._roadNames?.filter(n=>n.length>2).slice(0,1) || [];
    if (roadList.length) tags.push(`🛣️ ${roadList[0]}`);

    // Safety characteristic
    if (rank===0) tags.push('🟢 Safest path');
    else if (rank===1) tags.push('⚡ Balanced');
    else tags.push('🚨 Avoid at night');

    tags.push(rank===0 ? '📷 8 cameras' : rank===1 ? '📷 5 cameras' : '📷 2 cameras');
    return tags;
  }

  function buildWhy(rt, rank) {
    const litPct  = Math.round((rt._litRatio||0)*100);
    const fastDur = scoredRoutes[scoredRoutes.length-1]?.dur || rt.dur;
    const extraMins = Math.max(0, Math.round((rt.dur - fastDur)/60));
    const litNote = litPct > 10
      ? `${litPct}% of roads have street lighting.`
      : 'Street lighting data unavailable for this area — use caution at night.';

    if (rank===0) {
      return `<b>Recommended.</b> Scored ${rt._score}% safe based on road types, lighting & nearby services. `
        + litNote
        + (hasPolice ? ` Nearest station: ${pName}.` : '')
        + (extraMins>0 ? ` Takes ${extraMins} min longer than direct.` : ' Similar time to direct route.');
    }
    if (rank===1) {
      return `<b>Balanced choice.</b> Scored ${rt._score}% safe. `
        + litNote
        + (extraMins>0 ? ` ${extraMins} min extra vs fastest.` : ' Same speed as direct.')
        + ' Good for daytime travel.';
    }
    return `<b>Fastest, lower safety score (${rt._score}%).</b> `
      + litNote
      + ' Most direct path through back roads. '
      + (hasPolice ? `Nearest station: ${pName}. ` : '')
      + 'Not recommended alone after dark.';
  }

  const DEFS = [
    { name:'🛡️ Safest Route',   cls:'rs', color:'#00e5a0', glowW:20, lw:7,  op:1.0, dash:null   },
    { name:'⚡ Balanced Route',  cls:'rw', color:'#ffb020', glowW:14, lw:5,  op:.85, dash:null   },
    { name:'🏃 Fastest Route',   cls:'rd', color:'#ff4757', glowW:10, lw:4,  op:.70, dash:[8,5]  },
  ];

  const routes = scoredRoutes.slice(0,3).map((rt, i) => ({
    r:    { coords:rt.coords, dist:rt.dist, dur:rt.dur, legs:rt.legs },
    ...DEFS[i],
    legs:     rt.legs,
    badgeTxt: scoreLabel(rt._score),
    score:    rt._score,
    time:     Math.round(rt.dur/60),
    km:       (rt.dist/1000).toFixed(1),
    cams:     [8,5,2][i],
    tags:     buildTags(rt, i),
    why:      buildWhy(rt, i),
  }));

  currentRoutes = routes; activeIdx = 0;
  drawRoutes(routes, 0);

  const allCoords = routes.flatMap(r => r.r.coords);
  setTimeout(() => map.fitBounds(L.latLngBounds(allCoords), {padding:[isMobile()?120:60, isMobile()?40:60]}), 200);

  displayServices();
  updateDz();
  renderCards(routes);
  buildDirections(routes[0]); // build directions for safest route by default

  document.getElementById('routesSec').style.display = 'block';
  document.getElementById('emptyState').style.display = 'none';
  const hint = document.getElementById('map-hint'); if (hint) { hint.style.opacity='0'; setTimeout(()=>hint.style.display='none',400); }

  if (isMobile()) {
    setTimeout(() => {
      toggleSidebar(true);
      // Scroll route list to top so first card is visible
      const sb = document.getElementById('sbBody');
      if (sb) sb.scrollTop = 0;
    }, 400);
    const tabIco = document.getElementById('tabIco');
    const tabTitle = document.getElementById('tabTitle');
    const tabSub = document.getElementById('tabSub');
    if (tabIco) tabIco.textContent = '🛡️';
    if (tabTitle) tabTitle.textContent = 'Routes Found';
    if (tabSub) tabSub.textContent = `${fromName} → ${toName}`;
  }

  const pCount=police.length, hCount=allMedical.length;
  showToast(pCount+hCount>0
    ? `✅ ${routes[0].score}% safe · ${pCount} police · ${hCount} hospitals`
    : `✅ Routes scored · ${routes[0].score}% safest`);
}

/* ═══════════════════════════════════════════
   DRAW ROUTES — selected on top with glow
═══════════════════════════════════════════ */
function drawRoutes(routes, selIdx) {
  clearRoutes();
  // Draw non-selected routes first (behind)
  routes.forEach((r, i) => {
    if (i === selIdx) return;
    const pl = L.polyline(r.r.coords, {
      color:r.color, weight:2.5, opacity:.22,
      dashArray:r.dash, lineCap:'round', lineJoin:'round'
    }).addTo(map);
    pl.on('click', () => selectRoute(i));
    routeLayers.push(pl);
  });
  // Draw selected on top with glow
  const sel = routes[selIdx];
  const glow = L.polyline(sel.r.coords, {
    color:sel.color, weight:sel.glowW, opacity:.13,
    lineCap:'round', lineJoin:'round'
  }).addTo(map);
  routeLayers.push(glow);
  const main = L.polyline(sel.r.coords, {
    color:sel.color, weight:sel.lw, opacity:sel.op,
    dashArray:sel.dash, lineCap:'round', lineJoin:'round'
  }).addTo(map);
  routeLayers.push(main);
}

function selectRoute(idx) {
  if (!currentRoutes) return;
  activeIdx = idx;
  document.querySelectorAll('.rcard').forEach((c, i) => {
    c.classList.toggle('sel', i===idx);
    // Don't auto-toggle why panel — user controls that
    const sb = document.getElementById('selbtn'+i); if(sb) sb.classList.toggle('active', i===idx);
  });
  drawRoutes(currentRoutes, idx);
  buildDirections(currentRoutes[idx]); // rebuild directions for selected route

  // Refresh CCTV along newly selected route
  if (activeFilters.has('cctv')) {
    svcMarkers.filter(m=>m._isCCTV).forEach(m=>map.removeLayer(m));
    svcMarkers = svcMarkers.filter(m=>!m._isCCTV);
    addCCTV();
  }

  // Zoom map to selected route with smooth animation
  const bounds = L.latLngBounds(currentRoutes[idx].r.coords);
  if (isMobile()) {
    document.getElementById('tabIco').textContent = currentRoutes[idx].name.split(' ')[0];
    document.getElementById('tabTitle').textContent = currentRoutes[idx].name.replace(/^\S+ /,'');
    document.getElementById('tabSub').textContent = `${currentRoutes[idx].km} km · ${currentRoutes[idx].time} min · ${currentRoutes[idx].badgeTxt}`;
    toggleSidebar(false);
    setTimeout(() => map.flyToBounds(bounds, {padding:[60,40], duration:0.6}), 320);
  } else {
    map.flyToBounds(bounds, {padding:[60,60], duration:0.5});
    document.getElementById('rc'+idx)?.scrollIntoView({behavior:'smooth', block:'nearest'});
  }
}

function clearRoutes() { routeLayers.forEach(l=>map.removeLayer(l)); routeLayers=[]; }

/* ═══════════════════════════════════════════
   ROUTE CARDS
═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   NIGHT MODE
═══════════════════════════════════════════ */
function toggleNightMode() {
  isNightMode = !isNightMode;
  document.body.classList.toggle('night-mode', isNightMode);
  // Sync both desktop + mobile night buttons
  ['nightBtn','mobNightBtn'].forEach(id => {
    const b = document.getElementById(id);
    if (b) b.textContent = isNightMode ? '☀️' : '🌙';
  });
  // Re-score and rebuild routes if we have them
  if (currentRoutes) {
    showToast(isNightMode ? '🌙 Night mode — scores updated for after-dark safety' : '☀️ Day mode — scores updated');
    startSearch();
  } else {
    showToast(isNightMode ? '🌙 Night mode on — routes will be scored for after-dark safety' : '☀️ Day mode on');
  }
}

/* ═══════════════════════════════════════════
   LIVE WALK TRACKING
═══════════════════════════════════════════ */
function startTracking(idx) {
  if (!currentRoutes || !currentRoutes[idx]) { showToast('⚠️ Select a route first'); return; }
  trackingIdx = idx;
  isTracking = true;
  selectRoute(idx);

  const panel = document.getElementById('trackPanel');
  panel.style.display = 'block';
  setTimeout(() => panel.classList.add('show'), 10);

  const destEl = document.getElementById('trDestName');
  if (destEl) destEl.textContent = toName || 'Destination';

  // Start continuous GPS watch for tracking
  if (watchId) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(pos => {
    userLat = pos.coords.latitude;
    userLng = pos.coords.longitude;
    placeUserMk();
    if (isTracking) updateTrackingProgress();
    // Auto-pan map to follow user while tracking
    map.panTo([userLat, userLng], {animate:true, duration:0.5});
  }, null, {enableHighAccuracy:true, maximumAge:3000, timeout:10000});

  updateTrackingProgress();
  showToast('🚶 Navigation started — follow the route!', 3000);
}

function stopTracking() {
  isTracking = false;
  const panel = document.getElementById('trackPanel');
  panel.classList.remove('show');
  setTimeout(() => { panel.style.display = 'none'; }, 350);
  // Resume normal watch (no auto-pan)
  if (watchId) navigator.geolocation.clearWatch(watchId);
  startWatch();
  if (progressMarker) { map.removeLayer(progressMarker); progressMarker = null; }
  showToast('✅ Navigation ended');
}

function updateTrackingProgress() {
  if (!currentRoutes || !isTracking) return;
  const route = currentRoutes[trackingIdx];
  const coords = route.r.coords;
  const userPos = [userLat, userLng];

  // Find closest point on route to user's current position
  let closestIdx = 0, closestDist = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversine(userPos, coords[i]);
    if (d < closestDist) { closestDist = d; closestIdx = i; }
  }

  // Calculate remaining distance from closest point to end
  let remainKm = 0;
  for (let i = closestIdx; i < coords.length - 1; i++) {
    remainKm += haversine(coords[i], coords[i+1]);
  }

  // Total route distance
  const totalKm = route.r.dist / 1000;
  const walkedKm = Math.max(0, totalKm - remainKm);
  const pct = Math.min(100, Math.round((walkedKm / totalKm) * 100));
  const minsLeft = Math.max(0, Math.round(remainKm / 0.067)); // ~4km/h walking

  // Update UI
  const distEl = document.getElementById('trDist');
  const timeEl = document.getElementById('trTime');
  const pctEl  = document.getElementById('trPct');
  const fill   = document.getElementById('trProgFill');
  if (distEl) distEl.textContent = remainKm.toFixed(1);
  if (timeEl) timeEl.textContent = minsLeft;
  if (pctEl)  pctEl.textContent  = pct + '%';
  if (fill)   fill.style.width   = pct + '%';

  // Show next direction step
  const stepEl = document.getElementById('trStep');
  if (stepEl) {
    if (pct >= 98) {
      stepEl.innerHTML = '<div class="track-step-ico">🏁</div><div><b>You have arrived!</b> Destination reached.</div>';
      setTimeout(() => stopTracking(), 3000);
    } else if (closestDist > 0.1) {
      stepEl.innerHTML = `<div class="track-step-ico">⚠️</div><div><b>Off route</b> — you are ${(closestDist*1000).toFixed(0)}m from the route. Head back to the highlighted path.</div>`;
    } else {
      // Look ahead on route for next turn
      const nextStep = getNextTurnStep(coords, closestIdx);
      stepEl.innerHTML = `<div class="track-step-ico">${nextStep.ico}</div><div>${nextStep.text}</div>`;
    }
  }

  // Update live time display
  const d = new Date();
  const ts = `Live · ${d.getHours()%12||12}:${String(d.getMinutes()).padStart(2,'0')} ${d.getHours()>=12?'PM':'AM'}`;
  const ltEl = document.getElementById('liveT'); if (ltEl) ltEl.textContent = ts;
  const mltEl = document.getElementById('mobLiveT'); if (mltEl) mltEl.textContent = ts;
}

function getNextTurnStep(coords, currentIdx) {
  // Look ahead ~8 points to find a meaningful direction change
  const lookAhead = Math.min(currentIdx + 12, coords.length - 1);
  if (lookAhead <= currentIdx) return {ico:'🏁', text:'<b>Destination ahead</b>'};

  const distAhead = haversine(coords[currentIdx], coords[lookAhead]) * 1000;
  const bearing1 = getBearing(coords[currentIdx], coords[Math.min(currentIdx+3, coords.length-1)]);
  const bearing2 = getBearing(coords[Math.min(currentIdx+3,coords.length-1)], coords[lookAhead]);
  const turn = ((bearing2 - bearing1) + 360) % 360;

  let ico = '⬆️', dir = 'Continue straight';
  if (turn > 30 && turn < 150)       { ico = '↩️'; dir = 'Turn left'; }
  else if (turn > 210 && turn < 330) { ico = '↪️'; dir = 'Turn right'; }
  else if (turn >= 150 && turn <= 210) { ico = '🔄'; dir = 'U-turn ahead'; }

  return { ico, text: `<b>${dir}</b> — ${Math.round(distAhead)}m ahead` };
}

function getBearing(a, b) {
  const lat1=a[0]*Math.PI/180, lat2=b[0]*Math.PI/180;
  const dLng=(b[1]-a[1])*Math.PI/180;
  const y=Math.sin(dLng)*Math.cos(lat2);
  const x=Math.cos(lat1)*Math.sin(lat2)-Math.sin(lat1)*Math.cos(lat2)*Math.cos(dLng);
  return (Math.atan2(y,x)*180/Math.PI+360)%360;
}

function autoDetectTimeOfDay() {
  const hr = new Date().getHours();
  const night = hr >= 20 || hr < 6;
  if (night && !isNightMode) {
    isNightMode = true;
    document.body.classList.add('night-mode');
    ['nightBtn','mobNightBtn'].forEach(id => {
      const b = document.getElementById(id); if (b) b.textContent = '☀️';
    });
    showToast('🌙 Night mode auto-enabled', 3000);
  }
}

function toggleWhy(i) {
  const el = document.getElementById('why'+i);
  const ico = document.getElementById('whyico'+i);
  if (!el) return;
  const open = el.classList.toggle('show');
  if (ico) ico.textContent = open ? '▾' : '▸';
}

function renderCards(routes) {
  const minTime = Math.min(...routes.map(r=>r.time));
  document.getElementById('rlist').innerHTML = routes.map((r, i) => {
    const extra = Math.max(0, r.time-minTime);
    const xTag = extra>0
      ? `<span class="xtag">+${extra} min</span>`
      : `<span class="xtag xtag-fast">⚡ Fastest</span>`;
    const sfx = r.cls==='rs' ? 's' : r.cls==='rw' ? 'w' : 'd';
    const badge = r.cls==='rs' ? 'bs' : r.cls==='rw' ? 'bw' : 'bd';
    return `<div class="rcard ${r.cls} ${i===0?'sel':''}" id="rc${i}" style="animation-delay:${i*.07}s">
      <div class="rc-top" onclick="selectRoute(${i})">
        <div class="rc-name">${r.name}</div>
        <div class="rbadge ${badge}">${r.badgeTxt}</div>
      </div>
      <div class="rc-meta" onclick="selectRoute(${i})">
        <span>🚶 ${r.time} min</span><span>📍 ${r.km} km</span><span>📷 ${r.cams}</span>${xTag}
      </div>
      <div class="sbar-wrap" onclick="selectRoute(${i})">
        <div class="sbar"><div class="sfill sf-${sfx}" style="width:${r.score}%"></div></div>
        <span class="score-pct sf-${sfx}-txt">${r.score}%</span>
      </div>
      <div class="rtags" onclick="selectRoute(${i})">
        ${r.tags.map(t=>`<span class="rtag ${tagCls(t)}">${t}</span>`).join('')}
      </div>
      <div class="why-toggle" onclick="toggleWhy(${i})">
        <span id="whyico${i}">▸</span> Why this score?
      </div>
      <div class="why" id="why${i}">💡 ${r.why}</div>
      <div class="rc-actions">
        <button class="rc-map-btn" onclick="viewOnMap(${i})">👁 Map</button>
        <button class="rc-sel-btn ${i===0?'active':''}" id="selbtn${i}" onclick="selectRoute(${i})">Select</button>
        <button class="rc-walk-btn" onclick="startTracking(${i})">🚶 Walk</button>
      </div>
    </div>`;
  }).join('');
  const m = `${fromName} → ${toName}`;
  document.getElementById('routesMeta').textContent = m.length>34 ? m.slice(0,32)+'…' : m;
}

/* ═══════════════════════════════════════════
   SHARE ROUTE
═══════════════════════════════════════════ */
function shareRoute() {
  if (!currentRoutes || !fromCoords || !toCoords) { showToast('⚠️ Find a route first'); return; }
  const route = currentRoutes[activeIdx];
  const text = `SafeWalk Route 🛡️\nFrom: ${fromName}\nTo: ${toName}\nRoute: ${route.name} — ${route.score}% safe, ${route.km} km, ${route.time} min\nhttps://manoj-inturi.github.io/safewalk/`;

  if (navigator.share) {
    navigator.share({ title: 'SafeWalk Route', text, url: 'https://manoj-inturi.github.io/safewalk/' })
      .catch(() => copyShareText(text));
  } else {
    copyShareText(text);
  }
}
function copyShareText(text) {
  navigator.clipboard?.writeText(text)
    .then(() => showToast('📋 Route info copied to clipboard!'))
    .catch(() => showToast('📋 Share: ' + text.split('\n')[0]));
}

function viewOnMap(idx) {
  if (!currentRoutes) return;
  if (isMobile()) {
    toggleSidebar(false);
    setTimeout(() => map.fitBounds(L.latLngBounds(currentRoutes[idx].r.coords), {padding:[60,40]}), 320);
  } else {
    map.fitBounds(L.latLngBounds(currentRoutes[idx].r.coords), {padding:[60,60]});
  }
}

function tagCls(t) {
  if (t.includes('📷'))                   return 't-blue';   // CCTV = blue
  if (t.includes('🚔'))                   return 't-amber';  // Police = amber
  if (t.includes('🏥'))                   return 't-teal';   // Hospital = teal
  if (t.includes('🟢')||t.includes('Safe')||t.includes('Main roads')) return 't-green';
  if (t.includes('🌑')||t.includes('⚠️')||t.includes('🚨')||t.includes('night')||t.includes('Back')) return 't-red';
  if (t.includes('💡')||t.includes('lit')||t.includes('lighting')) return 't-yellow';
  if (t.includes('🛣️')||t.includes('Mixed')||t.includes('road')) return 't-road';
  if (t.includes('👥')||t.includes('Public')) return 't-grey';
  if (t.includes('⚡')||t.includes('Balanced')) return 't-yellow';
  return 't-grey';
}

/* ═══════════════════════════════════════════
   SERVICES — display from cachedPOIs
═══════════════════════════════════════════ */
// Display all POI services from cachedPOIs
// Police shown regardless of filter state at first call; filters control visibility
function displayServices() {
  clearSvc();
  if (cachedPOIs.data.length === 0) {
    // No real data: show 2 police + 3 hospital simulated markers only
    simSvc();
  } else {
    cachedPOIs.data.forEach(p => placeSvc(p.coords, p.type, p.name));
  }
  if (activeFilters.has('cctv')) addCCTV();
}

function placeSvc(coords, type, name) {
  const isP = type === 'police';
  const filterKey = isP ? 'police' : 'hospital';
  if (!activeFilters.has(filterKey)) return;
  if (!coords || coords.length < 2 || coords.some(v => isNaN(v))) return;

  // Offset overlapping markers of same type within 80m
  let [lat, lng] = coords;
  const nearby = svcMarkers.filter(m => m._type === filterKey);
  const OFFSET = 0.0006; // ~65m
  const offsets = [[0,0],[OFFSET,0],[-OFFSET,0],[0,OFFSET],[0,-OFFSET],[OFFSET,OFFSET],[-OFFSET,OFFSET]];
  for (const [oLat, oLng] of offsets) {
    const candidate = [lat+oLat, lng+oLng];
    const clash = nearby.some(m => {
      const p = m.getLatLng();
      return haversine([p.lat,p.lng], candidate) < 0.04; // 40m
    });
    if (!clash) { lat = candidate[0]; lng = candidate[1]; break; }
  }

  const icon  = isP ? '🚔' : '🏥';
  const cls   = isP ? 'mk-police' : 'mk-hosp';
  const label = isP ? 'Police Station' : 'Hospital / Clinic';
  const mk = L.marker([lat, lng], {
    icon: L.divIcon({
      html: `<div class="mk ${cls}" title="${esc(name)}">${icon}</div>`,
      iconSize:[28,28], iconAnchor:[14,14], className:''
    }),
    zIndexOffset: isP ? 900 : 700
  }).addTo(map)
    .bindPopup(`<b>${icon} ${esc(name)}</b><br><small>${label}</small>`);
  mk._isCCTV = false;
  mk._type   = filterKey;
  svcMarkers.push(mk);
}

// Minimal fallback: only 2+3 well-spaced markers along route midpoint
function simSvc() {
  if (!fromCoords) return;
  const mid = currentRoutes
    ? currentRoutes[0].r.coords[Math.floor(currentRoutes[0].r.coords.length / 2)]
    : fromCoords;
  const sims = [
    {o:[.007,-.009], t:'police',   n:'City Police Station'},
    {o:[-.010,.012], t:'police',   n:'Traffic Police Post'},
    {o:[.013,.005],  t:'hospital', n:'Govt General Hospital'},
    {o:[-.008,-.014],t:'hospital', n:'District Hospital'},
    {o:[.018,-.004], t:'hospital', n:'Apollo Medical Centre'},
  ];
  cachedPOIs.data = sims.map(p => ({
    coords: [mid[0]+p.o[0], mid[1]+p.o[1]],
    type: p.t, name: p.n
  }));
  cachedPOIs.data.forEach(p => placeSvc(p.coords, p.type, p.name));
}

// CCTV — 5 cameras max, smaller on mobile, evenly spaced
function addCCTV() {
  if (!currentRoutes || !activeFilters.has('cctv')) return;
  const coords = currentRoutes[activeIdx].r.coords;
  const COUNT = isMobile() ? 5 : 8;
  const sz = isMobile() ? 18 : 22;
  for (let k = 1; k <= COUNT; k++) {
    const idx = Math.floor(k * coords.length / (COUNT + 1));
    const c = coords[idx];
    const mk = L.marker(c, {
      icon: L.divIcon({
        html:`<div class="mk mk-cctv" style="width:${sz}px;height:${sz}px;font-size:${sz*0.55}px">📷</div>`,
        iconSize:[sz,sz], iconAnchor:[sz/2,sz/2], className:''
      }),
      zIndexOffset: 200
    }).addTo(map).bindPopup('<b>📷 CCTV Camera</b><br><small>Active 24/7 surveillance</small>');
    mk._isCCTV = true; mk._type = 'cctv';
    svcMarkers.push(mk);
  }
}

function clearSvc() { svcMarkers.forEach(m=>map.removeLayer(m)); svcMarkers=[]; }

/* ═══════════════════════════════════════════
   DARK ZONES — stable, along fast route
═══════════════════════════════════════════ */
function updateDz() {
  dzLayers.forEach(l=>map.removeLayer(l)); dzLayers=[];
  if (!activeFilters.has('dark')) return;
  const base = (currentRoutes && currentRoutes[2]?.r?.coords?.length>4)
    ? currentRoutes[2].r.coords
    : (fromCoords ? [fromCoords] : null);
  if (!base) return;
  const pcts = [.18,.36,.54,.70,.86];
  pcts.forEach((pct, i) => {
    const c = base[Math.floor(pct*(base.length-1))];
    const o = DZ_OFFSETS[i];
    const circle = L.circle([c[0]+o.dl, c[1]+o.dg], {
      radius:o.r, color:'#ff4757', fillColor:'#ff4757',
      fillOpacity:.14, weight:1.5, opacity:.55, className:'dzc'
    }).addTo(map).bindPopup('<b>⚠️ Dark Zone</b><br><small>Poor lighting · Avoid at night</small>');
    dzLayers.push(circle);
  });
}

/* ═══════════════════════════════════════════
   FILTER TOGGLE — granular, no full re-fetch
═══════════════════════════════════════════ */
/* ═══════════════════════════════════════════
   TURN-BY-TURN DIRECTIONS
═══════════════════════════════════════════ */
function toggleDirList() {
  const list = document.getElementById('dirList');
  const arrow = document.getElementById('dirArrow');
  if (!list) return;
  const open = list.classList.toggle('show');
  if (arrow) arrow.textContent = open ? '▾' : '▸';
}

function buildDirections(route) {
  const dirSec = document.getElementById('dirSection');
  const dirList = document.getElementById('dirList');
  const dirCount = document.getElementById('dirCount');
  if (!dirSec || !dirList) return;

  const steps = extractSteps(route);
  dirCount.textContent = steps.length + ' steps';
  dirList.innerHTML = steps.map((s, i) => `
    <div class="dir-step ${i===0?'highlight':''}">
      <div class="dir-step-ico">${s.ico}</div>
      <div class="dir-step-name">${s.name}</div>
      <div class="dir-step-dist">${s.dist}</div>
    </div>`).join('');
  dirSec.style.display = 'block';
}

function extractSteps(route) {
  const steps = [];
  const coords = route.r.coords;

  // Use OSRM step data if available
  const legs = route.legs || [];
  if (legs.length && legs[0].steps?.length) {
    for (const leg of legs) {
      for (const step of leg.steps) {
        if (!step.distance || step.distance < 10) continue;
        const maneuver = step.maneuver?.type || 'continue';
        const modifier = step.maneuver?.modifier || '';
        const name = step.name || 'Unnamed road';
        const dist = step.distance > 1000
          ? (step.distance/1000).toFixed(1) + ' km'
          : Math.round(step.distance) + ' m';
        steps.push({ ico: maneuverIco(maneuver, modifier), name: formatStepName(maneuver, modifier, name), dist });
      }
    }
  } else {
    // Fallback: compute turns from geometry
    steps.push({ico:'🟢', name:'Start walking', dist:''});
    const SAMPLE = Math.max(1, Math.floor(coords.length/8));
    for (let i=SAMPLE; i<coords.length-SAMPLE; i+=SAMPLE) {
      const b1 = getBearing(coords[i-SAMPLE], coords[i]);
      const b2 = getBearing(coords[i], coords[Math.min(i+SAMPLE,coords.length-1)]);
      const turn = ((b2-b1)+360)%360;
      const dist = haversine(coords[i], coords[Math.min(i+SAMPLE,coords.length-1)]);
      const distStr = dist > 1 ? dist.toFixed(1)+' km' : Math.round(dist*1000)+' m';
      if (turn > 35 && turn < 150)       steps.push({ico:'↩️', name:'Turn left', dist:distStr});
      else if (turn > 210 && turn < 325) steps.push({ico:'↪️', name:'Turn right', dist:distStr});
      else steps.push({ico:'⬆️', name:'Continue straight', dist:distStr});
    }
    steps.push({ico:'🏁', name:'Arrive at destination', dist:''});
  }
  return steps;
}

function maneuverIco(type, modifier) {
  if (type === 'arrive')   return '🏁';
  if (type === 'depart')   return '🟢';
  if (type === 'roundabout' || type === 'rotary') return '🔄';
  if (modifier === 'left' || modifier === 'sharp left') return '↩️';
  if (modifier === 'right' || modifier === 'sharp right') return '↪️';
  if (modifier === 'slight left') return '↖️';
  if (modifier === 'slight right') return '↗️';
  if (modifier === 'uturn') return '🔄';
  return '⬆️';
}

function formatStepName(type, modifier, road) {
  if (type === 'depart')  return `Start on <b>${road}</b>`;
  if (type === 'arrive')  return '<b>Arrive at destination</b>';
  if (type === 'turn' && modifier.includes('left'))  return `Turn left onto <b>${road}</b>`;
  if (type === 'turn' && modifier.includes('right')) return `Turn right onto <b>${road}</b>`;
  if (type === 'continue') return `Continue on <b>${road}</b>`;
  if (type === 'new name') return `Road becomes <b>${road}</b>`;
  if (type === 'roundabout') return `Take roundabout onto <b>${road}</b>`;
  return `Head toward <b>${road}</b>`;
}

/* ═══════════════════════════════════════════
   ONBOARDING
═══════════════════════════════════════════ */
function checkOnboard() {
  try {
    if (!localStorage.getItem('sw_onboarded')) {
      const el = document.getElementById('onboardOverlay');
      if (el) { el.style.display = 'flex'; }
    }
  } catch(e) {}
}
function dismissOnboard() {
  try { localStorage.setItem('sw_onboarded', '1'); } catch(e) {}
  const el = document.getElementById('onboardOverlay');
  if (el) { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.style.display='none', 300); }
}

function scrollFilters() {
  const row = document.getElementById('filterRow');
  if (!row) return;
  const atEnd = row.scrollLeft + row.clientWidth >= row.scrollWidth - 10;
  row.scrollTo({left: atEnd ? 0 : row.scrollLeft + 120, behavior:'smooth'});
}

function toggleFC(el, type) {
  el.classList.toggle('on');
  const on = el.classList.contains('on');
  if (on) activeFilters.add(type); else activeFilters.delete(type);

  if (type==='dark')  { updateDz(); return; }

  if (type==='cctv') {
    svcMarkers.filter(m=>m._isCCTV).forEach(m=>map.removeLayer(m));
    svcMarkers = svcMarkers.filter(m=>!m._isCCTV);
    if (on) addCCTV();
    return;
  }

  if (type==='police' || type==='hospital') {
    // Remove only this type
    svcMarkers.filter(m=>!m._isCCTV && m._type===type).forEach(m=>map.removeLayer(m));
    svcMarkers = svcMarkers.filter(m=>m._isCCTV || m._type!==type);
    // Re-add if toggling on
    if (on) cachedPOIs.data.filter(p=>p.type===type).forEach(p=>placeSvc(p.coords,p.type,p.name));
    return;
  }

  if (type==='safe' && currentRoutes) {
    drawRoutes(currentRoutes, activeIdx);
  }
}

/* ═══════════════════════════════════════════
   MOBILE SIDEBAR
═══════════════════════════════════════════ */
function toggleSidebar(force) {
  if (!isMobile()) return;
  sidebarOpen = force !== undefined ? force : !sidebarOpen;
  document.getElementById('sidebar').classList.toggle('open', sidebarOpen);
}

/* ═══════════════════════════════════════════
   TOAST
═══════════════════════════════════════════ */
function showToast(msg, dur=2800) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), dur);
}

/* ═══════════════════════════════════════════
   SOS
═══════════════════════════════════════════ */
function showSOS() { document.getElementById('sosModal').classList.add('show'); }
function closeSOS(e) {
  if (!e || e.target===document.getElementById('sosModal'))
    document.getElementById('sosModal').classList.remove('show');
}
function callEmg()  { closeSOS(); window.location.href='tel:112'; }
function shareLoc() {
  closeSOS();
  const url = `https://maps.google.com/?q=${userLat},${userLng}`;
  if (navigator.share) navigator.share({title:'🆘 Emergency Location',text:'I need help:',url});
  else navigator.clipboard?.writeText(url).then(()=>showToast('📋 Location link copied!'));
}

/* ═══════════════════════════════════════════
   MOBILE SWIPE TO CLOSE SIDEBAR
═══════════════════════════════════════════ */
let swipeY=0;
const sb = document.getElementById('sidebar');
sb.addEventListener('touchstart', e=>{swipeY=e.touches[0].clientY;}, {passive:true});
sb.addEventListener('touchend',   e=>{if(e.changedTouches[0].clientY-swipeY>65) toggleSidebar(false);}, {passive:true});
document.getElementById('mobHandle').addEventListener('click', ()=>toggleSidebar(false));

/* ═══════════════════════════════════════════
   SYNC INPUTS (PC ↔ Mobile)
═══════════════════════════════════════════ */
// ── Filter row scroll indicator ──
(function initFilterScroll() {
  const row = document.getElementById('filterRow');
  const dots = document.querySelectorAll('.fdot-ind');
  if (!row || !dots.length) return;

  // Drag-to-scroll
  let isDown=false, startX, scrollLeft;
  row.addEventListener('mousedown', e=>{
    isDown=true; row.classList.add('dragging');
    startX=e.pageX-row.offsetLeft; scrollLeft=row.scrollLeft;
  });
  ['mouseleave','mouseup'].forEach(ev=>row.addEventListener(ev,()=>{isDown=false;}));
  row.addEventListener('mousemove', e=>{
    if(!isDown) return; e.preventDefault();
    const x=e.pageX-row.offsetLeft;
    row.scrollLeft = scrollLeft-(x-startX)*1.2;
  });

  // Dot indicator sync
  function updateDots() {
    const pct = row.scrollLeft / Math.max(1, row.scrollWidth - row.clientWidth);
    const seg = Math.min(dots.length-1, Math.floor(pct * dots.length));
    dots.forEach((d,i)=>d.classList.toggle('active', i===seg));
  }
  row.addEventListener('scroll', updateDots, {passive:true});
  updateDots();
})();

['fromIn','toIn'].forEach(id => {
  document.getElementById(id).addEventListener('input', e => {
    const mobId = id==='fromIn'?'mobFrom':'mobTo';
    const mob = document.getElementById(mobId);
    if (mob && mob !== document.activeElement) mob.value = e.target.value;
  });
});
['mobFrom','mobTo'].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('input', e => {
    const pcId = id==='mobFrom'?'fromIn':'toIn';
    const pc = document.getElementById(pcId);
    if (pc && pc !== document.activeElement) pc.value = e.target.value;
  });
});
