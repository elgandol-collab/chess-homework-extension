import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os';
import { Chess } from '/home/claude/ext/node_modules/chess.js/dist/esm/chess.js'; import chromium from '@sparticuz/chromium'; import puppeteer from 'puppeteer-core';
const DIST='/home/claude/ext/dist'; const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.png':'image/png','.wav':'audio/wav','.mp3':'audio/mpeg'};
const server=http.createServer((q,r)=>{const p=path.join(DIST,decodeURIComponent(q.url.split('?')[0]).replace(/^\/$/,'/app.html'));if(!fs.existsSync(p)){r.writeHead(404);return r.end();}r.writeHead(200,{'Content-Type':MIME[path.extname(p)]||'x','Content-Security-Policy':"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"});fs.createReadStream(p).pipe(r);});
await new Promise(r=>server.listen(0,r)); const BASE=`http://localhost:${server.address().port}/`;
const R=[]; const check=(n,v,x='')=>{R.push(v);console.log(v?'PASS':'FAIL',n,x)}; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hw=JSON.parse(fs.readFileSync('real.json','utf8'));
const b=await puppeteer.launch({executablePath:await chromium.executablePath(),args:chromium.args,headless:'shell'});
const dl=fs.mkdtempSync(path.join(os.tmpdir(),'dl-'));
async function mk(){const page=await b.newPage();await page.setViewport({width:1646,height:969});const errs=[];page.on('pageerror',e=>errs.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!/404/.test(m.text()))errs.push(m.text())});
  await page.evaluateOnNewDocument(()=>{window.__snd=[];HTMLMediaElement.prototype.play=function(){window.__snd.push(decodeURIComponent(this.src.split('/').pop()));return Promise.resolve();};});
  const c=await page.createCDPSession();await c.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:dl});page.errs=errs;return page;}
const snd=(p)=>p.evaluate(()=>window.__snd);
const geo=(p)=>({xy:async(sq,flip)=>{const r=await p.$eval('#board',e=>{const b=e.getBoundingClientRect();return{l:b.left,t:b.top,w:b.width}});const f='abcdefgh'.indexOf(sq[0]),rk=+sq[1]-1;const vf=flip?7-f:f,vr=flip?rk:7-rk;return[r.l+(vf+.5)*r.w/8,r.t+(vr+.5)*r.w/8]}});
let page=await mk(); let G=geo(page);
const click=async(sq,flip)=>{const[x,y]=await G.xy(sq,flip);await page.mouse.click(x,y)}; const flipNow=()=>page.evaluate(()=>document.querySelector('.sq[data-sq="a1"]').getBoundingClientRect().left>document.querySelector('.sq[data-sq="h1"]').getBoundingClientRect().left);
await page.goto(BASE); await page.waitForSelector('#board .sq');
check('default language is English (LTR, original wording)', (await page.$eval('#b-open',e=>e.textContent)).includes('GET HW FILE') && (await page.$eval('#hw-title',e=>e.textContent))==='No homework loaded');
check('brand + toolbar buttons (export/whatsapp disabled until a homework is loaded)', (await page.$eval('.brand',e=>e.textContent))==='Essam Tools' && await page.$eval('#b-export',e=>e.disabled) && await page.$eval('#b-wa',e=>e.disabled));
const bs=await page.$eval('#board',e=>e.getBoundingClientRect().height); check('board is large (fills the window height)', bs>=780, Math.round(bs)+'px');
check('clock rack panels all visible even before a homework: engine, slow-down badge, moves-left badge, you', await page.evaluate(()=>['p-engine','b-slow','b-left','p-you'].every(i=>{const e=document.getElementById(i);return e&&e.getBoundingClientRect().height>40})));
await page.screenshot({path:'v3_empty.png'});
(await page.$('#fileinput')).uploadFile('real.json'); await page.waitForFunction(()=>document.querySelector('#hw-title').textContent==='Chess Homework');
check('items listed (9), rating row shows trophy', (await page.$$('.item')).length===9 && (await page.$eval('#rating-row',e=>e.textContent)).includes('🏆'));
await page.waitForSelector('.item.active'); await sleep(600); let flip=await flipNow(); const sol=hw.items[0].solution; // black puzzle: wrong move first
const g0=new Chess(hw.items[0].fen); const bad=g0.moves({verbose:true}).find(m=>m.from+m.to!==hw.items[0].solution[0]); await click(bad.from,flip); await click(bad.to,flip); await sleep(300);
check('puzzle wrong move → "Focus" banner + puzzle-focus sound (dont_rush_2.wav from the homework file)', (await page.$eval('#fbanner',e=>e.textContent)).includes('Focus') && (await snd(page)).includes('dont_rush_2.wav'), JSON.stringify(await snd(page)));
await page.screenshot({path:'v3_puzzle.png'});
// solve 7 puzzles
for(let i=0;i<7;i++){const it=hw.items[i];await page.waitForFunction(n=>document.querySelector('.item.active b')?.textContent.startsWith(n+'.'),{timeout:9000},String(i+1));const fl=await flipNow();const s=it.solution;let idx=0;
  while(idx<s.length){await sleep(750);if((await page.$eval('#status',e=>e.textContent)).includes('Well done'))break;const mv=s[idx];await click(mv.slice(0,2),fl);await click(mv.slice(2,4),fl);if(await page.$('.overlay .promo'))await page.click(`.promo .btn:nth-child(${{q:1,r:2,b:3,n:4}[mv[4]||'q']})`);idx+=2;}await sleep(300);}
await page.waitForFunction(()=>document.querySelector('.item.active b')?.textContent.startsWith('8.'),{timeout:9000}); flip=await flipNow();
await sleep(400);
check('engine item: clocks show 05:00 / 20:00, moves-left badge = 20', (await page.$eval('#p-engine-v',e=>e.textContent)).startsWith('05:') && (await page.$eval('#p-you-v',e=>e.textContent)).startsWith('20:') && (await page.$eval('#b-left-v',e=>e.textContent))==='20', await page.$eval('#b-left-v',e=>e.textContent));
check('student clock is the active (green) one on the student turn; slow-down badge counting', (await page.$eval('#p-you',e=>e.className)).includes('active') && (await page.$eval('#b-slow',e=>e.className)).includes('active'), await page.$eval('#b-slow-v',e=>e.textContent));
await page.screenshot({path:'v3_engine.png'});
// too-early move: rush voice (round-robin #1) + banner
const before=(await snd(page)).length; const g1=['a','b','c','d','e','f','g','h']; await click('h7',flip); await click('h6',flip); await sleep(250);
const s1=(await snd(page)).slice(before); check('too-early move → rush voice dont_rush_1.wav (1st of round-robin) + "Don\'t rush" banner', s1.includes('dont_rush_1.wav') && (await page.$eval('#fbanner',e=>e.textContent)).startsWith("Don't rush"), JSON.stringify(s1));
await sleep(300); await click('h7',flip); await click('h6',flip); await sleep(250); const s2=(await snd(page)).slice(before);
check('2nd too-early move → next voice in the pool (dont_rush_3.wav)', s2.includes('dont_rush_3.wav'), JSON.stringify(s2));
// 4th nag → softened message
for(let i=0;i<2;i++){await click('h7',flip);await click('h6',flip);await sleep(200);} 
check('after 3 nags the message is the softened (non-insulting) one', (await page.$eval('#fbanner',e=>e.textContent)).includes('slow down a little'), await page.$eval('#fbanner',e=>e.textContent));
// engine sub-countdown shows while the engine waits
await sleep(3000); await click('h7',flip); await click('h6',flip); let sawSub=false; for(let i=0;i<30&&!sawSub;i++){await sleep(100);sawSub=/\ds$/.test(await page.$eval('#p-engine-s',e=>e.textContent));}
check('engine panel shows its own slow-down countdown while the engine waits', sawSub);
// export + arabic
await page.click('#b-export'); await sleep(1200); check('export saves zip', fs.readdirSync(dl).length>0);
await page.click('#b-lang'); await sleep(200); check('Arabic toggle: UI translated, board still LTR', (await page.$eval('#b-open',e=>e.textContent)).includes('ملف الواجب') && (await page.$eval('#board',e=>getComputedStyle(e).direction))==='ltr');
await page.screenshot({path:'v3_arabic.png'}); await page.click('#b-lang');
check('no console errors', page.errs.length===0, page.errs.join('|')); await page.close();
// voice notes + publish sound
page=await mk(); G=geo(page); await page.goto(BASE); await page.waitForSelector('#fileinput'); (await page.$('#fileinput')).uploadFile('vn.json'); await page.waitForSelector('.item');
const c2=async(sq)=>{const[x,y]=await G.xy(sq,false);await page.mouse.click(x,y)};
await c2('e2'); await c2('e4'); await sleep(1100); check('coach voice note on move #2 (opponent reply) plays: ok.wav', (await snd(page)).includes('ok.wav'), JSON.stringify(await snd(page)));
await c2('d2'); await c2('d4'); await sleep(250); check('opening wrong move → opening-wrong sound (chess-horse.mp3) + banner', (await snd(page)).includes('chess-horse.mp3') && (await page.$eval('#fbanner',e=>e.textContent)).includes('Not quite'));
await c2('g1'); await c2('f3'); await sleep(1100); check('voice note on final move (ok3.mp3) + completes', (await snd(page)).includes('ok3.mp3') && !!(await page.$('.item.done')));
await page.click('#b-export'); await sleep(500); check('publish sound (hw.wav) plays on export', (await snd(page)).includes('hw.wav'));
await page.close();
// smart feedback in the real browser, real Stockfish WASM
page=await mk(); G=geo(page); await page.goto(BASE); await page.waitForSelector('#fileinput'); (await page.$('#fileinput')).uploadFile('fb.json'); await page.waitForSelector('.item.active'); await sleep(1600);
const c3=async(sq)=>{const[x,y]=await G.xy(sq,false);await page.mouse.click(x,y)}; await c3('h5'); await c3('e5');
await page.waitForFunction(()=>document.querySelector('#fbanner').classList.contains('show')&&/engine|behind|ahead|danger|trouble|gap|Watch|trouble/i.test(document.querySelector('#fbanner').textContent),{timeout:9000}).catch(()=>{});
const fbText=await page.$eval('#fbanner',e=>e.textContent); const fsnd=await snd(page);
check('blunder Qxe5?? → floating "engine ahead" banner over the board', /engine|behind|ahead|danger|trouble|gap|Watch/i.test(fbText), fbText);
check('…and the first advantage-pool sound (hint.wav) plays', fsnd.includes('hint.wav'), JSON.stringify(fsnd));
await page.waitForFunction(()=>/clear mistake/.test(document.querySelector('#fbanner').textContent),{timeout:9000}).catch(()=>{});
check('end of exercise → mistake summary banner', /clear mistake/.test(await page.$eval('#fbanner',e=>e.textContent)), await page.$eval('#fbanner',e=>e.textContent));
await page.screenshot({path:'v4_feedback.png'});
check('progress records the mistake for the coach (result.json)', await page.evaluate(()=>{const idx=JSON.parse(localStorage.getItem('hw:index'));const raw=JSON.parse(localStorage.getItem('hw:'+idx[0].id));return raw.progress.f1.mistake_count>=1&&raw.progress.f1.worst_mistake_drop_cp>=150}));
await page.close(); await b.close(); server.close(); console.log(`\n${R.filter(Boolean).length}/${R.length} passed`);
