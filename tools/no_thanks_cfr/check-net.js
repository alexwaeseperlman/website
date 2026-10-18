// Checks the page's neural-net bot (netFeatures / netForward in public/no_thanks/index.html, reading bot-net.json)
// against structnet.js on random game states, and writes check-net.sql: the same states for the database's
// nothanks_net_take (run it: it should return 0 rows).
'use strict';
const fs = require('fs'), path = require('path'), G = require('./game'), S = require('./structnet');
const pub = path.join(__dirname, '../../public/no_thanks'), html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const grab = name => { const s = html.indexOf(`function ${name}(`); return html.slice(s, html.indexOf('\n}\n', s) + 3); };
const cardPoints = html.match(/^const cardPoints = .*$/m)[0], layers = html.match(/^const NET_LAYERS = .*$/m)[0];
const page = new Function('j', `${cardPoints}\n${layers}\nlet net;\n${grab('netFeatures')}${grab('netForward')}${grab('netTakeProb')}
  const atob = s => Buffer.from(s, 'base64').toString('binary');
  const q = Uint8Array.from(atob(j.q), ch => ch.charCodeAt(0)), p = new Float32Array(q.length), L = [];
  let o = 0, si = 0;
  for (const [i, n] of NET_LAYERS){ for (const len of [i * n, n]){ const s = j.scales[si++]; for (let k = 0; k < len; k++) p[o + k] = (q[o + k] << 24 >> 24) * s; o += len; } L.push({ i, o: n, w: o - i * n - n, b: o - n }); }
  net = { p, L };
  return { netFeatures, netForward, netTakeProb };`)(JSON.parse(fs.readFileSync(path.join(pub, 'bot-net.json'), 'utf8')));
// reference: structnet with the same dequantized weights
const j = JSON.parse(fs.readFileSync(path.join(pub, 'bot-net.json'), 'utf8')), ref = new S.StructNet(2), q = Buffer.from(j.q, 'base64');
let si = 0; for (const L of ref.L) for (const [o, len] of [[L.w, L.i * L.o], [L.b, L.o]]){ const s = j.scales[si++]; for (let k = 0; k < len; k++) ref.p[o + k] = q.readInt8(o + k) * s; }
const r = G.rng(11), x = new Float32Array(S.F), rows = []; let worst = 0, featBad = 0, count = 0;
for (let i = 0; i < 2000; i++){
  const n = 2 + Math.floor(r() * 5), g = G.newGame(n, r), stop = Math.floor(r() * 90); let over = false;
  for (let s = 0; s < stop && !over; s++) over = G.step(g, g.chips[g.turn] === 0 || G.heuristic(g, r));
  if (over || g.chips[g.turn] === 0) continue;
  const hand = q => { const a = []; for (let c = 3; c <= 35; c++) if (g.has[q * 37 + c]) a.push(c); return a; };
  const p = g.turn, others = Array.from({ length: n - 1 }, (_, k) => (p + 1 + k) % n).map(q => ({ cards: hand(q), chips: g.chips[q] }));
  const args = [hand(p), g.chips[p], g.deck[g.idx], g.pot, others, G.left(g), n];
  const pf = page.netFeatures(...args), rf = S.features(g, x);
  for (let k = 0; k < S.F; k++) if (Math.abs(pf[k] - rf[k]) > 1e-6){ featBad++; break; }
  const po = page.netForward(pf), ro = ref.forward(rf);
  worst = Math.max(worst, Math.abs(po[0] - ro[0]), Math.abs(po[1] - ro[1])); count++;
  if (rows.length < 120) rows.push({ args, p: page.netTakeProb(...args) });
}
console.log(`page vs structnet: ${featBad} feature mismatches, worst output difference ${worst.toExponential(2)}, ${count} states`);
const arr = a => `'{${a.join(',')}}'::int[]`;
fs.writeFileSync(path.join(__dirname, 'check-net.sql'), `select * from (values ${rows.map(({ args: [cards, chips, card, pot, others, left, n], p }) =>
  `(${p.toFixed(6)}::real,${arr(cards)},${chips},${card},${pot},${left},${n},'${JSON.stringify(others.map(o => o.cards))}'::jsonb,${arr(others.map(o => o.chips))})`).join(',\n')}) v(p, hand, chips, card, pot, lft, n, opp_cards, opp_chips)
where abs(nothanks_net_take(hand, chips, card, pot, lft, n, opp_cards, opp_chips) - p) > 1e-4;\n`);
process.exit(featBad || worst > 1e-4 ? 1 : 0);
