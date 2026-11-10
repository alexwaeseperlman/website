/* Turns level builder and community levels.
   A classic script loaded after the game's own script, so it shares the game's globals
   (L, custom, playCustom, completions, thumb, acctDialog, sb, user, ...).
   - #build    the editor: grow a board from a few dots, colour it, link it, test it, solve it, publish it
   - #explore  levels other people have published
   - #l=<id>   play one published level (the share link)
   Published levels live in the Supabase table `turns_levels` (see tools/turns-solver/levels.sql). */
(() => {
const V = '20261110a';
const BTOOLS = ['ccw', 'cw', 'r90', 'r-90', 'r120', 'r-120'];
const COLS = ['r', 'g', 'y'], COLNAME = { r:'red', g:'green', y:'gold' }, COLVAR = { r:'var(--red)', g:'var(--green)', y:'var(--gold)' };
const MAXPTS = 64, MAXTRACKED = 16, GHOSTS = 10;   // GHOSTS: how many of the smallest shapes are sketched faintly at once
const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const BACK = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>';

/* ================= markup ================= */
document.head.insertAdjacentHTML('beforeend', `<style>
#build{overflow:hidden}
#build .page-head{position:static;gap:8px}
#bName{flex:1;min-width:0;font:inherit;font-size:17px;padding:6px 10px;border:2px solid var(--border);border-radius:8px;background:var(--card);color:var(--ink);-webkit-user-select:text;user-select:text}
#bName:focus,#bHint:focus,.b-in:focus{outline:none;border-color:var(--blue)}
#bBoard{flex:1;min-height:150px;position:relative;touch-action:none}
#bBoard svg{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}
.b-dock{width:100%;max-width:560px;margin:0 auto}
.b-dock .seg{margin:8px 0 10px}
.b-dock .seg button{padding:6px 4px}
#bPanel{min-height:92px}
#bPanel .row{margin-bottom:8px;flex-wrap:wrap}
#bPanel .opt{flex:1;text-align:center;color:var(--grey);font-size:15px;font-variant-numeric:tabular-nums}
#bPanel .lab{font-size:13px;color:var(--grey);width:44px;flex-shrink:0}
.brush{width:44px;height:38px;padding:0;display:flex;align-items:center;justify-content:center;border-color:var(--border)}
.brush[aria-pressed="true"]{border-color:var(--sel);background:color-mix(in srgb, var(--sel) 14%, var(--card))}
.brush svg{width:26px;height:26px}
.btool{width:50px;height:50px;padding:0;border-radius:12px;display:flex;align-items:center;justify-content:center;border-color:var(--border);opacity:.55}
.btool svg{width:36px;height:36px;overflow:visible}
.btool[aria-pressed="true"]{opacity:1;border-color:var(--sel);background:color-mix(in srgb, var(--sel) 14%, var(--card))}
#bHint,.b-in{width:100%;font:inherit;font-size:15px;padding:6px 10px;border:2px solid var(--border);border-radius:8px;background:var(--field);color:var(--ink);-webkit-user-select:text;user-select:text}
.b-par{margin-top:4px}
.b-par .meta b{color:var(--ink);font-weight:600}
.b-acts{margin-top:8px}
.b-acts button{flex:1}
.xcard{display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:8px 12px;margin-top:10px;border-color:var(--border);border-radius:10px;background:var(--card)}
.xcard svg.thumb{width:60px;height:60px;flex-shrink:0}
.xcard .xt{flex:1;min-width:0}
.xcard .xn{font-weight:600;color:var(--blue);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xcard .xm{font-size:13px;color:var(--grey);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.xcard .stars{font-size:15px;flex-shrink:0}
#xSort{margin-top:14px}
#xMore{display:block;margin:14px auto 0}
#xMore[hidden]{display:none}
.x-msg{color:var(--grey);margin:18px 0;text-align:center}
.d-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:2px solid var(--border)}
.d-row svg.thumb{width:44px;height:44px;flex-shrink:0}
.d-row .xt{flex:1;min-width:0}
.d-row button{font-size:14px;padding:4px 10px}
.share-link{display:block;width:100%;font:inherit;font-size:15px;padding:8px 10px;border:2px solid var(--border);border-radius:8px;background:var(--field);color:var(--ink);-webkit-user-select:all;user-select:all}
.hint .by{color:var(--grey);white-space:nowrap}
</style>`);

$('howtoBtn').insertAdjacentHTML('beforebegin', `
  <button id="exploreBtn" class="big"><span>Community levels<small>Play levels other people made</small></span><span class="go" aria-hidden="true">›</span></button>
  <button id="buildBtn" class="big"><span>Level builder<small>Make and share your own</small></span><span class="go" aria-hidden="true">›</span></button>`);

document.querySelector('script[src^="builder.js"]').insertAdjacentHTML('beforebegin', `
<section class="screen" id="build" aria-label="Level builder">
  <div class="page-head">
    <button id="bBack" class="icon-btn" aria-label="Back to menu">${BACK}</button>
    <input id="bName" maxlength="40" placeholder="Level name" aria-label="Level name" autocomplete="off">
    <button id="bDrafts">My levels</button>
  </div>
  <div id="bBoard" aria-label="Level board. Tap dots to select them."><svg></svg></div>
  <div class="dock b-dock">
    <div class="status" id="bStatus" aria-live="polite"></div>
    <div class="seg" id="bModes">
      <button data-m="points">Dots</button><button data-m="colors">Colors</button><button data-m="links">Links</button><button data-m="tools">Tools</button>
    </div>
    <div id="bPanel"></div>
    <div class="row b-par"><span class="meta" id="bPar"></span><button id="bSolve">Run solver</button></div>
    <div class="row b-acts"><button id="bUndo">Undo</button><button id="bTest">Test</button><button id="bPublish" class="primary">Publish</button></div>
  </div>
</section>
<section class="screen" id="explore" aria-label="Community levels">
  <div class="page-head">
    <button id="xBack" class="icon-btn" aria-label="Back to menu">${BACK}</button>
    <h2>Community</h2><button id="xBuild">Make a level</button>
  </div>
  <div class="page-body">
    <div class="seg" id="xSort"><button data-s="new">Newest</button><button data-s="top">Most played</button></div>
    <div id="xList"></div>
    <button id="xMore" hidden>Load more</button>
  </div>
</section>`);
SCREENS.push('build', 'explore');

/* ================= levels as data ================= */
const dist = (a, b) => Math.hypot(a[0]-b[0], a[1]-b[1]);
function minDist(pts){ let md = Infinity; for (let i=0;i<pts.length;i++) for (let j=i+1;j<pts.length;j++) md = Math.min(md, dist(pts[i], pts[j])); return isFinite(md) ? md : 1; }
// Turns anything (a draft, or a row someone else published) into a level the game can play, or null.
// Nothing from the outside is trusted: indices are range-checked, text is escaped, and a stored
// solution only counts if replaying it really solves the level in `par` moves.
function cleanLevel(d, name){
  try{
    const n = d.pts.length; if (!(n >= 3 && n <= MAXPTS)) return null;
    const pts = d.pts.map(p => [+p[0], +p[1]]);
    if (pts.some(p => !isFinite(p[0]) || !isFinite(p[1]) || Math.abs(p[0]) > 1e4 || Math.abs(p[1]) > 1e4) || minDist(pts) < .02) return null;
    const okI = i => Number.isInteger(i) && i >= 0 && i < n;
    const pair = l => Array.isArray(l) && okI(l[0]) && okI(l[1]) && l[0] !== l[1];
    const start = pts.map((_, i) => COLS.includes(d.start[i]) ? d.start[i] : null);
    const goal = (d.goal || []).filter(g => Array.isArray(g) && okI(g[0]) && COLS.includes(g[1])).map(g => [g[0], g[1]]);
    const tools = BTOOLS.filter(t => (d.tools || []).includes(t));
    if (!tools.length || !goal.length) return null;
    const lv = { chapter:'Community', name: String(name || 'Untitled').slice(0, 40), hint: esc(String(d.hint || '').slice(0, 200)), pts, start, goal, tools,
      links: (d.links || []).filter(pair).map(l => [l[0], l[1]]), arrows: (d.arrows || []).filter(pair).map(l => [l[0], l[1]]) };
    if (Number.isInteger(d.par) && d.par > 0 && d.par < 1000 && Array.isArray(d.sol) && d.sol.length === d.par &&
        d.sol.every(m => m && tools.includes(m.t) && Array.isArray(m.s) && m.s.length >= 3 && m.s.every(okI))){
      lv.sol = d.sol.map(m => ({ s: m.s.slice(), t: m.t }));
      const fr = solFrames(lv);
      if (fr && fr.ok){ lv.par = d.par; lv.parMoves = lv.sol.map(m => [m.s.length, 0]); } else delete lv.sol;
    }
    return lv;
  }catch(e){ return null; }
}
// what stops a draft from being a playable level, in the author's words
function problems(d){
  const out = [];
  if (d.pts.length < 3) out.push('Add more dots: a level needs at least three.');
  if (!d.tools.length) out.push('Pick at least one turn in the Tools tab.');
  if (!d.goal.length) out.push('Add a goal ring in the Colors tab.');
  for (const c of COLS){
    const rings = d.goal.filter(g => g[1] === c).length, dots = d.start.filter(x => x === c).length;
    if (rings > dots) out.push(`There are more ${COLNAME[c]} rings than ${COLNAME[c]} dots.`);
  }
  if (d.goal.length && d.goal.every(([i, c]) => d.start[i] === c)) out.push('The level starts already solved.');
  return out;
}

/* ================= drafts ================= */
const DKEY = KEY + ':drafts';
let store = { cur:null, list:[], author:'' };
try{ const s = JSON.parse(localStorage.getItem(DKEY)); if (s && Array.isArray(s.list)) store = Object.assign(store, s); }catch(e){}
const saveStore = () => { try{ localStorage.setItem(DKEY, JSON.stringify(store)); }catch(e){} };
const newDraft = () => ({ lid: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name:'', hint:'',
  pts:[[0,0],[1,0]], start:[null,null], goal:[], links:[], arrows:[], tools:['ccw','cw'], par:null, sol:null, tested:null, state:null, pubId:null });
let D = null;                       // the draft being edited
let mode = 'points', bsel = new Set(), bopts = [], bk = 0, brush = 'r', linkKind = 'link', linkFrom = -1, undoStack = [];
let bview = { s:1, ox:0, oy:0, dot:10 }, bpaint = null;

function openDraft(d){
  D = d; store.cur = d.lid; saveStore();
  bsel = new Set(); linkFrom = -1; undoStack = []; stopSolver();
  $('bName').value = D.name; recompute(); bRefresh();
}
function ensureDraft(){
  if (D) return;
  let d = store.list.find(x => x.lid === store.cur) || store.list[0];
  if (!d){ d = newDraft(); store.list.unshift(d); }
  openDraft(d);
}
// every edit to the puzzle itself goes through here: remember it for Undo, and forget what we knew about par
function edit(fn){
  undoStack.push(JSON.stringify(D)); if (undoStack.length > 100) undoStack.shift();
  fn();
  D.par = null; D.sol = null; D.tested = null; D.state = null; stopSolver();
  saveStore(); recompute(); bRefresh();
}
function recompute(){
  const idx = [...bsel].sort((a, b) => a - b), room = MAXPTS - D.pts.length;
  bopts = mode === 'points' && idx.length >= 2 && room > 0 ? completions(D.pts, idx, ['ccw'], Math.min(24, room)) : [];
  bk = 0;
}

/* ================= editor: drawing ================= */
function bRender(){
  const box = $('bBoard'), W = box.clientWidth, H = box.clientHeight, svg = box.firstElementChild;
  if (!W || !H || !D) return;
  const cur = bopts[bk], fit = D.pts.concat(cur ? cur.pts : []);
  const xs = fit.map(p => p[0]), ys = fit.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const md = minDist(D.pts), pad = 24, m = 1.3*md;
  const s = Math.min((W - 2*pad)/(maxX - minX + m), (H - 2*pad)/(maxY - minY + m), 120/md);
  const dot = Math.max(8, Math.min(15, md*s*.16));
  bview = { s, ox: W/2 - s*(minX + maxX)/2, oy: H/2 + s*(minY + maxY)/2, dot };
  const X = x => +(bview.ox + x*s).toFixed(1), Y = y => +(bview.oy - y*s).toFixed(1);
  let o = '';
  // faint construction lines, the same ones the game draws
  let g = null; try{ g = computeGuides(fit, false); }catch(e){}
  if (g && g.lines) for (const [a, b] of g.lines) o += `<line x1="${X(a[0])}" y1="${Y(a[1])}" x2="${X(b[0])}" y2="${Y(b[1])}" stroke="var(--grey)" stroke-opacity=".22"/>`;
  if (g && g.polys) for (const pg of g.polys) o += `<circle cx="${X(pg.c[0])}" cy="${Y(pg.c[1])}" r="${(pg.r*s).toFixed(1)}" fill="none" stroke="var(--grey)" stroke-opacity=".26" stroke-dasharray="3 4"/>`;
  for (const [a, b] of D.links){
    const cc = bowCtrl(D.pts[a], D.pts[b], D.pts);
    o += `<path d="M${X(D.pts[a][0])} ${Y(D.pts[a][1])} Q${X(cc[0])} ${Y(cc[1])} ${X(D.pts[b][0])} ${Y(D.pts[b][1])}" fill="none" stroke="var(--ink)" stroke-opacity=".28" stroke-width="${(dot*.55).toFixed(1)}" stroke-linecap="round"/>`;
  }
  for (const [a, b] of D.arrows){
    const cc = bowCtrl(D.pts[a], D.pts[b], D.pts), cx = X(cc[0]), cy = Y(cc[1]);
    const ax = X(D.pts[a][0]), ay = Y(D.pts[a][1]), bx = X(D.pts[b][0]), by = Y(D.pts[b][1]);
    const len = Math.hypot(bx - cx, by - cy) || 1, ux = (bx - cx)/len, uy = (by - cy)/len;
    const tx = bx - ux*dot*1.35, ty = by - uy*dot*1.35, hw = dot*.75, hl = dot*1.25, f = v => v.toFixed(1);
    o += `<path d="M${ax} ${ay} Q${cx} ${cy} ${f(tx - ux*hl*.6)} ${f(ty - uy*hl*.6)}" fill="none" stroke="var(--ink)" stroke-opacity=".28" stroke-width="${(dot*.55).toFixed(1)}" stroke-linecap="round"/>`;
    o += `<path d="M${f(tx)} ${f(ty)} L${f(tx - ux*hl - uy*hw)} ${f(ty - uy*hl + ux*hw)} L${f(tx - ux*hl + uy*hw)} ${f(ty - uy*hl - ux*hw)}Z" fill="var(--ink)" fill-opacity=".45"/>`;
  }
  // everything that could be built from the selection, faintly; the chosen option on top
  if (bopts.length){
    const seen = new Set(cur.pts.map(keyOf));
    for (const op of bopts.slice(0, GHOSTS)) for (const p of op.pts){ const k = keyOf(p); if (seen.has(k)) continue; seen.add(k);
      o += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${(dot*.55).toFixed(1)}" fill="none" stroke="var(--grey)" stroke-opacity=".55" stroke-width="1.5" stroke-dasharray="2 3"/>`; }
    const c = cur.info.c;
    for (const p of cur.pts.concat([...bsel].map(i => D.pts[i])))
      o += `<line x1="${X(c[0])}" y1="${Y(c[1])}" x2="${X(p[0])}" y2="${Y(p[1])}" stroke="var(--sel)" stroke-opacity=".4" stroke-width="1.2" stroke-dasharray="3 4"/>`;
    o += `<circle cx="${X(c[0])}" cy="${Y(c[1])}" r="3.5" fill="var(--sel)"/>`;
    for (const p of cur.pts) o += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${dot.toFixed(1)}" fill="color-mix(in srgb, var(--sel) 16%, transparent)" stroke="var(--sel)" stroke-width="2" stroke-dasharray="5 4"/>`;
  }
  D.pts.forEach((p, i) => {
    const x = X(p[0]), y = Y(p[1]), c = D.start[i];
    if (bsel.has(i)) o += `<circle cx="${x}" cy="${y}" r="${(dot*1.5).toFixed(1)}" fill="color-mix(in srgb, var(--sel) 22%, transparent)" stroke="var(--sel)" stroke-width="2"/>`;
    if (i === linkFrom) o += `<circle cx="${x}" cy="${y}" r="${(dot*1.5).toFixed(1)}" fill="none" stroke="var(--sel)" stroke-width="2.5" stroke-dasharray="5 4"/>`;
    o += `<circle cx="${x}" cy="${y}" r="${dot.toFixed(1)}" fill="none" stroke="var(--border)" stroke-width="2"/>`;
  });
  for (const [i, c] of D.goal) o += `<circle cx="${X(D.pts[i][0])}" cy="${Y(D.pts[i][1])}" r="${(dot*1.75).toFixed(1)}" fill="none" stroke="${COLVAR[c]}" stroke-width="2.5"/>`;
  D.pts.forEach((p, i) => { const c = D.start[i];
    o += `<circle cx="${X(p[0])}" cy="${Y(p[1])}" r="${(c ? dot : dot*.62).toFixed(1)}" fill="${c ? COLVAR[c] : 'var(--ink)'}"/>`; });
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.innerHTML = o;
}
new ResizeObserver(bRender).observe($('bBoard'));

const dotIcon = c => `<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="${c ? 8 : 5}" fill="${c ? COLVAR[c] : 'var(--ink)'}"/></svg>`;
const ringIcon = c => c ? `<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="9" fill="none" stroke="${COLVAR[c]}" stroke-width="2.5"/></svg>`
  : `<svg viewBox="0 0 26 26"><circle cx="13" cy="13" r="9" fill="none" stroke="var(--grey)" stroke-width="2" stroke-dasharray="3 3"/><path d="M7 19L19 7" stroke="var(--grey)" stroke-width="2" stroke-linecap="round"/></svg>`;
const toolIcon = t => t in MINROT ? rotIcon(MINROT[t]*90, '') : rotIcon(ROT[t]);

function bRefresh(){
  if (!D) return;
  for (const b of $('bModes').children) b.setAttribute('aria-pressed', b.dataset.m === mode);
  const st = $('bStatus'), pn = $('bPanel'), n = bsel.size;
  if (mode === 'points'){
    const cur = bopts[bk];
    st.textContent = D.pts.length >= MAXPTS ? `That's the most dots a level can have (${MAXPTS}).`
      : n === 0 ? 'Select two or more dots to see what you can build from them.'
      : n === 1 ? 'Select one more dot.'
      : !bopts.length ? 'Nothing new can be built from these dots.'
      : `${bopts.length} shape${bopts.length > 1 ? 's' : ''} can be built from these dots. Tap a faint dot or use the arrows.`;
    pn.innerHTML = `<div class="row"><button id="bPrev" aria-label="Previous shape">‹</button>
        <span class="opt">${cur ? `Shape ${bk+1} of ${bopts.length}, adds ${cur.pts.length} dot${cur.pts.length > 1 ? 's' : ''}` : 'No shape chosen'}</span>
        <button id="bNext" aria-label="Next shape">›</button><button id="bAdd" class="primary">Add</button></div>
      <div class="row"><button id="bDel">Delete selected</button><button id="bNone">Clear selection</button></div>`;
    $('bPrev').disabled = $('bNext').disabled = bopts.length < 2; $('bAdd').disabled = !cur;
    $('bDel').disabled = !n || D.pts.length - n < 2; $('bNone').disabled = !n;
    $('bPrev').onclick = () => { bk = (bk - 1 + bopts.length) % bopts.length; bRefresh(); };
    $('bNext').onclick = () => { bk = (bk + 1) % bopts.length; bRefresh(); };
    $('bAdd').onclick = addShape; $('bDel').onclick = deleteSel;
    $('bNone').onclick = () => { bsel.clear(); recompute(); bRefresh(); };
  } else if (mode === 'colors'){
    st.textContent = brush[0] === 'o' ? (brush === 'o' ? 'Tap a dot to remove its goal ring.' : `Tap a dot to put a ${COLNAME[brush[1]]} goal ring on it.`)
      : brush === 'k' ? 'Tap a dot to make it a plain black dot.' : `Tap a dot to make it ${COLNAME[brush]}.`;
    const b = (id, icon, label) => `<button class="brush" data-b="${id}" aria-pressed="${brush === id}" aria-label="${label}" title="${label}">${icon}</button>`;
    pn.innerHTML = `<div class="row"><span class="lab">Dots</span>${COLS.map(c => b(c, dotIcon(c), COLNAME[c] + ' dot')).join('')}${b('k', dotIcon(null), 'Black dot')}</div>
      <div class="row"><span class="lab">Goals</span>${COLS.map(c => b('o' + c, ringIcon(c), COLNAME[c] + ' goal ring')).join('')}${b('o', ringIcon(null), 'No goal ring')}</div>`;
    for (const x of pn.querySelectorAll('.brush')) x.onclick = () => { brush = x.dataset.b; bRefresh(); };
  } else if (mode === 'links'){
    st.textContent = linkFrom >= 0 ? (linkKind === 'link' ? 'Now tap the dot to link it to.' : 'Now tap the dot the arrow points at.')
      : linkKind === 'link' ? 'Tap two dots to link them. Linked dots are always selected together.' : 'Tap the tail, then the head. Selecting the tail selects the head too.';
    pn.innerHTML = `<div class="seg" style="margin:0 0 8px"><button data-k="link" aria-pressed="${linkKind === 'link'}">Link</button><button data-k="arrow" aria-pressed="${linkKind === 'arrow'}">Arrow</button></div>
      <p class="muted" style="margin:0">Tap the same two dots again to remove a link or an arrow.</p>`;
    for (const x of pn.querySelectorAll('[data-k]')) x.onclick = () => { linkKind = x.dataset.k; linkFrom = -1; bRefresh(); };
  } else {
    st.textContent = 'Choose which turns the player gets.';
    pn.innerHTML = `<div class="row">${BTOOLS.map(t => `<button class="btool" data-t="${t}" aria-pressed="${D.tools.includes(t)}" aria-label="${TOOL_NAME[t]}" title="${TOOL_NAME[t]}">${toolIcon(t)}</button>`).join('')}</div>
      <input id="bHint" maxlength="200" placeholder="A line of help shown above the board (optional)" aria-label="Help text" autocomplete="off">`;
    $('bHint').value = D.hint; $('bHint').oninput = () => { D.hint = $('bHint').value; saveStore(); };
    for (const x of pn.querySelectorAll('.btool')) x.onclick = () => edit(() => {
      const t = x.dataset.t; D.tools = BTOOLS.filter(u => u === t ? !D.tools.includes(t) : D.tools.includes(u)); });
  }
  const pr = $('bPar');
  if (solver) pr.textContent = 'Solving…';
  else if (D.state) pr.innerHTML = D.state;
  else if (typeof D.par === 'number') pr.innerHTML = `Par <b>${D.par}</b>, hints ready`;
  else pr.textContent = D.tested ? `Par unknown. You solved it in ${D.tested}.` : 'Par unknown';
  $('bSolve').textContent = solver ? 'Cancel' : 'Run solver';
  $('bUndo').disabled = !undoStack.length;
  $('bPublish').textContent = D.pubId ? 'Update' : 'Publish';
  bRender();
}

/* ================= editor: actions ================= */
function addShape(){
  const cur = bopts[bk]; if (!cur) return;
  edit(() => { for (const p of cur.pts){ D.pts.push([+p[0].toFixed(6), +p[1].toFixed(6)]); D.start.push(null); } bsel.clear(); });
  sfx.add();
}
function deleteSel(){
  if (!bsel.size || D.pts.length - bsel.size < 2) return;
  edit(() => {
    const map = []; let k = 0; D.pts.forEach((_, i) => map.push(bsel.has(i) ? -1 : k++));
    const keep = l => map[l[0]] >= 0 && map[l[1]] >= 0, mv = l => [map[l[0]], map[l[1]]];
    D.pts = D.pts.filter((_, i) => map[i] >= 0); D.start = D.start.filter((_, i) => map[i] >= 0);
    D.goal = D.goal.filter(g => map[g[0]] >= 0).map(g => [map[g[0]], g[1]]);
    D.links = D.links.filter(keep).map(mv); D.arrows = D.arrows.filter(keep).map(mv);
    bsel.clear();
  });
  sfx.undo();
}
function applyBrush(i){
  edit(() => {
    if (brush[0] === 'o'){
      const had = D.goal.find(g => g[0] === i); D.goal = D.goal.filter(g => g[0] !== i);
      if (brush.length > 1 && !(had && had[1] === brush[1])) D.goal.push([i, brush[1]]);
    } else D.start[i] = brush === 'k' || D.start[i] === brush ? null : brush;
  });
  sfx.select(3);
}
function linkTap(i){
  if (linkFrom < 0){ linkFrom = i; sfx.select(1); bRefresh(); return; }
  const a = linkFrom; linkFrom = -1;
  if (a === i){ bRefresh(); return; }
  edit(() => {
    const same = (l, x, y) => (l[0] === x && l[1] === y), either = l => same(l, a, i) || same(l, i, a);
    const had = linkKind === 'link' ? D.links.some(either) : D.arrows.some(l => same(l, a, i));
    D.links = D.links.filter(l => !either(l)); D.arrows = D.arrows.filter(l => !either(l));   // one connection per pair
    if (!had) (linkKind === 'link' ? D.links : D.arrows).push([a, i]);
  });
  sfx.select(2);
}
function bHit(e){
  const r = $('bBoard').getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
  const px = p => Math.hypot(bview.ox + p[0]*bview.s - mx, bview.oy - p[1]*bview.s - my);
  let best = -1, bd = Math.max(24, bview.dot*2.2);
  D.pts.forEach((p, i) => { const d = px(p); if (d < bd){ bd = d; best = i; } });
  if (best >= 0) return { dot: best };
  // a faint dot: jump to the next shape that includes it
  const n = Math.min(bopts.length, Math.max(GHOSTS, bk + 1));
  for (let j = 1; j <= n; j++){ const k = (bk + j) % n; if (bopts[k].pts.some(p => px(p) < 20)) return { opt: k }; }
  return {};
}
function bSelect(i, on){
  if (bsel.has(i) === on) return;
  if (on) bsel.add(i); else bsel.delete(i);
  if (on) sfx.select(bsel.size); else sfx.deselect();
  recompute(); bRefresh();
}
$('bBoard').addEventListener('pointerdown', e => {
  if (!D) return;
  audio();
  const h = bHit(e);
  if (mode === 'points'){
    if (h.dot >= 0){ $('bBoard').setPointerCapture(e.pointerId); bpaint = { id: e.pointerId, on: !bsel.has(h.dot) }; bSelect(h.dot, bpaint.on); }
    else if (h.opt >= 0){ bk = h.opt; tone(700 + (bk % 8)*60, 0, .08, { type:'triangle', gain:.04 }); bRefresh(); }
    else if (bsel.size){ bsel.clear(); sfx.deselect(); recompute(); bRefresh(); }
  } else if (h.dot >= 0){
    if (mode === 'colors') applyBrush(h.dot);
    else if (mode === 'links') linkTap(h.dot);
  } else if (mode === 'links' && linkFrom >= 0){ linkFrom = -1; bRefresh(); }
});
$('bBoard').addEventListener('pointermove', e => {
  if (!bpaint || bpaint.id !== e.pointerId) return;
  const h = bHit(e); if (h.dot >= 0) bSelect(h.dot, bpaint.on);
});
const bEnd = e => { if (bpaint && bpaint.id === e.pointerId) bpaint = null; };
$('bBoard').addEventListener('pointerup', bEnd); $('bBoard').addEventListener('pointercancel', bEnd);
for (const b of $('bModes').children) b.onclick = () => { mode = b.dataset.m; linkFrom = -1; if (mode !== 'points') bsel.clear(); recompute(); bRefresh(); };
$('bName').oninput = () => { D.name = $('bName').value; saveStore(); };
$('bUndo').onclick = () => {
  if (!undoStack.length) return;
  const d = JSON.parse(undoStack.pop()), keep = { name: D.name, hint: D.hint, pubId: D.pubId };
  Object.assign(D, d, keep); stopSolver(); bsel.clear(); linkFrom = -1; saveStore(); recompute(); sfx.undo(); bRefresh();
};
const say = (title, html, buttons) => acctDialog(title, html, buttons || [['OK', 'primary', closeAcct]]);
// the draft as a playable level, or a dialog saying what is missing
function playable(doing){
  const pr = problems(D), lv = pr.length ? null : cleanLevel(D, D.name.trim() || 'Untitled');
  if (lv) return lv;
  say(`Not ready to ${doing} yet`, '<ul>' + (pr.length ? pr : ['This level can\'t be played as it is.']).map(p => `<li>${esc(p)}</li>`).join('') + '</ul>');
  return null;
}
$('bTest').onclick = () => {
  const lv = playable('test'); if (!lv) return;
  const d = D;
  playCustom(lv, { key:null, free:true, back:'build', nextLabel:'Back to builder', onNext: () => go('build'),
    onSolve: m => { if (!d.tested || m < d.tested){ d.tested = m; saveStore(); } } });
  go('play');
};

/* ================= solver (WebAssembly, in a worker) ================= */
let solver = null;
function stopSolver(){ if (solver){ solver.terminate(); solver = null; } }
function solverInput(lv){
  const CODE = { r:1, g:2, y:3 }, tr = [];
  lv.start.forEach((c, i) => { if (c) tr.push(i); });
  for (const l of lv.links.concat(lv.arrows)) for (const x of l) if (!tr.includes(x)) tr.push(x);
  if (tr.length > MAXTRACKED) return null;
  const tid = new Map(tr.map((p, k) => [p, k])), o = ['solve', lv.pts.length, ...lv.pts.map(p => p[0] + ' ' + p[1])];
  o.push(`${+lv.tools.includes('ccw')} ${+lv.tools.includes('cw')} 0 -1`);
  o.push(tr.length, ...tr.map(p => p + ' ' + (CODE[lv.start[p]] || 0)));
  o.push(lv.links.length, ...lv.links.map(([a, b]) => tid.get(a) + ' ' + tid.get(b)));
  o.push(lv.arrows.length, ...lv.arrows.map(([a, b]) => tid.get(a) + ' ' + tid.get(b)));
  o.push(lv.goal.length, ...lv.goal.map(([p, c]) => p + ' ' + CODE[c]));
  const fx = lv.tools.filter(t => t in ROT).map(t => ROT[t]); o.push(fx.length, ...fx);
  return o.join('\n') + '\n';
}
$('bSolve').onclick = () => {
  if (solver){ stopSolver(); bRefresh(); return; }
  const lv = playable('solve'); if (!lv) return;
  const input = solverInput(lv), d = D, tooBig = 'Too big for the solver. Par stays unknown.';
  if (!input){ d.state = tooBig; say('Too big for the solver', `<p>The solver can follow at most ${MAXTRACKED} pieces (colored dots, plus any dot with a link or an arrow). You can still publish with par unknown.</p>`); bRefresh(); return; }
  let w; try{ w = new Worker('solver-worker.js?v=' + V); }catch(e){ d.state = 'The solver could not start.'; bRefresh(); return; }
  solver = w; d.state = null;
  const done = r => {
    if (solver !== w) return;
    w.terminate(); solver = null;
    const lines = (r.out || '').trim().split('\n'), par = /^par (-?\d+)$/.test(lines[0]) ? +lines[0].slice(4) : null;
    if (r.error || r.code || par === null || par === -2) d.state = tooBig;
    else if (par === -1){ d.state = '<b>No solution.</b> This level can\'t be solved.'; d.tested = null; }
    else {
      const sol = lines.slice(1).map(l => { const [, type, mask, dir] = l.split(' '), m = BigInt(mask), s = [];
        for (let i = 0; i < lv.pts.length; i++) if (m >> BigInt(i) & 1n) s.push(i);
        return { s, t: type === '2' ? 'r' + dir : +dir > 0 ? 'ccw' : 'cw' }; });
      // keep the result only if the game itself agrees that these moves solve the level
      const chk = cleanLevel(Object.assign({}, d, { par, sol }), 'x');
      if (chk && chk.par === par){ d.par = par; d.sol = sol; } else d.state = 'The solver\'s answer did not check out. Par stays unknown.';
    }
    saveStore(); if (d === D) bRefresh();
  };
  w.onmessage = e => done(e.data); w.onerror = () => done({ error:'worker' });
  w.postMessage(input); bRefresh();
};

/* ================= my levels ================= */
function draftRow(d){
  const row = document.createElement('div'); row.className = 'd-row';
  row.innerHTML = thumb(d) + '<div class="xt"><div class="xn"></div><div class="xm"></div></div>';
  row.querySelector('.xn').textContent = d.name.trim() || 'Untitled';
  row.querySelector('.xm').textContent = (d.pubId ? 'Published' : 'Draft') + `, ${d.pts.length} dots` + (typeof d.par === 'number' ? `, par ${d.par}` : '');
  const open = document.createElement('button'); open.textContent = d === D ? 'Editing' : 'Edit'; open.disabled = d === D;
  open.onclick = () => { closeAcct(); openDraft(d); };
  const del = document.createElement('button'); del.textContent = 'Delete';
  del.onclick = () => {
    const drop = () => { store.list = store.list.filter(x => x !== d); if (d === D){ D = null; store.cur = null; } saveStore(); ensureDraft(); showDrafts(); };
    if (!d.pubId) return say('Delete this level?', `<p>"${esc(d.name.trim() || 'Untitled')}" will be deleted from this device. This can't be undone.</p>`,
      [['Delete it', 'danger', drop], ['Go back', '', showDrafts]]);
    say('Delete this level?', `<p>"${esc(d.name.trim() || 'Untitled')}" is published. You can take it down for everyone, or only delete your copy here.</p>`, [
      ['Take it down for everyone', 'danger', async () => {
        if (!sb || !user) return say('Sign in first', '<p>Sign in with the account that published this level to take it down.</p>', [['Sign in', 'primary', () => { closeAcct(); openAuth(); }], ['Go back', '', showDrafts]]);
        const { data, error } = await sb.from('turns_levels').delete().eq('id', d.pubId).select('id');
        if (error || !data || !data.length) return say('Could not take it down', `<p>${esc(error ? error.message : 'This account did not publish that level.')}</p>`, [['Go back', '', showDrafts]]);
        shared.delete(d.pubId); drop();
      }],
      ['Only delete my copy', '', drop], ['Go back', '', showDrafts]]);
  };
  row.append(open, del); return row;
}
function showDrafts(){
  say('My levels', '', [['New level', 'primary', () => { const d = newDraft(); store.list.unshift(d); closeAcct(); openDraft(d); }], ['Close', '', closeAcct]]);
  const body = $('acctBody'); body.innerHTML = '';
  for (const d of store.list) body.append(draftRow(d));
}
$('bDrafts').onclick = showDrafts;

/* ================= publishing ================= */
const shareUrl = id => location.origin + location.pathname + '#l=' + id;
// the public copy: the puzzle plus, when the solver has run, par and the solution the hints are drawn from
const publicData = d => { const o = { pts: d.pts, start: d.start, goal: d.goal, links: d.links, arrows: d.arrows, tools: d.tools, hint: d.hint.trim() };
  if (typeof d.par === 'number' && d.sol){ o.par = d.par; o.sol = d.sol; } return o; };
$('bPublish').onclick = () => {
  const lv = playable('publish'); if (!lv) return;
  if (/^<b>No solution/.test(D.state || '')) return say('This level can\'t be solved', '<p>The solver found no way to finish it. Change the level, then run the solver again.</p>');
  if (typeof D.par !== 'number' && !D.tested) return say('Solve it first',
    '<p>So that nobody gets an impossible level, solve it yourself with <b>Test</b>, or let <b>Run solver</b> find par.</p><p>Par can stay unknown: a level you solved by hand can be published without it.</p>');
  if (!D.name.trim()) return say('Give it a name', '<p>Type a name for your level in the box at the top.</p>', [['OK', 'primary', () => { closeAcct(); $('bName').focus(); }]]);
  if (!sbOn || !sb) return say('Can\'t publish right now', '<p>The level server can\'t be reached. Your level is saved on this device, so try again later.</p>');
  if (!user) return say('Sign in to publish', '<p>Publishing needs an account, so you can update or take down your levels later. Your level is saved on this device.</p>',
    [['Sign in', 'primary', () => { closeAcct(); openAuth(); }], ['Not now', 'link', closeAcct]]);
  const d = D;
  say(d.pubId ? 'Update your level?' : 'Publish your level?',
    `<p>${d.pubId ? 'The published copy will be replaced with this version.' : 'Anyone with the link can play it, and it will be listed in Community levels.'}
      ${typeof d.par === 'number' ? `Par is ${d.par}, with hints.` : 'Par is unknown, so players get one star and no hints.'}</p>
     <label class="muted" for="bAuthor" style="display:block;margin-bottom:4px">Your name, shown with the level</label>
     <input class="b-in" id="bAuthor" maxlength="40" placeholder="Anonymous" autocomplete="nickname">`,
    [[d.pubId ? 'Update' : 'Publish', 'primary', async () => {
      store.author = $('bAuthor').value.trim().slice(0, 40); saveStore();
      const row = { name: d.name.trim().slice(0, 40), author_name: store.author, data: publicData(d) };
      for (const b of $('acctBtns').children) b.disabled = true;
      let res = d.pubId ? await sb.from('turns_levels').update(Object.assign(row, { updated_at: new Date().toISOString() })).eq('id', d.pubId).select('id') : null;
      if (!res || (!res.error && !res.data.length)) res = await sb.from('turns_levels').insert(row).select('id');   // never published, or the old copy is gone
      if (res.error || !res.data.length) return say('Could not publish', `<p>${esc(res.error ? res.error.message : 'Something went wrong.')}</p>`);
      d.pubId = res.data[0].id; saveStore(); shared.delete(d.pubId); xLoaded = false; bRefresh();
      track('builder/publish', 'level_publish', { par_known: typeof d.par === 'number' });
      const url = shareUrl(d.pubId);
      say('Published!', `<p>Share this link:</p><input class="share-link" id="bLink" readonly><p class="auth-msg" id="bCopied"></p>`, [
        ['Copy link', 'primary', async () => { try{ await navigator.clipboard.writeText(url); $('bCopied').textContent = 'Copied.'; }catch(e){ $('bLink').select(); $('bCopied').textContent = 'Select the link and copy it.'; } }],
        ['Play it', '', () => { closeAcct(); go('l=' + d.pubId); }], ['Done', 'link', closeAcct]]);
      $('bLink').value = url;
    }], ['Cancel', '', closeAcct]]);
  $('bAuthor').value = store.author || '';
};

/* ================= community levels ================= */
const shared = new Map();    // id -> { row, lv }
const FIELDS = 'id,name,author_name,data,plays,solves,created_at';
// supabase-js loads after the page; wait for the game's client to exist
const withSb = () => new Promise((ok, no) => {
  if (!sbOn) return no(new Error('off'));
  const t0 = Date.now(), tick = () => sb ? ok(sb) : Date.now() - t0 > 10000 ? no(new Error('timeout')) : setTimeout(tick, 150);
  tick();
});
function remember(row){
  const lv = cleanLevel(row.data || {}, row.name); if (!lv) return null;
  const by = String(row.author_name || '').trim();
  lv.hint += (lv.hint ? ' ' : '') + `<span class="by">By ${esc(by || 'Anonymous')}.</span>`;
  const e = { row, lv }; shared.set(row.id, e); return e;
}
const bumped = new Set();
function bump(id, solved){
  const k = id + (solved ? 's' : 'p'); if (bumped.has(k) || !sb) return; bumped.add(k);
  sb.rpc('turns_level_bump', { level_id: id, solved }).then(() => {}, () => {});
}
let sharedWant = 0;
window.openShared = async id => {
  if (custom && custom.id === id) return;
  sharedWant = id;
  let e = shared.get(id);
  if (!e){
    $('levelBtn').textContent = 'Loading…';
    try{
      const { data, error } = await (await withSb()).from('turns_levels').select(FIELDS).eq('id', id).maybeSingle();
      if (error) throw error;
      e = data && remember(data);
    }catch(err){ e = null; }
    if (sharedWant !== id || location.hash !== '#l=' + id) return;
    if (!e){
      refresh();
      return say('Level not found', '<p>This level isn\'t available. It may have been taken down, or you may be offline.</p>', [['Community levels', 'primary', () => { closeAcct(); go('explore'); }], ['Menu', '', () => { closeAcct(); go('home'); }]]);
    }
  }
  playCustom(e.lv, { id, key: '@' + id, back:'explore', nextLabel:'More levels', onNext: () => go('explore'), onSolve: () => bump(id, true) });
  bump(id, false);
};

let xSort = 'new', xRows = [], xLoaded = false, xBusy = false, xEnd = false;
const PAGE = 30;
async function xLoad(more){
  if (xBusy) return; xBusy = true;
  if (!more){ xRows = []; xEnd = false; $('xList').innerHTML = '<p class="x-msg">Loading…</p>'; $('xMore').hidden = true; }
  try{
    const q = (await withSb()).from('turns_levels').select(FIELDS);
    const { data, error } = await (xSort === 'top' ? q.order('plays', { ascending:false }).order('id', { ascending:false }) : q.order('id', { ascending:false })).range(xRows.length, xRows.length + PAGE - 1);
    if (error) throw error;
    xRows = xRows.concat(data); xEnd = data.length < PAGE; xLoaded = true;
    for (const r of data) remember(r);
    xRender();
  }catch(e){
    $('xList').innerHTML = '<p class="x-msg">Couldn\'t load community levels. Check your connection and try again.</p>'; $('xMore').hidden = true; xLoaded = false;
  }
  xBusy = false;
}
function xRender(){
  const list = $('xList'); list.innerHTML = '';
  for (const b of $('xSort').children) b.setAttribute('aria-pressed', b.dataset.s === xSort);
  for (const r of xRows){
    const e = shared.get(r.id); if (!e) continue;
    const best = prog.best['@' + r.id], st = best === undefined ? 0 : 1 + (hasPar(e.lv) && best <= e.lv.par ? 1 : 0);
    const b = document.createElement('button'); b.className = 'xcard';
    b.innerHTML = thumb(e.lv) + '<div class="xt"><div class="xn"></div><div class="xm"></div></div>' +
      `<span class="stars" aria-label="${st} of ${hasPar(e.lv) ? 2 : 1} stars"><span class="star${st >= 1 ? ' on' : ''}">★</span>${hasPar(e.lv) ? `<span class="star${st >= 2 ? ' on' : ''}">★</span>` : ''}</span>`;
    b.querySelector('.xn').textContent = e.lv.name;
    b.querySelector('.xm').textContent = `By ${String(r.author_name || '').trim() || 'Anonymous'} · ${hasPar(e.lv) ? 'par ' + e.lv.par : 'par unknown'} · ${r.plays} play${r.plays === 1 ? '' : 's'}`;
    b.onclick = () => go('l=' + r.id);
    list.append(b);
  }
  if (!list.children.length) list.innerHTML = '<p class="x-msg">No levels yet. Be the first to make one!</p>';
  $('xMore').hidden = xEnd;
}
for (const b of $('xSort').children) b.onclick = () => { if (xSort !== b.dataset.s){ xSort = b.dataset.s; xLoad(false); } };
$('xMore').onclick = () => xLoad(true);

/* ================= screens ================= */
XSCREENS.build = () => { ensureDraft(); bRefresh(); };
XSCREENS.explore = () => { for (const b of $('xSort').children) b.setAttribute('aria-pressed', b.dataset.s === xSort); if (xLoaded) xRender(); else xLoad(false); };
$('exploreBtn').onclick = () => go('explore');
$('buildBtn').onclick = () => go('build');
$('bBack').onclick = () => go('home');
$('xBack').onclick = () => go('home');
$('xBuild').onclick = () => go('build');
showScreen();    // the game already routed once, before these screens existed
})();
