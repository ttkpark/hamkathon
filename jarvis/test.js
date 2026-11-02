// MOCK 모드로 서버를 띄워 로그인 → 설계도 저장 → 대화(이미지 포함) → 현황판까지 한 바퀴 확인
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const DATA = 'test-data.json'; fs.rmSync(DATA, { force:true });
const s = spawn(process.execPath, ['server.js'], { env:{ ...process.env, MOCK:'1', PORT:'3199', DATA, ADMIN_PW:'pw' }, stdio:['ignore','pipe','inherit'] });
await new Promise(ok => s.stdout.on('data', ok));
const jar = {};
const call = async (who, path, method='GET', data) => {
  const r = await fetch('http://localhost:3199'+path, { method, headers:{ 'content-type':'application/json', cookie:jar[who]||'' }, body:data?JSON.stringify(data):undefined });
  const c = r.headers.get('set-cookie'); if(c) jar[who]=c.split(';')[0];
  return [r.status, await r.json()];
};
try {
  assert.equal((await call('a','/api/me'))[0], 401);
  let [st, me] = await call('a','/api/login','POST',{ id:'철수', pw:'1' }); assert.equal(st,200); assert.equal(me.name,'자비스');
  assert.equal((await call('b','/api/login','POST',{ id:'철수', pw:'2' }))[0], 401);           // 다른 비밀번호로 남의 아이디 못 씀
  [st, me] = await call('a','/api/me','PUT',{ name:'프라이데이', persona:'츤데레' }); assert.equal(me.persona,'츤데레');
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  let [, j] = await call('a','/api/chat','POST',{ text:'뭐 보여?', img:png });
  assert.match(j.reply, /프라이데이/); assert.match(j.reply, /카메라 장면도/);
  assert.equal((await call('a','/api/chat','POST',{}))[0], 400);
  [, me] = await call('a','/api/me'); assert.equal(me.chat.length, 2); assert.equal(me.chat[0].cam, true);
  [st, j] = await call('a','/api/watch','POST',{ img:png, recent:['자세 좋음'] }); assert.equal(st,200); assert.ok('hud' in j && 'say' in j && 'alert' in j);
  assert.equal((await call('a','/api/watch','POST',{}))[0], 400);                                   // 프레임 없으면 거절
  assert.equal((await call('adm','/api/admin'))[0], 401);
  await call('adm','/api/admin/login','POST',{ pw:'pw' });
  [st, j] = await call('adm','/api/admin'); assert.equal(st,200); assert.equal(j[0].id,'철수'); assert.equal(j[0].turns,1); assert.equal(j[0].watches,1);
  assert.equal(JSON.parse(fs.readFileSync(DATA,'utf8')).users['철수'].name, '프라이데이');   // 디스크에 남음
  console.log('ok');
} finally { s.kill(); fs.rmSync(DATA, { force:true }); }

// 외부 공개용 입구: 입장 키(jak 쿠키) · 실패 잠금 · 프록시(funnel) 뒤 실제 IP
const g = spawn(process.execPath, ['server.js'], { env:{ ...process.env, MOCK:'1', PORT:'3198', ADMIN_PW:'pw', DATA, ACCESS_KEY:'k3y', FAILS:'2' }, stdio:['ignore','pipe','inherit'] });
await new Promise(ok => g.stdout.on('data', ok));
try {
  const G = 'http://localhost:3198', get = (p,h={}) => fetch(G+p,{ headers:h, redirect:'manual' });
  assert.equal((await get('/')).status, 401); assert.equal((await get('/api/me')).status, 401);
  const r = await get('/admin?key=k3y'); assert.equal(r.status, 302); assert.equal(r.headers.get('location'), '/admin');
  const ak = r.headers.get('set-cookie').split(';')[0]; assert.match(ak, /^jak=/); assert.ok(!ak.includes('k3y'));
  assert.equal((await get('/', { cookie:ak })).status, 200);
  const login = (pw, xff) => fetch(G+'/api/admin/login', { method:'POST', headers:{ 'content-type':'application/json', cookie:ak, ...(xff?{'x-forwarded-for':xff}:{}) }, body:JSON.stringify({ pw }) });
  assert.equal((await login('no')).status, 401); assert.equal((await login('no')).status, 401);
  assert.equal((await login('pw')).status, 429, '잠김 동안 맞는 비번도 거부');
  const ok2 = await login('pw', '9.9.9.9, 203.0.113.9'); assert.equal(ok2.status, 200, '프록시 뒤 다른 접속자는 안 잠김'); assert.match(ok2.headers.get('set-cookie'), /^jsid=/);
  console.log('security ok');
} finally { g.kill(); fs.rmSync(DATA, { force:true }); }
