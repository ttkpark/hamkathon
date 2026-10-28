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
