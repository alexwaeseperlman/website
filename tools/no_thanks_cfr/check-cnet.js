// Checks the page's neural-net bot (netFeatures / netForward in public/no_thanks/index.html, reading bot-net.json)
// against deep.cpp's cnet3 on random game states (./deep dump on the weights bot-net.json decodes to), and writes
// check-net.sql: the same states for the database's nothanks_net_take (run it: it should return 0 rows).
//   node export-cnet.js a.json b.json && node check-cnet.js a-deq.json b-deq.json
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const pub = path.join(__dirname, '../../public/no_thanks'), html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const grab = name => { const s = html.indexOf(`function ${name}(`); return html.slice(s, html.indexOf('\n}\n', s) + 3); };
const load = html.slice(html.indexOf('const NET_LAYERS'), html.indexOf('// others: the other players'));
const page = new Function('fetch', 'atob', `let net, netP;\n${load}${grab('netFeatures')}${grab('netForward')}${grab('netForwardOne')}${grab('netTakeProb')}
  return loadNet().then(() => ({ netFeatures, netForward, netTakeProb, loaded: !!net }));`)(
  () => Promise.resolve({ ok: true, json: () => JSON.parse(fs.readFileSync(path.join(pub, 'bot-net.json'), 'utf8')) }),
  s => Buffer.from(s, 'base64').toString('binary'));
page.then(P => {
  if (!P.loaded) throw new Error('page did not load bot-net.json');
  const states = execFileSync(path.join(__dirname, 'deep'), ['dump', process.argv.slice(2).map(f => path.resolve(f)).join('+'), '7', '3000']).toString().trim().split('\n').map(l => JSON.parse(l));
  let worst = 0; const rows = [];
  for (const s of states){
    const [me, ...others] = s.players, args = [me.cards, me.chips, s.card, s.pot, others, s.left, s.n];
    const o = P.netForward(P.netFeatures(...args));
    worst = Math.max(worst, Math.abs(o[0] - s.out[0]), Math.abs(o[1] - s.out[1]));
    if (rows.length < 150) rows.push({ args, p: P.netTakeProb(...args) });
  }
  console.log(`page vs deep.cpp: worst output difference ${worst.toExponential(2)} over ${states.length} states`);
  const arr = a => `'{${a.join(',')}}'::int[]`;
  fs.writeFileSync(path.join(__dirname, 'check-net.sql'), `select * from (values ${rows.map(({ args: [cards, chips, card, pot, others, left, n], p }) =>
    `(${p.toFixed(6)}::real,${arr(cards)},${chips},${card},${pot},${left},${n},'${JSON.stringify(others.map(o => o.cards))}'::jsonb,${arr(others.map(o => o.chips))})`).join(',\n')}) v(p, hand, chips, card, pot, lft, n, opp_cards, opp_chips)
where abs(nothanks_net_take(hand, chips, card, pot, lft, n, opp_cards, opp_chips) - p) > 1e-4;\n`);
  process.exit(worst > 1e-4 ? 1 : 0);
});
