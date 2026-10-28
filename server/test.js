// 자체 점검: 엔진이 끝까지 돌고 점수가 맞는지 + MOCK 서버 E2E
import assert from 'node:assert/strict';
import { newGame, tick, results, snapshot, MAXP } from './game.js';
import * as sumo from './sumo.js';
import { spawn } from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs';

const P = (n,a,c)=>({name:n,say:'!',a,c,g:.5,r:.2});
for(let n=2;n<=MAXP;n++){
  const g = newGame(Array.from({length:n},(_,i)=>P('t'+i,(i%3)/2,(i%2))));
  while(!g.over) tick(g);
  const rs = results(g);
  assert.equal(rs.length,n);
  const survivors = rs.filter(r=>r.survived);
  assert.ok(survivors.length<=1);
  for(const r of rs) assert.equal(r.pts,(r.survived?3:0)+r.kills);
  JSON.stringify(snapshot(g));
}
const SP=Object.keys(sumo.PRESET), SK=Object.keys(sumo.SKILL);
assert.equal(sumo.normRules([{name:'a',when:'always',act:'attack',w:1},{name:'b',when:'cornered',act:'evade',w:1},{name:'c',when:'item_near',act:'item',w:1},{name:'d',when:'always',act:'hold',w:1}]).reduce((a,r)=>a+r.w,0),sumo.BUDGET,'budget');
for(let n=2;n<=sumo.MAXP;n++){
  const g = sumo.newGame(Array.from({length:n},(_,i)=>i%2?{name:'s'+i,rules:sumo.rulesOf(SP[i%4]),skill:SK[i%4],say:sumo.LINES[SP[i%4]]}:{name:'s'+i,persona:SP[i%4],skill:SK[i%4]}));
  while(!g.over) sumo.tick(g);
  const rs = sumo.results(g);
  assert.equal(rs.length,n); assert.equal(rs.filter(r=>r.survived).length,1,'sumo always has one winner');
  for(const r of rs) assert.equal(r.pts,(r.survived?3:0)+r.kills);
  assert.ok(g.t<=120.1); JSON.stringify(sumo.snapshot(g));
}
// 마네킹 복싱: 스타일 모든 짝이 끝까지 가고 반드시 한 명이 이김
import * as boxing from './boxing.js';
const BS=Object.keys(boxing.STYLE), bx=(n,s)=>({name:n,style:s,skin:'wood',glove:0,trunk:1,say:boxing.LINES[s]});
for(const s1 of BS) for(const s2 of BS){
  const g = boxing.newGame([bx('a',s1),bx('b',s2)]); let n=0;
  while(!g.over&&n++<20000) boxing.tick(g);
  assert.ok(g.over,'boxing ends'); assert.ok(['KO','TKO','판정'].includes(g.how));
  const rs = boxing.results(g); assert.equal(rs.filter(r=>r.survived).length,1,'boxing always has one winner');
  for(const r of rs) assert.equal(r.pts,(r.survived?3:0)+r.kills);
  JSON.stringify(boxing.snapshot(g));
}
// 인생 시뮬레이션: 대본 파싱, MOCK 시뮬로 끝까지 재생, 달성 = 1점
import * as life from './life.js';
{
  const sc = life.parseScript('12: 한파\n3세: 로봇\n잡담\n12 - 또 한파\n80. 끝');
  assert.deepEqual(sc.map(s=>s.age), [3,12,80]); assert.equal(sc[1].text, '한파 또 한파');
  assert.equal(life.parseScript(life.DEFAULT_SCRIPT).length, 80);
  const g = life.newGame([{name:'a',md:'# 고집\n- 겁 많음',mission:'교수'},{name:'b',md:'',mission:'청년'}], { script:sc, sim:async(ps,s)=>ps.map(p=>life.mockLife(p,s)) });
  life.tick(g); assert.equal(g.t, 0, '계산 전엔 멈춤');
  await new Promise(r=>setTimeout(r,20)); let n=0; while(!g.over&&n++<5000) life.tick(g);
  assert.ok(g.over&&g.age===80); const rs=life.results(g); assert.equal(rs.length,2);
  for(const r of rs) assert.equal(r.pts, r.survived?1:0);
  const snap = life.snapshot(g); assert.equal(snap.players[0].life.years.length, 3); JSON.stringify(snap);
  const bad = life.newGame([{name:'a',md:'',mission:''}], { script:sc, sim:async()=>{ throw new Error('boom'); } });
  await new Promise(r=>setTimeout(r,20)); life.tick(bad); assert.ok(bad.over&&bad.err==='boom'&&bad.events[0].includes('실패'));
}
console.log('engine ok');

// MOCK 서버 E2E
const DATA = `${os.tmpdir()}/arena-test-${process.pid}.json`;
const srv = spawn(process.execPath,['server.js'],{env:{...process.env,MOCK:'1',PORT:'3999',ADMIN_PW:'x',DATA,LIFE_SEC:'3'},stdio:['ignore','pipe','inherit']});
await new Promise(ok=>srv.stdout.on('data',d=>{ if(String(d).includes('http://')) ok(); }));
const B='http://localhost:3999';
const call=async(p,body,cookie)=>{ const r=await fetch(B+p,{method:body?'POST':'GET',headers:{'content-type':'application/json',cookie:cookie||''},body:body&&JSON.stringify(body)}); return {ok:r.ok,j:await r.json(),cookie:(r.headers.get('set-cookie')||'').split(';')[0]}; };
try {
  const a=await call('/api/login',{name:'팀A',pw:'1'}); assert.ok(a.ok);
  const b=await call('/api/login',{name:'팀B',pw:'2'}); assert.ok(b.ok);
  assert.equal((await call('/api/login',{name:'팀A',pw:'wrong'})).ok,false);
  const c=await call('/api/chat',{text:'겁 많고 아이템 모으는 햄스터'},a.cookie); assert.ok(c.ok&&c.j.persona&&c.j.persona.c>.5);
  await call('/api/chat',{text:'보이는 건 다 터뜨리는 공격형'},b.cookie);
  assert.equal((await fetch(B+'/api/avatar?name=팀A')).status,404,'no avatar yet');
  const av=await call('/api/chat',{text:'프로필 이미지 만들어줘'},a.cookie); assert.equal(av.j.av,1);
  const svg=await fetch(B+'/api/avatar?name=팀A'); assert.ok(svg.ok&&svg.headers.get('content-type').includes('svg')&&(await svg.text()).startsWith('<svg'));
  assert.equal((await call('/api/state')).j.scoreboard.find(t=>t.name==='팀A').av,1);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  assert.equal((await call('/api/chat',{text:'',image:'data:text/html;base64,PGI+'},a.cookie)).ok,false,'non-image rejected');
  const ic=await call('/api/chat',{text:'이 사진으로 프로필 해줘',image:png},a.cookie); // MOCK: 첨부 사진 → 프로필
  assert.equal(ic.j.av,2); assert.deepEqual(ic.j.chat.at(-2),{role:'user',text:'이 사진으로 프로필 해줘',img:1});
  for(const u of ['/api/avatar?name=팀A','/api/img?name=팀A&n=1']){ const r=await fetch(B+u); assert.equal(r.headers.get('content-type'),'image/png'); assert.equal((await r.arrayBuffer()).byteLength,70); }
  assert.equal((await fetch(B+'/api/img?name=팀A&n=2')).status,404);
  assert.equal((await call('/api/admin/start',{},a.cookie)).ok,false,'non-admin blocked');
  const adm=await call('/api/admin/login',{pw:'x'}); assert.ok(adm.ok);
  assert.deepEqual((await call('/api/admin/state',null,adm.cookie)).j.usage,{calls:0,in:0,out:0,cost:0},'usage exposed (MOCK: no calls)');
  await call('/api/admin/speed',{speed:4},adm.cookie);
  assert.ok((await call('/api/admin/start',{},adm.cookie)).ok);
  assert.equal((await call('/api/chat',{text:'x'},a.cookie)).ok,false,'chat locked during play');
  let st; for(let i=0;i<300;i++){ await new Promise(r=>setTimeout(r,200)); st=(await call('/api/state')).j; if(st.phase==='tune') break; }
  assert.equal(st.phase,'tune'); assert.equal(st.round,2); assert.equal(st.lastRound.results.length,2);
  // 종목 전환 → 햄볼 대난투 라운드
  assert.equal((await call('/api/admin/mode',{mode:'nope'},adm.cookie)).ok,false);
  assert.equal((await call('/api/admin/mode',{mode:'sumo'},adm.cookie)).j.mode,'sumo');
  assert.equal((await call('/api/state')).j.scoreboard.find(t=>t.name==='팀A').hasPersona,false,'sumo persona separate');
  assert.equal((await call('/api/admin/start',{},adm.cookie)).ok,false,'no sumo personas yet');
  const sa=await call('/api/chat',{text:'가장자리에 몰린 놈을 노리는 묵직한 사냥꾼'},a.cookie); assert.deepEqual([sa.j.persona.rules[0].act,sa.j.persona.skill],['hunt','heavy']);
  const sb=await call('/api/chat',{text:'자애로운 천사, 궁지에 몰리면 돌격, 평소엔 아이템 파밍, 반사 장갑'},b.cookie); assert.deepEqual([sb.j.persona.rules.map(r=>r.act).sort(),sb.j.persona.skill],[['attack','attack','evade','item'],'counter']);
  assert.equal((await call('/api/me',null,a.cookie)).j.mode,'sumo');
  assert.ok((await call('/api/admin/start',{},adm.cookie)).ok);
  assert.equal((await call('/api/admin/mode',{mode:'bomb'},adm.cookie)).ok,false,'mode locked during play');
  for(let i=0;i<300;i++){ await new Promise(r=>setTimeout(r,200)); st=(await call('/api/state')).j; if(st.phase==='tune') break; }
  assert.equal(st.phase,'tune'); assert.equal(st.round,3); assert.equal(st.lastRound.results.filter(r=>r.survived).length,1);
  // 종목 전환 → 마네킹 복싱 토너먼트 (3팀: 부전승 1 + 2경기, 우승자 1명)
  assert.equal((await call('/api/admin/mode',{mode:'boxing'},adm.cookie)).j.mode,'boxing');
  const tc=await call('/api/login',{name:'팀C',pw:'3'}); assert.ok(tc.ok);
  const ba=await call('/api/chat',{text:'크롬 몸에 빨간 장갑, 잽으로 치고 빠지는 아웃복서'},a.cookie); assert.deepEqual([ba.j.persona.style,ba.j.persona.skin,ba.j.persona.glove,ba.j.persona.trunk],['out','chrome',0,1]);
  assert.equal((await call('/api/chat',{text:'파고드는 인파이터'},b.cookie)).j.persona.style,'in');
  assert.equal((await call('/api/chat',{text:'난타형'},tc.cookie)).j.persona.style,'brawl');
  assert.ok((await call('/api/admin/start',{},adm.cookie)).ok);
  st=(await call('/api/state')).j; assert.equal(st.matchTotal,2,'3팀 토너먼트 = 2경기');
  for(let i=0;i<900;i++){ await new Promise(r=>setTimeout(r,200)); st=(await call('/api/state')).j; if(st.phase==='tune') break; }
  assert.equal(st.phase,'tune'); assert.equal(st.round,4);
  assert.equal(st.lastRound.results.length,4,'2경기 × 2명'); assert.equal(st.lastRound.results.filter(r=>r.survived).length,2,'경기마다 승자 1명');
  // 종목 전환 → 인생 시뮬레이션: 작성 시작(미션 배정) → 문서 제출 → 마감 잠금 → 인생 1회
  assert.equal((await call('/api/admin/mode',{mode:'life'},adm.cookie)).j.mode,'life');
  assert.ok((await call('/api/admin/life',{missions:'교수\n청년'},adm.cookie)).ok);
  assert.ok((await call('/api/admin/life/start',{minutes:1},adm.cookie)).ok);
  const ms=(await call('/api/admin/state',null,adm.cookie)).j.users.map(u=>u.mission).sort(); assert.deepEqual(ms,['교수','교수','청년'].sort().slice(0,ms.length),'균등 배정');
  assert.equal((await call('/api/me',null,a.cookie)).j.mission.length>0,true);
  const la=await call('/api/chat',{text:'# 우리 햄스터\n- 고집이 세다\n- 겨울을 싫어한다'},a.cookie); assert.equal(la.j.persona.md.split('\n').length,3); assert.equal(la.j.persona.text,'우리 햄스터');
  assert.equal((await call('/api/admin/start',{},adm.cookie)).ok,false,'문서 낸 팀이 1팀뿐');
  await call('/api/chat',{text:'- 돈이 최고'},b.cookie);
  assert.ok((await call('/api/admin/start',{},adm.cookie)).ok);
  assert.equal((await call('/api/state')).j.live.kind,'life');
  for(let i=0;i<300;i++){ await new Promise(r=>setTimeout(r,200)); st=(await call('/api/state')).j; if(st.phase==='tune') break; }
  assert.equal(st.phase,'tune'); assert.equal(st.lastRound.mode,'life'); assert.equal(st.lastRound.results.length,2); assert.equal(st.life.n,1);
  for(const r of st.lastRound.results) assert.equal(r.pts, r.survived?1:0);
  assert.equal(st.life.deadline,0,'인생 끝나면 작성 잠금 해제'); assert.ok((await call('/api/chat',{text:'- 수정'},a.cookie)).ok);
  await call('/api/admin/delete',{name:'팀C'},adm.cookie);
  assert.equal((await call('/api/admin/mode',{mode:'bomb'},adm.cookie)).j.mode,'bomb');
  assert.ok((await call('/api/me',null,a.cookie)).j.persona.c>.5,'bomb persona kept');
  console.log('e2e ok', st.scoreboard);
} finally { srv.kill(); fs.rmSync(DATA,{force:true}); }
