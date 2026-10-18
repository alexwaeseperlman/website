// Checks that the page's botKey (public/no_thanks/index.html) matches game.js on random game states, and prints a
// SQL query that does the same for the database's nothanks_bot_key (run it in the SQL editor: it should return 0 rows).
'use strict';
const fs = require('fs'), path = require('path'), G = require('./game');
const html = fs.readFileSync(path.join(__dirname, '../../public/no_thanks/index.html'), 'utf8');
const cardPoints = html.match(/^const cardPoints = .*$/m)[0], fn = html.slice(html.indexOf('function botKey('));
const botKey = new Function(cardPoints + fn.slice(0, fn.indexOf('\n}\n') + 3) + 'return botKey;')();
const r = G.rng(7), rows = []; let bad = 0, n_ = 0;
for (let i = 0; i < 3000; i++){
  const n = 2 + Math.floor(r() * 6), g = G.newGame(n, r), stop = Math.floor(r() * 80);
  let over = false;
  for (let s = 0; s < stop && !over; s++) over = G.step(g, g.chips[g.turn] === 0 || G.heuristic(g, r));
  if (over || g.chips[g.turn] === 0) continue;
  const hand = q => { const a = []; for (let c = 3; c <= 35; c++) if (g.has[q * 37 + c]) a.push(c); return a; };
  const p = g.turn, card = g.deck[g.idx], others = [];
  for (let q = 0; q < n; q++) if (q !== p) others.push({ cards: hand(q), chips: g.chips[q] });
  const k = G.keyOf(g), k2 = botKey(hand(p), g.chips[p], card, g.pot, others, G.left(g), n);
  n_++; if (k !== k2) bad++;
  if (rows.length < 150){
    const fo = others.some(o => o.cards.includes(card - 1) || o.cards.includes(card + 1)), mo = Math.min(...others.map(o => o.chips));
    rows.push(`(${k},'{${hand(p)}}'::int[],${g.chips[p]},${card},${g.pot},${fo},${mo},${G.left(g)},${n})`);
  }
}
console.log(`page botKey vs game.js: ${bad} mismatches in ${n_} states`);
fs.writeFileSync(path.join(__dirname, 'check.sql'), `select * from (values ${rows.join(',')}) v(k, hand, chips, card, pot, fo, mo, lft, n)
where nothanks_bot_key(hand, chips, card, pot, fo, mo, lft, n) <> k;\n`);
console.log('wrote check.sql (' + rows.length + ' states)');
process.exit(bad ? 1 : 0);
