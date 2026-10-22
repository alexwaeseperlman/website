// scores each ablation net: one of it among the live net / the table bot / the rule of thumb, 2-7 players
//   node score.js live.json name1 name2 ...   (weights in deep-pnet-<name>-adv.json)
const { execFileSync } = require('child_process'), live = process.argv[2], names = process.argv.slice(3), G = +process.env.GAMES || 10000;
const rows = [];
for (const name of names){
  const f = name.endsWith('.json') ? name : `deep-pnet-${name}-adv.json`, r = { name, drop: require('./' + f).drop || '-' };
  for (const [k, b] of [['live', live], ['table', 'table'], ['rule', 'rule']]){
    const out = execFileSync('../deep', ['eval', f, b, String(G)]).toString().trim().split('\n').slice(1);
    r[k] = out.map(l => +l.trim().split(/\s+/)[2].replace('%', ''));   // % won by one of this net among b
  }
  rows.push(r);
}
const edge = (v, n) => (v / (100 / n) - 1) * 100;   // relative edge over the fair share, in %
const avg = a => a.reduce((s, v) => s + v, 0) / a.length;
console.log('name       live 2..7 players (%)              table 2..7 (%)                    rule 2..7 (%)                     edge: live table rule  all   dropped');
for (const r of rows){
  const e = ['live', 'table', 'rule'].map(k => avg(r[k].map((v, i) => edge(v, i + 2))));
  console.log(r.name.padEnd(10), ['live', 'table', 'rule'].map(k => r[k].map(v => v.toFixed(1).padStart(5)).join('')).join('  '),
    '  ', e.map(v => v.toFixed(1).padStart(6)).join(''), avg(e).toFixed(1).padStart(6), '  ', r.drop);
}
