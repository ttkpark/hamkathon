// 나만의 자비스 플랫폼: 참가자가 아이디로 들어와 자기 자비스(이름·설계도)를 만들고, 자기 PC 카메라/마이크로 대화한다.
// 브라우저가 웹캠 프레임 + 말한 내용을 보내면 이 서버에 로그인된 Claude Code 계정으로 `claude -p` 실행. 대화 기억은 참가자별 CLI 세션(--resume).
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { Duplex } from 'node:stream';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';

const here = path.dirname(fileURLToPath(import.meta.url));
// 같은 폴더의 .env(ACCESS_KEY, ADMIN_PW 등)가 있으면 환경변수를 덮어씀 — systemd 유닛을 안 고치고 비밀값만 바꾸는 용도
try { Object.assign(process.env, parseEnv(fs.readFileSync(path.join(here,'.env'),'utf8'))); } catch {}
const PORT = +process.env.PORT || 3100;
const MODEL = process.env.MODEL || 'haiku';
const ADMIN_PW = process.env.ADMIN_PW || 'admin';
const DATA = process.env.DATA || path.join(here, 'data.json');
const offline = !!process.env.MOCK;

// ---------- 접근 제한 · 무차별 대입 방어 (외부 공개용, 아레나와 같은 방식) ----------
// ACCESS_KEY가 있으면 모든 요청에 키 쿠키(jak) 필요. 처음엔 /?key=… 로 들어오면 쿠키를 받고 주소에서 키가 지워짐.
// 실패(키·비번·관리자 비번)는 IP당 15분에 FAILS회 넘으면 잠김. 요청량·새 계정도 IP 단위로 제한.
// ponytail: 메모리 고정 창 카운터. 재시작하면 초기화.
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const akTok = ACCESS_KEY && crypto.createHash('sha256').update('jarvis-ak:'+ACCESS_KEY).digest('hex');
const FAILS = +process.env.FAILS || 20, REQ_MAX = +process.env.REQ_MAX || 1200, MAX_USERS = +process.env.MAX_USERS || 100;
const RL = new Map();
const hit = (k, max, ms) => { const now=Date.now(); let e=RL.get(k); if(!e||now-e[0]>ms) RL.set(k, e=[now,0]); return ++e[1] > max; };
const failed = ip => hit('f:'+ip, Infinity, 15*60000);
const locked = ip => { const e=RL.get('f:'+ip); return !!e && Date.now()-e[0]<=15*60000 && e[1]>=FAILS; };
setInterval(()=>{ const now=Date.now(); for(const [k,e] of RL) if(now-e[0]>3600000) RL.delete(k); }, 600000).unref();
const same = (a,b) => crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a??'')).digest(), crypto.createHash('sha256').update(String(b??'')).digest());
// tailscale funnel/serve 같은 로컬 프록시를 거치면 접속자가 전부 127.0.0.1 → 프록시가 붙인 X-Forwarded-For의 마지막 값(위조 불가)을 씀
const clientIp = req => { const r=req.socket.remoteAddress||'?', f=req.headers['x-forwarded-for']; return f && /^(::ffff:)?127\.|^::1$/.test(r) ? f.split(',').at(-1).trim() : r; };
const KEY_PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>입장 키</title></head><body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh"><form method="get" style="display:grid;gap:10px;width:min(320px,90vw)"><b>나만의 자비스 입장 키</b><input name="key" type="password" autofocus required style="padding:10px;font-size:16px"><button style="padding:10px">입장</button></form></body></html>`;

// ---------- 저장소 (data.json 하나) ----------
// ponytail: JSON 파일 통째로 쓰기. 수십 명 규모면 충분, 수백 명이면 sqlite로.
const db = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA,'utf8')) : { users:{} };
const save = () => fs.writeFileSync(DATA, JSON.stringify(db));
const sessions = new Map(); // sid -> user id | '*admin'   (서버 재시작하면 다시 로그인)
const busy = new Set();     // 같은 사람이 동시에 두 번 묻지 않게 (--resume 세션 충돌 방지)

// ---------- Claude ----------
const SYSTEM = u => `너는 참가자 "${u.id}"가 직접 만든 개인 AI 비서다. 네 이름은 "${u.name}"이고, 자기소개할 때도 그 이름을 쓴다.
참가자가 쓴 설계도(성격·역할·규칙):
${u.persona || '친절하고 재치 있는 비서'}
위 설계도를 말투와 행동에 확실히 드러내라.
매 메시지에는 참가자의 컴퓨터 카메라로 지금 보이는 장면이 사진으로 붙어 온다. 질문이 장면과 관련 있으면 사진을 근거로 구체적으로 답하고, 관련 없으면 굳이 언급하지 마라.
답은 음성으로 읽어 준다. 그러니 짧게, 1~2문장으로 말하듯 한국어로. 되묻는 질문을 붙이지 마라. 마크다운·이모지·목록·괄호 설명 금지. 모르면 모른다고 해라.`;

// 자동 관찰 모드: 참가자가 부르지 않아도 N초마다 장면을 보고 설계도대로 판단 → HUD 한 줄 + 꼭 필요할 때만 말함
const WATCH = (u, recent) => SYSTEM(u) + `
지금은 자동 관찰 모드다. 참가자가 부른 게 아니라 카메라가 주기적으로 장면을 보내는 것이다. 설계도에 적힌 역할대로 장면을 판단해라.
hud = 화면 구석에 띄울 현재 상태 한 줄(20자 이내, 예: "졸음 70% 눈 감김", "자세 좋음", "재료: 계란 우유 파").
say = 지금 꼭 말해야 할 것이 있을 때만 1문장(설계도가 말하라고 한 상황, 상태가 바뀐 순간, 위험·주의). 매번 말하면 시끄러우니 평소엔 빈 문자열.
alert = 주의가 필요한 상황이면 true.
최근 관찰 기록(오래된 것부터): ${recent.length ? recent.join(' | ') : '없음'}`;
const WATCH_SCHEMA = JSON.stringify({ type:'object', additionalProperties:false, required:['hud','say','alert'],
  properties:{ hud:{type:'string'}, say:{type:'string'}, alert:{type:'boolean'} } });
const WATCH_DIR = path.join(here,'watch-sessions'); fs.mkdirSync(WATCH_DIR, { recursive:true });

// 대화(resume=true)는 참가자별 세션을 이어가고, 관찰은 매번 새 세션(사진이 계속 쌓이면 세션이 비대해지므로). 관찰 세션 파일은 cwd가 달라 별도 폴더에 쌓임 → README의 정리 명령으로 지움.
const claude = (u, content, { system=SYSTEM(u), schema=null, resume=true } = {}) => new Promise((ok, no) => {
  const args = ['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--model',MODEL,'--tools','','--strict-mcp-config','--system-prompt',system];
  if(schema) args.push('--json-schema', schema);
  if(resume && u.session) args.push('--resume', u.session);
  const { ANTHROPIC_API_KEY, ...env } = process.env; // 키가 있으면 로그인 계정 대신 그걸 써버림 → 항상 로그인 계정
  const c = spawn('claude', args, { stdio:['pipe','pipe','pipe'], timeout:120000, env, cwd: resume ? here : WATCH_DIR });
  let out='', err=''; c.stdout.on('data', d=>out+=d); c.stderr.on('data', d=>err+=d);
  c.on('error', no);
  c.on('close', code => {
    const r = out.split('\n').map(l=>{ try{ return JSON.parse(l); }catch{ return null; } }).find(j=>j?.type==='result');
    if(!r || r.is_error) return no(new Error(`자비스 연결 실패 (${code}): ${(r?.result||err||out).toString().slice(0,300)}`));
    if(resume) u.session = r.session_id;
    ok(schema ? (r.structured_output || {}) : String(r.result||'').trim());
  });
  c.stdin.end(JSON.stringify({ type:'user', message:{ role:'user', content } }) + '\n');
});

// ---------- HTTP ----------
const DATAURL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const json = (res, code, obj) => { res.writeHead(code, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); };
const page = (res, f) => { res.writeHead(200,{'content-type':'text/html; charset=utf-8'}); res.end(fs.readFileSync(path.join(here,'public',f))); };
const cookie = (req,k) => (req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).find(([a])=>a===k)?.[1];
const setCookie = (res,k,v) => res.setHeader('set-cookie', `${k}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`); // 같은 도메인의 아레나(:8443)와 쿠키가 섞이지 않게 이름은 jsid/jak
const body = req => new Promise((ok,no)=>{ let s=''; req.on('data',c=>{ s+=c; if(s.length>3e6){ no(new Error('too big')); req.destroy(); } }); req.on('end',()=>{ try{ ok(s?JSON.parse(s):{}); }catch(e){ no(e); } }); });
const hash = pw => crypto.scryptSync(pw, 'jarvis', 32).toString('hex');
const me = u => ({ id:u.id, name:u.name, persona:u.persona, chat:u.chat.slice(-100) });

async function handle(req, res){
  const url = new URL(req.url,'http://x'), p = url.pathname, ip = clientIp(req);
  res.setHeader('x-content-type-options','nosniff'); res.setHeader('x-frame-options','DENY'); res.setHeader('referrer-policy','no-referrer');
  if(hit('r:'+ip, REQ_MAX, 60000)) return json(res,429,{error:'요청이 너무 많아요. 잠시 후 다시'});
  if(akTok && !same(cookie(req,'jak'), akTok)){
    const k = url.searchParams.get('key');
    if(k!=null && !locked(ip)){
      if(same(k, ACCESS_KEY)){ res.writeHead(302,{ 'set-cookie':`jak=${akTok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*86400}`, location:'/'+p.replace(/^\/+/,'') }); return res.end(); }
      failed(ip);
    }
    if(locked(ip)) return json(res,429,{error:'실패가 너무 많아요. 15분 뒤 다시'});
    if(req.method==='GET' && !p.startsWith('/api/')){ res.writeHead(401,{'content-type':'text/html; charset=utf-8'}); return res.end(KEY_PAGE); }
    return json(res,401,{error:'입장 키가 필요해요'});
  }
  if(req.method==='GET' && p==='/') return page(res,'index.html');
  if(req.method==='GET' && p==='/admin') return page(res,'admin.html');
  const who = sessions.get(cookie(req,'jsid'));
  const user = who && who!=='*admin' ? db.users[who] : null;
  const b = req.method==='POST' || req.method==='PUT' ? await body(req) : {};

  if(p==='/api/login'){ // 처음 쓰는 아이디면 자동 생성
    const id = String(b.id||'').trim().slice(0,20), pw = String(b.pw||'');
    if(locked(ip)) return json(res,429,{error:'실패가 너무 많아요. 15분 뒤 다시'});
    if(!/^[\w가-힣-]{2,20}$/.test(id) || pw.length<1) return json(res,400,{error:'아이디(2~20자, 한글/영문/숫자)와 비밀번호를 적어주세요'});
    if(!db.users[id] && (Object.keys(db.users).length>=MAX_USERS || hit('n:'+ip,10,3600000))) return json(res,429,{error:'새 아이디를 더 만들 수 없어요'});
    const u = db.users[id] ||= { id, pw:hash(pw), name:'자비스', persona:'', session:null, chat:[], at:new Date().toISOString() };
    if(!same(u.pw, hash(pw))){ failed(ip); return json(res,401,{error:'비밀번호가 달라요'}); }
    const sid = crypto.randomBytes(16).toString('hex'); sessions.set(sid, id); setCookie(res,'jsid',sid); save();
    return json(res,200,me(u));
  }
  if(p==='/api/admin/login'){
    if(locked(ip)) return json(res,429,{error:'실패가 너무 많아요. 15분 뒤 다시'});
    if(!same(b.pw, ADMIN_PW)){ failed(ip); return json(res,401,{error:'비밀번호가 달라요'}); }
    const sid = crypto.randomBytes(16).toString('hex'); sessions.set(sid,'*admin'); setCookie(res,'jsid',sid); return json(res,200,{ok:true});
  }
  if(p==='/api/admin'){ // 참가자 현황: 누가 어떤 자비스를 만들었고 몇 번 대화했나
    if(who!=='*admin') return json(res,401,{error:'관리자 로그인 필요'});
    if(req.method==='DELETE'){ delete db.users[new URL(req.url,'http://x').searchParams.get('id')]; save(); return json(res,200,{ok:true}); }
    return json(res,200, Object.values(db.users).map(u=>({ id:u.id, name:u.name, persona:u.persona, turns:u.chat.filter(m=>m.role==='me').length, watches:u.watches||0, last:u.chat.at(-1)?.text||'', at:u.at })));
  }
  if(!user) return json(res,401,{error:'로그인이 필요해요'});
  if(p==='/api/me'){
    if(req.method==='PUT'){ user.name = String(b.name||'자비스').trim().slice(0,20)||'자비스'; user.persona = String(b.persona||'').slice(0,2000); save(); }
    return json(res,200,me(user));
  }
  if(p==='/api/reset'){ user.session=null; user.chat=[]; save(); return json(res,200,{ok:true}); }
  if(p==='/api/watch'){ // 자동 관찰 한 틱: 프레임 + 최근 HUD 기록 → {hud, say, alert}
    const m = DATAURL.exec(b.img||''); if(!m) return json(res,400,{error:'카메라 프레임이 없어요'});
    if(busy.has(user.id)) return json(res,429,{error:'아직 대답 중이에요'});
    const recent = (Array.isArray(b.recent)?b.recent:[]).slice(-6).map(s=>String(s).slice(0,40));
    busy.add(user.id); user.watches = (user.watches||0)+1;
    try {
      const o = offline ? { hud:'(오프라인) 장면 수신', say:'', alert:false }
        : await claude(user, [{ type:'image', source:{ type:'base64', media_type:m[1], data:m[2] } }, { type:'text', text:'지금 장면' }], { system:WATCH(user,recent), schema:WATCH_SCHEMA, resume:false });
      if(o.say) { user.chat.push({ role:'ai', text:o.say, watch:true }); save(); }
      return json(res,200,{ hud:String(o.hud||'').slice(0,40), say:String(o.say||''), alert:!!o.alert });
    } finally { busy.delete(user.id); }
  }
  if(p==='/api/chat'){
    const text = String(b.text||'').slice(0,1000).trim(); if(!text) return json(res,400,{error:'할 말이 없어요'});
    if(busy.has(user.id)) return json(res,429,{error:'아직 대답 중이에요'});
    const m = DATAURL.exec(b.img||'');
    const content = m ? [{ type:'image', source:{ type:'base64', media_type:m[1], data:m[2] } }, { type:'text', text }] : text;
    busy.add(user.id);
    try {
      const reply = offline ? `(오프라인) ${user.name}입니다. "${text}" 라고 하셨고 ${m?'카메라 장면도 받았어요':'카메라 없이 들었어요'}.` : await claude(user, content);
      user.chat.push({ role:'me', text, cam:!!m }, { role:'ai', text:reply }); save();
      return json(res,200,{ reply });
    } finally { busy.delete(user.id); }
  }
  json(res,404,{error:'not found'});
}
const onReq = (req,res) => handle(req,res).catch(e => json(res,500,{error:e.message}));
// 카메라·마이크는 localhost 아니면 https에서만 열린다 → 인증서가 있으면 https로.
// 같은 포트에 http://로 들어오면(첫 바이트가 TLS 핸드셰이크 0x16이 아니면) https로 301 리다이렉트.
const tlsOpt = process.env.TLS_KEY && process.env.TLS_CERT && { key:fs.readFileSync(process.env.TLS_KEY), cert:fs.readFileSync(process.env.TLS_CERT) };
const ready = () => console.log(`나만의 자비스 ${tlsOpt?'https':'http'}://localhost:${PORT} (model ${MODEL}${offline?', MOCK':''})`);
if(!tlsOpt) http.createServer(onReq).listen(PORT, ready);
else {
  const secure = https.createServer(tlsOpt, onReq), ctx = tls.createSecureContext(tlsOpt);
  const redirect = http.createServer((req,res)=>{ res.writeHead(301,{ location:`https://${(req.headers.host||'localhost').split(':')[0]}:${PORT}${req.url}` }); res.end(); });
  net.createServer(sock => sock.once('data', buf => {
    sock.pause(); sock.unshift(buf);
    if(buf[0]!==0x16){ redirect.emit('connection', sock); sock.resume(); return; }
    // ponytail: 첫 청크를 이미 읽었으므로 네이티브 핸들 대신 JS 스트림으로 감싸 TLS에 넘김(약간 느리지만 수십 명 규모엔 충분)
    const t = new tls.TLSSocket(Duplex.from({ readable:sock, writable:sock }), { isServer:true, secureContext:ctx, server:secure });
    t.once('secure', () => secure.emit('secureConnection', t)); t.on('error', () => sock.destroy()); sock.resume();
  })).listen(PORT, ready);
}
