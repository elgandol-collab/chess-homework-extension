import fs from 'node:fs';
import { loadHomework, HomeworkFileError } from '../src/model.js';
const py = JSON.parse(fs.readFileSync('py_out.json', 'utf8'));
// Known, intentional deviations: (1) python's PGN path gives puzzle/opening items unused engine defaults; (2) python appends exception detail to error text.
const UNUSED = ['engine_clock_seconds','student_clock_seconds','clock_increment_seconds','engine_min_delay_ms','player_min_delay_ms'];
for (const f of Object.keys(py)) { if (py[f].error) py[f].error = py[f].error.split(' (')[0].slice(0,40); else py[f].items.forEach(i => { if (i.type==='puzzle'||i.type==='opening') UNUSED.forEach(k => i[k]=0); }); }
let bad = 0, n = 0;
for (const f of Object.keys(py).sort()) {
  let js;
  try { const hw = loadHomework(fs.readFileSync('fixtures/' + f, 'utf8'), f);
    js = { title: hw.title, student: hw.student, sequential: hw.sequential,
      items: hw.items.map((it) => Object.fromEntries(Object.keys(py[f].items?.[0] ?? {}).map((k) => [k, it[k]]))) };
  } catch (e) { if (!(e instanceof HomeworkFileError)) throw e; js = { error: e.message.split(' (')[0].slice(0,40) }; }
  n++;
  const a = JSON.stringify(py[f]), b = JSON.stringify(js);
  if (a === b) console.log('MATCH   ', f);
  else { bad++; console.log('DIFF    ', f); 
    if (py[f].error || js.error) console.log('  py:', py[f].error, '\n  js:', js.error);
    else py[f].items.forEach((pi, i) => { for (const k of Object.keys(pi)) if (JSON.stringify(pi[k]) !== JSON.stringify(js.items[i]?.[k])) console.log(`  item${i} ${k}: py=${JSON.stringify(pi[k])} js=${JSON.stringify(js.items[i]?.[k])}`); });
    if (!py[f].error && !js.error) for (const k of ['title','student','sequential']) if (py[f][k] !== js[k]) console.log(`  ${k}: py=${py[f][k]} js=${js[k]}`);
  }
}
console.log(`\n${n - bad}/${n} files identical`);
