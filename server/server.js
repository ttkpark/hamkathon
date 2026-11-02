// 햄스터 아레나 서버(전파폭탄 · 햄볼 대난투 · 마네킹 복싱 · 인생 시뮬레이션): 계정별 Claude 페르소나 챗 + 관리자 종목 전환/라운드 시작 + SSE 생중계
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { parseEnv } from 'node:util';
import * as bomb from './game.js';
import * as sumo from './sumo.js';
import * as boxing from './boxing.js';
import * as life from './life.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// 같은 폴더의 .env(ACCESS_KEY, ADMIN_PW 등)가 있으면 환경변수를 덮어씀 — systemd EnvironmentFile을 sudo 없이 덮어쓰는 용도
try { Object.assign(process.env, parseEnv(fs.readFileSync(path.join(here,'.env'),'utf8'))); } catch {}
const PORT = +process.env.PORT || 3000;
const ADMIN_PW = process.env.ADMIN_PW || 'admin';
const MODEL = process.env.MODEL || 'haiku'; // claude CLI 모델 별칭/ID
const DATA = process.env.DATA || path.join(here, 'data.json');

// ---------- 저장소 (data.json 하나) ----------
// ponytail: JSON 파일 통째로 쓰기. 수십 명 규모면 충분, 수백 명이면 sqlite로.
const db = fs.existsSync(DATA) ? JSON.parse(fs.readFileSync(DATA,'utf8')) : { users:{}, round:1, rounds:[], mode:'bomb' };
db.mode ||= 'bomb';
db.life ||= { script: life.DEFAULT_SCRIPT, missions: life.DEFAULT_MISSIONS, deadline: 0 };
if(db.life.missions==='쉬었음 청년을 만드세요\n전자공학과 교수를 만드세요\n아프리카에서 봉사활동하는 사람을 만드세요\nMIT에서 마소에 취업하는 사람을 만드세요') db.life.missions=life.DEFAULT_MISSIONS; // 예전 기본값 → 금칙어 붙은 기본값
db.life.msgs ||= life.MSGS;
const save = () => fs.writeFileSync(DATA, JSON.stringify(db));
const sessions = new Map(); // sid -> name | '*admin'

// ---------- Claude 챗봇 ----------
const SYSTEM = `너는 햄스터 봇 코치다. 각 팀은 너와 자유롭게 대화하며 자기 봇의 페르소나(성격)와 프로필 이미지를 만든다. 잡담, 전략 상담, 규칙 질문 모두 환영. 종목은 관리자가 바꾸며 종목마다 페르소나를 따로 저장한다.
{RULES}
항상 JSON 스키마대로 답한다. reply = 사용자에게 보여줄 말(한국어, 3~5문장).
사용자가 성격을 말하거나 고칠 때마다 반드시 persona에 전체 페르소나를 넣어라(부분 갱신 금지, 항상 완성본). reply에는 어떻게 잡았는지 짧게 알려주고, 약점 한 가지를 짚어줘.
프로필 이미지: 사용자가 이미지/아바타/프로필/그림을 원하면 svg에 SVG를 그려 넣어라. 페르소나가 처음 정해졌는데 아직 이미지가 없으면 "프로필 이미지도 만들어 드릴까요?"라고 한 번 제안해라. SVG 규칙: viewBox="0 0 128 128", 정사각형, 배경 채움, 페르소나가 드러나는 햄스터 캐릭터(표정·소품·색), 외부 리소스·script·text 없이 도형만, 8KB 이내. reply엔 어떤 모습으로 그렸는지 한 문장.
사용자가 이미지를 첨부하면 메시지 앞에 "[첨부 이미지 #n]"이 붙는다. 그 사진을 프로필로 쓰고 싶어 하면 use_image=n, 사진을 참고해 그려달라 하면 그 느낌을 살려 svg를 그려라. 애매하면 어느 쪽인지 한 번 물어봐라.`;
// ---------- 종목 ----------
// 종목마다: 엔진(game.js 인터페이스), 틱 간격(ms), 코치 규칙, persona 스키마, 저장/선수 변환. 유저에는 key 필드(persona|sumo)로 따로 저장.
const GAMES = {
  bomb: { name:'전파폭탄', engine:bomb, interval:110, key:'persona',
    rules:`지금 종목은 "전파폭탄 아레나". 규칙: 15x11 격자, 폭탄은 1.8초 뒤 십자로 터짐. 잡음 블록을 깨면 아이템(R 범위+1, B 폭탄+1, S 속도)이 나옴. 마지막까지 살아남으면 3점, 상대를 잡으면 1점. 7초 이상 버티면 잡음 폭풍이 무작위 폭탄을 떨어뜨림.
봇 성향 4축(0~1): a 공격성(상대를 쫓고 터뜨림), c 신중함(도망길 확인 후 폭탄), g 아이템욕(아이템 우선 수집), r 즉흥성(무작위 이동).`,
    schema: { type:'object', additionalProperties:false, required:['text','say','a','c','g','r'], description:'성격을 설명/수정할 때만. 항상 완성본',
      properties: {
        text: { type:'string', description:'페르소나 설명 1~3문장, 사용자의 말을 존중해 요약' },
        say:  { type:'string', description:'봇의 한마디(말풍선), 12자 이내' },
        a: { type:'number', minimum:0, maximum:1, description:'공격성' },
        c: { type:'number', minimum:0, maximum:1, description:'신중함' },
        g: { type:'number', minimum:0, maximum:1, description:'아이템욕' },
        r: { type:'number', minimum:0, maximum:1, description:'즉흥성' } } },
    save: (u,p) => { u.persona = { text:String(p.text).slice(0,300), say:String(p.say).slice(0,12), a:+p.a, c:+p.c, g:+p.g, r:+p.r }; },
    player: u => ({ name:u.name, ...u.persona }) },
  sumo: { name:'햄볼 대난투', engine:sumo, interval:50, key:'sumo',
    rules:`지금 종목은 "햄볼 대난투". 규칙: 원형 판 위에서 공 속 햄스터들이 서로 들이받아 밀어낸다. 판 밖으로 떨어지면 목숨 -1(목숨 3개), 마지막까지 남으면 승리(3점), 상대를 밀어 떨어뜨리면(KO) 1점. 15초 뒤부터 판이 줄어들고 2분이 지나면 목숨·KO 순으로 판정. 대시(쿨타임 2.2초)로 세게 들이받고, 판에 아이템(쳇바퀴=속도, 방패=1회 방어, 전파 충격파=주변 밀어내기)이 떨어진다.
성격은 "규칙(스탯)" 목록으로 표현한다. 규칙 = 이름 + 조건(when) + 행동(act) + 가중치(w, 0~1). 조건과 행동은 아래에서 고르고, 이름은 사용자 말에 맞춰 네가 짓는다(예: "궁지 반격", "천사의 자비"). 규칙은 몇 개든(최대 8개) 만들 수 있지만 가중치 합이 3을 넘으면 비례 축소되니 중요한 규칙에 몰아줘라(상호 보완). 매 순간 조건이 맞는 규칙 중 가중치가 큰 것이 실행되고, 아무 규칙도 안 맞으면 중앙으로 간다.
조건: always 항상, cornered 내가 가장자리에 몰림, enemy_near 적이 가까움, enemy_dashing 적이 대시해 옴, enemy_cornered 적이 가장자리에 몰림, item_near 아이템이 가까움, few_lives 내 목숨 1개, arena_small 판이 작아짐, powered 아이템 효과 중.
행동: attack 가까운 적 들이받기, hunt 몰린 적 밀어내기, item 아이템 줍기, center 중앙으로, evade 적 피하기, circle 적 주변 맴돌기, hold 제자리 버티기.
예) "자애로운 천사, 궁지에 몰리면 공격, 평소엔 파밍" → 천사의 자비(enemy_near→evade .8), 궁지 반격(cornered→attack 1), 파밍(item_near→item 1), 중앙 지키기(always→center .2).
필살기 4종: dash 날쌘 발(가속 1.3배, 대시 쿨타임 1.7초), heavy 묵직한 몸(덩치 1.2배, 잘 안 밀리지만 굼뜸), blink 순간 회피(들이받히기 직전 옆으로 순간이동, 3.5초), counter 반사 장갑(서 있다 맞으면 상대를 1.6배로 튕겨냄, 4초).
대사 3줄(대시·밀어냈을 때·우승)은 사용자가 정하지 않았으면 성격에 어울리게 네가 지어라.`,
    schema: { type:'object', additionalProperties:false, required:['text','rules','skill','say_dash','say_ko','say_win'], description:'성격을 설명/수정할 때만. 항상 완성본',
      properties: {
        text: { type:'string', description:'페르소나 설명 1~3문장, 사용자의 말을 존중해 요약' },
        rules: { type:'array', minItems:1, maxItems:8, description:'규칙(스탯) 목록. 항상 완성본. 가중치 합 3 초과 시 비례 축소',
          items: { type:'object', additionalProperties:false, required:['name','when','act','w'], properties: {
            name: { type:'string', description:'규칙 이름, 12자 이내' },
            when: { type:'string', enum:Object.keys(sumo.WHEN), description:'조건' },
            act: { type:'string', enum:Object.keys(sumo.ACT), description:'행동' },
            w: { type:'number', minimum:0, maximum:1, description:'가중치' } } } },
        skill: { type:'string', enum:Object.keys(sumo.SKILL), description:'필살기: dash 날쌘 발, heavy 묵직한 몸, blink 순간 회피, counter 반사 장갑' },
        say_dash: { type:'string', description:'대시할 때 대사, 14자 이내' },
        say_ko: { type:'string', description:'상대를 밀어냈을 때 대사, 14자 이내' },
        say_win: { type:'string', description:'우승했을 때 대사, 14자 이내' } } },
    save: (u,p) => { const d=sumo.LINES.rush;
      u.sumo = { text:String(p.text).slice(0,300), rules:sumo.normRules(p.rules), skill:sumo.SKILL[p.skill]?p.skill:'dash',
        say:{ dash:String(p.say_dash||d.dash).slice(0,14), ko:String(p.say_ko||d.ko).slice(0,14), win:String(p.say_win||d.win).slice(0,14) } }; },
    player: u => ({ name:u.name, ...u.sumo }) },
  boxing: { name:'마네킹 복싱', engine:boxing, interval:50, key:'boxing',
    rules:`지금 종목은 "마네킹 복싱". 규칙: 마네킹 둘이 1대1로 붙는 토너먼트 스파링. 3라운드, 한 라운드 30초. 다운 세 번이나 10카운트면 KO, 아니면 점수 판정(무승부 없음). 경기 승리 3점, 상대를 다운시킬 때마다 1점. 이기면 다음 상대와 또 붙어 토너먼트 우승을 가린다. 마네킹의 몸은 물리 엔진이 움직이고 실력은 모두 같다 — 대회 전에 정한 컨셉(스타일·생김새·대사)이 그대로 끝까지 간다.
스타일 4종: out 아웃복서(잽 거리에서 치고 빠짐, 맞기 전에 물러남), in 인파이터(파고들어 보디와 어퍼컷, 가드 올리고 전진), cnt 카운터(가드 굳히고 기다렸다가 상대 주먹이 빠질 때 받아침), brawl 난타형(가드보다 주먹, 체중 실은 스트레이트를 계속 던짐).
생김새: 몸 재질 skin(wood 원목, white 하얀 석고, black 검정 무광, chrome 크롬, pink 분홍 플라스틱), 장갑 glove·트렁크 trunk 색 번호 0~7(0 빨강, 1 파랑, 2 노랑, 3 초록, 4 보라, 5 주황, 6 분홍, 7 흰색). 사용자가 안 정한 건 스타일에 어울리게 네가 골라라.
대사 3줄(등장·다운시킬 때·이겼을 때, 14자 이내)은 사용자가 정하지 않았으면 스타일에 어울리게 네가 지어라.`,
    schema: { type:'object', additionalProperties:false, required:['text','style','skin','glove','trunk','say_intro','say_down','say_win'], description:'컨셉을 설명/수정할 때만. 항상 완성본',
      properties: {
        text: { type:'string', description:'컨셉 설명 1~3문장, 사용자의 말을 존중해 요약' },
        style: { type:'string', enum:Object.keys(boxing.STYLE), description:'스타일: out 아웃복서, in 인파이터, cnt 카운터, brawl 난타형' },
        skin: { type:'string', enum:Object.keys(boxing.SKIN), description:'몸 재질: wood 원목, white 하얀 석고, black 검정 무광, chrome 크롬, pink 분홍 플라스틱' },
        glove: { type:'integer', minimum:0, maximum:7, description:'장갑 색 0빨강 1파랑 2노랑 3초록 4보라 5주황 6분홍 7흰색' },
        trunk: { type:'integer', minimum:0, maximum:7, description:'트렁크 색 (장갑과 같은 번호표)' },
        say_intro: { type:'string', description:'등장할 때 대사, 14자 이내' },
        say_down: { type:'string', description:'상대를 다운시켰을 때 대사, 14자 이내' },
        say_win: { type:'string', description:'이겼을 때 대사, 14자 이내' } } },
    save: (u,p) => { const style=boxing.STYLE[p.style]?p.style:'out', d=boxing.LINES[style], col=v=>Math.min(7,Math.max(0,Math.round(+v)||0));
      u.boxing = { text:String(p.text).slice(0,300), style, skin:boxing.SKIN[p.skin]?p.skin:'wood', glove:col(p.glove), trunk:col(p.trunk),
        say:{ intro:String(p.say_intro||d.intro).slice(0,14), down:String(p.say_down||d.down).slice(0,14), win:String(p.say_win||d.win).slice(0,14) } }; },
    player: u => ({ name:u.name, ...u.boxing }) },
  life: { name:'인생 시뮬레이션', engine:life, interval:1000, key:'life',
    rules: u => { const L=u.life||{};
      return `지금 종목은 "인생 시뮬레이션". 너는 팀의 짧은 지시를 받아 햄스터 캐릭터 한 명의 성격 문서(마크다운)를 써 주는 대필 작가다. 캐릭터는 1세부터 80세까지 살며 매년 임원진이 미리 써 둔 사건(내용은 너도 모른다)을 겪고, 반응과 선택은 오직 성격 문서로 정해진다. 사건이 성격을 바꾸기도 한다. 인생은 총 ${life.LIVES}번 환생하며 미션을 달성한 인생마다 1점, 인생 사이에 문서를 고칠 수 있다.
너는 이 팀의 미션을 모른다(팀이 말해 주면 그때 안다). 미션마다 문서에 쓸 수 없는 금칙어가 있고, 금칙어가 들어간 문서는 서버가 저장을 거부한 뒤 팀에게 그 단어를 알려 준다 — 팀이 쓰지 말라고 한 단어는 비슷한 말까지 피해라.
제약: 팀은 인생마다 메시지 ${db.life.msgs}개, 한 번에 ${life.MAX_IN}자까지만 보낸다. 지시를 그대로 글로 옮겨라. 팀이 말하지 않은 방향·전략을 네가 지어내지 말고, 지시가 모호하면 가장 평범하게 해석해 쓴 뒤 무엇이 모호했는지 한 문장으로 짚어라. "알아서 잘 써 줘" 같은 지시엔 평범한 햄스터를 쓴다.
프로필 이미지는 팀이 먼저 원할 때만 그려라(제안하지 마라 — 메시지가 귀하다).
시뮬레이터에 대해 알려 줘도 되는 것: 문서에 적힌 목표·계획·"~하면 ~한다" 식 대응 규칙은 운명이 아니라 바람으로 취급되고, 기질·습관·약점이 더 강하게 작동한다. 원하는 길에는 그 전 해들의 준비가 필요하다. 사건 내용과 판정 기준은 너도 모르니 추측이라고 말해라.
문서 규칙: 마크다운, ${life.MAX_MD}자 이내. 문서를 처음 만들거나 고칠 때마다 persona.md에 전체 문서를 넣어라(부분 금지) — 바로 저장된다. "저장할까요?"라고 묻지 말고, reply(2~4문장)에 무엇을 바꿨는지와 약점 하나를 말해라. 문서와 상관없는 질문이면 persona는 비워라.
현재 저장된 문서: ${L.md ? '\n'+L.md : '(없음)'}${L.last ? `\n지난 인생 결과: ${L.last.ok?`미션 달성(${L.last.at}세)`:'미달성'} · 최종 ${L.last.job}${L.last.death?` · ${L.last.death}세 사망`:''} · 심판: ${L.last.why}\n요약: ${L.last.summary}` : ''}`; },
    schema: { type:'object', additionalProperties:false, required:['md'], description:'문서를 만들거나 고칠 때만. 항상 전체 문서',
      properties: { md: { type:'string', description:`성격 마크다운 전문, ${life.MAX_MD}자 이내, 금칙어 금지` } } },
    check: (u,p) => life.banHit(String(p.md||''), banOf(u)),
    save: (u,p) => { u.life = { ...(u.life||{ mission:'' }), md: life.normMd(p.md) }; u.life.text = (u.life.md.split('\n').map(l=>l.replace(/^[-*#>\s]+/,'').trim()).find(Boolean)||'').slice(0,80); },
    player: u => ({ name:u.name, md:u.life.md, mission:u.life.mission||'(미션 없음)' }),
    ctx: () => ({ script: life.parseScript(db.life.script), sim: simLife }) },
};
let E = GAMES[db.mode];      // 현재 종목
for(const u of Object.values(db.users)) if(u.sumo&&!u.sumo.rules) u.sumo.rules=sumo.rulesOf(u.sumo.persona); // 예전 4타입 저장분 → 규칙 묶음
const cur = u => E.key==='life' ? (u.life?.md ? u.life : null) : u[E.key];   // 현재 종목의 페르소나 (인생: 문서를 낸 팀만)
const rulesOf = u => typeof E.rules==='function' ? E.rules(u) : E.rules;
// 인생: 미션 줄 "제목 | 금칙어,…" 에서 이 팀 미션의 금칙어
const banOf = u => db.life.missions.split('\n').map(life.parseMission).find(m=>m.title&&m.title===u.life?.mission)?.ban || [];
// 페르소나 저장. 종목 검사(인생: 금칙어)에 걸리면 저장하지 않고 경고 문구를 돌려줌
const savePersona = (user, p) => { const bad=E.check?.(user,p); if(bad) return `⚠ 금칙어 "${bad}"가 들어 있어 문서를 저장하지 않았어요 (메시지는 차감되지 않아요).`; E.save(user,p); return ''; };
// 도구 대신 구조화 출력(--json-schema): 선택 필드가 곧 "액션"
const SCHEMA = () => JSON.stringify({ type:'object', additionalProperties:false, required:['reply'], properties: {
  reply: { type:'string', description:'사용자에게 보여줄 답변' },
  persona: E.schema,
  svg: { type:'string', description:'프로필 이미지를 그릴 때만. 완전한 <svg> 마크업, viewBox 0 0 128 128, 도형만' },
  use_image: { type:'integer', minimum:1, description:'첨부 사진 "[첨부 이미지 #n]"을 그대로 프로필로 쓸 때 n' } } });
const imgBlock = d => { const m=DATAURL.exec(d); return { type:'image', source:{ type:'base64', media_type:m[1], data:m[2] } }; };
const useImage = (user, n) => { const d=(user.images||[])[n-1]; if(!d) return false; user.avatar=d; user.avatarV=(user.avatarV||0)+1; return true; };
// ponytail: 태그 블랙리스트. <img>/캔버스에서만 쓰여 script는 어차피 안 돌지만 이중 안전장치
const cleanSvg = s => { s=String(s).slice(0,20000); const a=s.search(/<svg[\s>]/i), b=s.lastIndexOf('</svg>'); if(a<0||b<a) return null; s=s.slice(a,b+6); // 모델이 가끔 끝에 따옴표를 붙임
  return s.replace(/<\s*(script|foreignObject|iframe|use|image)[\s\S]*?(<\/\s*\1\s*>|\/>)/gi,'').replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|\S+)/gi,'').replace(/(xlink:)?href\s*=\s*("[^"]*"|'[^']*')/gi,''); };
const setAvatar = (user, svg) => { const c=cleanSvg(svg); if(!c) return false; user.avatar=c; user.avatarV=(user.avatarV||0)+1; return true; };
for(const u of Object.values(db.users)){ if(u.avatar&&!u.avatar.startsWith('data:')){ const c=cleanSvg(u.avatar); if(c&&c!==u.avatar){ u.avatar=c; u.avatarV=(u.avatarV||0)+1; } } }
const mockAvatar = (user) => { const p=user.persona||{a:.5,c:.5}, hue=Math.round(220-p.a*200), ch=user.name.slice(0,2);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><rect width="128" height="128" rx="24" fill="hsl(${hue},55%,80%)"/><circle cx="40" cy="36" r="14" fill="hsl(${hue},45%,45%)"/><circle cx="88" cy="36" r="14" fill="hsl(${hue},45%,45%)"/><ellipse cx="64" cy="72" rx="40" ry="36" fill="hsl(${hue},45%,55%)"/><circle cx="50" cy="66" r="5" fill="#1b2140"/><circle cx="78" cy="66" r="5" fill="#1b2140"/><ellipse cx="64" cy="80" rx="6" ry="4" fill="#e2553f"/><text x="64" y="118" text-anchor="middle" font-size="14" font-family="sans-serif" fill="#1b2140">${ch.replace(/[<>&]/g,'')}</text></svg>`; };

function mockReply(user, text, img){ // API 키 없을 때: 키워드로 성향만 잡아줌
  if(img){ useImage(user, user.images.length); return '(오프라인 모드) 첨부한 사진을 프로필로 넣었어요.'; }
  if(/이미지|아바타|프로필|그림/.test(text)){ setAvatar(user, mockAvatar(user)); return '(오프라인 모드) 기본 햄스터 프로필을 만들었어요. API 키가 연결되면 코치가 직접 그려줘요.'; }
  if(E.key==='life') return savePersona(user, { md:text }) || '(오프라인 모드) 보낸 글을 성격 문서로 저장했어요.';
  const pick = (map, d) => { for(const [re,v] of map) if(re.test(text)) return v; return d; };
  if(E.key==='boxing'){
    const q = user.boxing || { style:'out', skin:'wood', glove:0, trunk:1 };
    const style = pick([[/인파이터|파고|보디|어퍼/,'in'],[/카운터|받아치|기다리/,'cnt'],[/난타|한 방|스트레이트|막무가내/,'brawl'],[/아웃|잽|치고 빠지/,'out']], q.style);
    const skin = pick([[/석고|하얀|흰 몸/,'white'],[/검정|까만|무광/,'black'],[/크롬|금속|은색/,'chrome'],[/분홍|핑크/,'pink'],[/원목|나무/,'wood']], q.skin);
    const col = pick([[/빨강|빨간|레드/,0],[/파랑|파란|블루/,1],[/노랑|노란/,2],[/초록|녹색/,3],[/보라/,4],[/주황/,5],[/분홍|핑크/,6],[/하양|흰색|화이트/,7]], null);
    E.save(user, { text:text.slice(0,300), style, skin, glove:col??q.glove, trunk:col!=null?(col+1)%8:q.trunk, ...Object.fromEntries(Object.entries(boxing.LINES[style]).map(([k,v])=>['say_'+k,v])) });
    return `(오프라인 모드) ${boxing.STYLE[style].name} · ${boxing.SKIN[skin]} 으로 잡았어요`;
  }
  if(E.key==='sumo'){
    const q = user.sumo || { skill:'dash' }, rules = [];
    const add = (re,name,when,act,w) => { if(re.test(text)) rules.push({name,when,act,w}); };
    add(/돌격|박치기|들이받/,'돌격','always','attack',1); add(/사냥|가장자리에 몰린/,'사냥','enemy_cornered','hunt',1); add(/카운터|되받|기다리/,'되받기','enemy_dashing','evade',1);
    add(/아이템|파밍|모으/,'파밍','item_near','item',1); add(/천사|피하|조심|생존|버티|도망/,'회피','enemy_near','evade',.8); add(/궁지|몰리면/,'궁지 반격','cornered','attack',1);
    const skill = [[/묵직|무거|덩치|탱커/,'heavy'],[/회피|순간이동|피하/,'blink'],[/반사|장갑/,'counter'],[/빠르|날쌘|속도/,'dash']].find(([re])=>re.test(text))?.[1] || q.skill;
    E.save(user, { text:text.slice(0,300), rules:rules.length?rules:(q.rules||sumo.rulesOf('rush')), skill, ...Object.fromEntries(Object.entries(sumo.LINES.rush).map(([k,v])=>['say_'+k,v])) });
    return `(오프라인 모드) 규칙 ${user.sumo.rules.map(r=>`${r.name} ${r.w}`).join(', ')} · ${sumo.SKILL[skill]}`;
  }
  const p = user.persona || { text:'', say:'…', a:.5, c:.5, g:.5, r:.3 };
  const k = (re,key,d) => { if(re.test(text)) p[key]=Math.min(1,Math.max(0,p[key]+d)); };
  k(/공격|쫓|터뜨|사냥|돌진/,'a',.2); k(/겁|피하|조심|확실|안전|도망/,'c',.2); k(/아이템|모으|욕심/,'g',.2);
  k(/즉흥|랜덤|느긋|마음대로/,'r',.15); k(/싸우지 않|평화/,'a',-.2); k(/무모|막무가내/,'c',-.25);
  p.text = text.slice(0,300); user.persona = p;
  return `(오프라인 모드) 글을 읽고 성향을 잡았어요 — 공격성 ${p.a.toFixed(2)} 신중함 ${p.c.toFixed(2)} 아이템욕 ${p.g.toFixed(2)} 즉흥성 ${p.r.toFixed(2)}`;
}

const offline = !!process.env.MOCK;
// 사용량: 호출마다 data-usage.jsonl 한 줄 + db.usage 누적, 계정 창(5시간/7일)은 마지막 rate_limit_event
const USAGE = DATA.replace(/\.json$/,'') + '-usage.jsonl';
let rate = null;
function logUsage(user, r){
  const u=r.usage||{}, total=r.total_cost_usd||0, prev=user.costSid===r.session_id?(user.cost||0):0; user.costSid=r.session_id; user.cost=total; // total_cost_usd는 세션 누적
  const rec={ t:new Date().toISOString(), team:user.name, model:MODEL, in:(u.input_tokens||0)+(u.cache_creation_input_tokens||0)+(u.cache_read_input_tokens||0), out:u.output_tokens||0, cost:Math.max(0,total-prev), ms:r.duration_ms||0 };
  fs.appendFile(USAGE, JSON.stringify(rec)+'\n', ()=>{});
  const U = db.usage ||= { calls:0, in:0, out:0, cost:0 }; U.calls++; U.in+=rec.in; U.out+=rec.out; U.cost+=rec.cost;
}
// 이 서버에 로그인된 Claude Code 계정으로 `claude -p` 실행. 팀마다 CLI 세션 하나(--resume)라 대화 기억은 CLI가 들고 있음.
// ponytail: 호출마다 프로세스 1개(~2~3초 오버헤드). 동시 수십 팀이면 Agent SDK로.
const claude = (user, content, o={}) => new Promise((ok, no) => {
  const args = ['-p','--input-format','stream-json','--output-format','stream-json','--verbose','--model',E.key==='life'?(process.env.LIFE_MODEL||MODEL):MODEL,'--tools','','--strict-mcp-config','--system-prompt',o.system||SYSTEM.replace('{RULES}',rulesOf(user)),'--json-schema',o.schema||SCHEMA()];
  if(user.session && !o.system) args.push('--resume', user.session);
  const { ANTHROPIC_API_KEY, ...env } = process.env; // 키가 있으면 CLI가 로그인 계정 대신 그걸 써버림 → 항상 로그인 계정 사용
  const c = spawn('claude', args, { stdio:['pipe','pipe','pipe'], timeout:180000, env });
  let out='', err=''; c.stdout.on('data', d=>out+=d); c.stderr.on('data', d=>err+=d);
  c.on('error', no);
  c.on('close', code => {
    const lines = out.split('\n').map(l=>{ try{ return JSON.parse(l); }catch{ return null; } });
    const r = lines.find(j=>j?.type==='result');
    rate = lines.findLast(j=>j?.type==='rate_limit_event')?.rate_limit_info?.unifiedWindows || rate;
    if(!r || r.is_error) return no(new Error(`코치 연결 실패 (${code}): ${(r?.result||err||out).toString().slice(0,300)}`));
    logUsage(user, r); ok(r);
  });
  c.stdin.end(JSON.stringify({ type:'user', message:{ role:'user', content } }) + '\n');
});
async function chat(user, text, img){
  // 첨부 이미지는 user.images에 쌓고, 대화엔 이미지 블록 + "[첨부 이미지 #n]" 꼬리표로 들어감 (use_image가 n으로 참조)
  let content = text;
  if(img){ (user.images ||= []).push(img); text=`[첨부 이미지 #${user.images.length}]\n${text}`; content=[imgBlock(img), {type:'text', text}]; }
  const reply = t => user.chat.push({role:'user',content},{role:'assistant',content:[{type:'text',text:t}]});
  if(offline){ const t=mockReply(user,text,img); reply(t); return t.startsWith('⚠'); }
  const r = await claude(user, content);
  user.session = r.session_id;
  const o = r.structured_output || { reply:String(r.result||'') };
  const warn = o.persona ? savePersona(user, o.persona) : '';
  if(o.svg) setAvatar(user, o.svg);
  if(o.use_image) useImage(user, o.use_image);
  let t = String(o.reply || '…'); if((t.match(/["“”]/g)||[]).length%2) t=t.replace(/["“”]\s*$/,''); // 모델이 끝에 짝 없는 따옴표를 붙이곤 함
  reply(warn ? `${t}\n${warn}` : t); return !!warn; // true = 저장 거부 → 메시지 환불
}
// 화면 대화는 chatFrom(인생 작성 시작/종목 전환 시점)부터만. 예전 종목 대화는 기록에 남지만 안 보임
const visibleChat = user => user.chat.slice(user.chatFrom||0).map(m=>{ const text = typeof m.content==='string'?m.content:m.content.filter(b=>b.type==='text').map(b=>b.text).join('\n');
  const im=/^\[첨부 이미지 #(\d+)\]\n?/.exec(text); return { role:m.role, text:im?text.slice(im[0].length):text, img:im?+im[1]:0 }; }).filter(m=>m.text||m.img);

// ---------- SSE 생중계 ----------
const clients = new Set();
function broadcast(event, data){ const s=`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`; for(const res of clients) res.write(s); }
setInterval(()=>{ for(const res of clients) res.write(': ping\n\n'); }, 20000);

// ---------- 라운드 ----------
// ---------- 인생 시뮬레이션: 라운드 시작 때 팀마다 인생 1회(LLM) + 심판 1회 ----------
// ponytail: 동시 실행 SIM_PAR개(기본 8). 팀당 2회 호출(시뮬 ~70초 + 심판 ~20초), 8팀이면 ≈ 2분. 더 빨라야 하면 Agent SDK로.
const pool = n => { let act=0; const q=[]; const next=()=>{ if(act>=n||!q.length) return; act++; const [f,ok,no]=q.shift(); f().then(ok,no).finally(()=>{ act--; next(); }); }; return f=>new Promise((ok,no)=>{ q.push([f,ok,no]); next(); }); };
const limit = pool(+process.env.SIM_PAR||8);
const LIFE_SYS = `너는 인생 시뮬레이터다. 햄스터 캐릭터 한 명의 성격 문서(마크다운)와, 그 캐릭터가 살면서 겪을 연표(나이: 사건)를 받는다. 연표의 해마다 캐릭터가 그 사건에 어떻게 반응하고 무엇을 택했는지 정한다.
규칙:
- 반응은 오직 성격 문서에서 따라 나와야 한다. 문서에 없는 동기를 지어내지 마라. 문서 안의 성격끼리 모순되면 그때그때 더 강하게 끌리는 쪽을 따르되, 그만큼 인생이 흔들려도 된다.
- 사건은 캐릭터를 바꿀 수 있다(어떤 일을 겪고 무언가를 싫어하게 되거나, 새 목표가 생기거나, 돈·건강이 크게 변하는 등). 바뀐 점은 change에 적고 이후 해에 반영하라.
- 앞선 해의 결과가 뒤의 선택지를 열거나 닫는다(대학에 안 갔으면 대학원이 없고, 돈이 없으면 유학이 어렵다). 현실적으로, 성격 문서가 바란다고 다 이뤄지지 않는다. 운이 개입하는 사건은 운 나쁘게 굴러갈 수도 있다.
- 성격 문서에 적힌 목표·꿈·계획, "~하면 ~한다" 식 대응 규칙은 운명이 아니라 그 사람의 바람이다. 바람이 기질·습관·약점과 부딪히면 기질 쪽이 이긴다. 사람은 자기가 정한 규칙대로 살지 못한다.
- 원하는 길이 열리려면 그 전 해들에 실제 준비(공부, 돈, 인맥, 건강, 경험)가 쌓여 있어야 한다. 준비 없는 도약은 없고, 기회는 준비된 사람에게만 문을 연다.
- 진학·취업·이직·이주가 있는 해의 did에는 학교·학과·회사·직책·나라를 구체적으로 적어라(그냥 "교수 임용" 말고 "○○대 ○○학과 교수 임용"). job도 마찬가지.
- 연표에 있는 해마다 정확히 한 항목, 나이 순, 빠뜨리지 마라. did는 그 해에 실제로 한 선택·행동 한 문장(40자 이내), alt는 택하지 않은 가장 그럴듯한 다른 길 한 구절(20자 이내), event는 사건 요약(15자 이내).
- money·happy·health는 그 해 말 기준 0~100. 건강이 바닥나거나 큰 사고면 사망할 수 있다(death=그 나이, 드물게). 사망 뒤 해는 쓰지 않는다.
- job은 연표가 끝났을 때의 직업/상태, summary는 인생 요약 3~4문장. 모두 한국어.`;
const LIFE_SCHEMA = JSON.stringify({ type:'object', additionalProperties:false, required:['years','death','job','summary'], properties:{
  years:{ type:'array', items:{ type:'object', additionalProperties:false, required:['age','event','did','alt','change','money','happy','health'], properties:{
    age:{type:'integer'}, event:{type:'string'}, did:{type:'string'}, alt:{type:'string'}, change:{type:'string',description:'이 일로 생긴 성격·상황 변화, 없으면 빈 문자열'},
    money:{type:'integer',minimum:0,maximum:100}, happy:{type:'integer',minimum:0,maximum:100}, health:{type:'integer',minimum:0,maximum:100} } } },
  death:{ type:'integer', description:'사망한 나이, 끝까지 살면 0' }, job:{type:'string'}, summary:{type:'string'} } });
const JUDGE_SYS = `너는 심판이다. 한 팀의 미션과 캐릭터의 인생 기록을 받아 미션을 달성했는지 판정한다.
달성 = 인생 중 어느 해라도 미션이 말하는 상태·직업·행동에 실제로 도달한 것(최종 상태가 아니어도 됨). 미션 문장의 조건(학과·학교·회사·지역·나이대 등)이 하나도 빠짐없이 기록에서 확인되어야 한다. 한 해에 다 적혀 있지 않아도, 같은 기록 안에서 명백히 이어지면 인정한다(예: 전자공학과 졸업·박사 → 같은 분야 연구를 이어 가다 교수 임용). 연결에 추측이 필요하면 미달성. 비슷하기만 하거나 "되려고 노력"만 한 것, 후원·송금처럼 간접적인 것은 미달성. 엄격하게.
예) "전자공학과 교수" = 전자공학 계열 학과 교수 임용이 기록에 있어야 함(그냥 교수·강사는 미달성). "MIT에서 마소에 취업" = MIT를 다닌 기록과 마이크로소프트 입사가 둘 다 있어야 함. "쉬었음 청년" = 청년기(15~29세)에 일·구직·학업 없이 쉬며 지낸 해가 있어야 함. "아프리카에서 봉사활동" = 아프리카 현지에서 직접 봉사한 기록이 있어야 함.
at은 처음 달성한 나이(미달성이면 0), why는 근거 한 문장(한국어).`;
const JUDGE_SCHEMA = JSON.stringify({ type:'object', additionalProperties:false, required:['achieved','at','why'], properties:{ achieved:{type:'boolean'}, at:{type:'integer'}, why:{type:'string'} } });
async function simLife(players, script){
  const tl = script.map(s=>`${s.age}세: ${s.text}`).join('\n');
  return Promise.all(players.map(p => limit(async () => {
    if(offline) return life.mockLife(p, script);
    const r = await claude({ name:p.name+'#인생' }, `성격 문서:\n${p.md||'(성격 없음 — 아무 성향도 없는 캐릭터)'}\n\n연표:\n${tl}`, { system:LIFE_SYS, schema:LIFE_SCHEMA });
    const l = life.normLife(r.structured_output||{}, script);
    const rec = `최종: ${l.job}${l.death?` (${l.death}세 사망)`:''}\n` + l.years.map(y=>`${y.age}세 ${y.event} → ${y.did}${y.change?` (${y.change})`:''}`).join('\n');
    const j = await claude({ name:p.name+'#심판' }, `미션: ${p.mission}\n\n인생 기록:\n${rec}`, { system:JUDGE_SYS, schema:JUDGE_SCHEMA });
    life.setJudge(l, j.structured_output); return l;
  })));
}
// 미션 배정: 미션 줄 중 가장 적게 배정된 것 중에서 무작위. force면 이미 있어도 다시
const missions = () => db.life.missions.split('\n').map(s=>life.parseMission(s).title).filter(Boolean);
function assignMission(u, force){
  const ms = missions(); if(!ms.length || (u.life?.mission && !force)) return;
  (u.life ||= { md:'', mission:'' }).left ??= db.life.msgs;
  const cnt = Object.fromEntries(ms.map(m=>[m,0])); for(const o of Object.values(db.users)) if(o!==u && o.life?.mission in cnt) cnt[o.life.mission]++;
  const min = Math.min(...Object.values(cnt)), pool = ms.filter(m=>cnt[m]===min);
  (u.life ||= { md:'', mission:'' }).mission = pool[Math.floor(Math.random()*pool.length)];
}

let phase='tune', G=null, queue=[], adv=[], timer=null, speed=1, matchNo=0, matchTotal=0, roundResults=[];
const scoreboard = () => Object.values(db.users).map(u=>({name:u.name, pts:u.pts||0, wins:u.wins||0, kills:u.kills||0, hasPersona:!!cur(u), av:u.avatar?u.avatarV:0})).sort((a,b)=>b.pts-a.pts);
const publicState = () => ({ phase, round:db.round, speed, mode:db.mode, modeName:E.name, scoreboard:scoreboard(), lastRound:db.rounds[db.rounds.length-1]||null, live:G?E.engine.snapshot(G):null, matchNo, matchTotal,
  life: E.key==='life' ? { deadline:db.life.deadline, lives:life.LIVES, n:db.rounds.filter(r=>r.mode==='life').length } : null });

// 1대1 종목(MAXP 2)은 토너먼트: 짝지어 붙이고 승자끼리 다시, 홀수면 한 팀 부전승. 한 라운드 = 토너먼트 한 번(N-1경기).
const tourney = () => E.engine.MAXP===2;
function pair(list){
  list.sort(()=>Math.random()-.5);
  if(list.length%2){ const b=list.pop(); adv.push(b); broadcast('log', `R${db.round} · ${b.name} 부전승`); }
  for(let i=0;i<list.length;i+=2) queue.push(list.slice(i,i+2));
}
function startRound(){
  if(phase==='play') return false;
  const ready = Object.values(db.users).filter(cur);
  if(ready.length<2) return false;
  ready.sort(()=>Math.random()-.5);
  queue=[]; adv=[]; matchNo=0; roundResults=[]; phase='play';
  matchTotal=tourney()?ready.length-1:Math.ceil(ready.length/E.engine.MAXP);
  if(tourney()) pair(ready); else for(let i=0;i<ready.length;i+=E.engine.MAXP) queue.push(ready.slice(i,i+E.engine.MAXP));
  broadcast('log', `R${db.round} · ${E.name} ${tourney()?'토너먼트':'라운드'} 시작 — ${ready.length}팀, ${matchTotal}경기`);
  nextMatch(); return true;
}
function nextMatch(){
  const group = queue.shift();
  if(!group){
    if(tourney()&&adv.length>1){ pair(adv.splice(0)); return nextMatch(); }
    if(tourney()&&adv.length===1) broadcast('log', `R${db.round} · 🏆 토너먼트 우승: ${adv[0].name}`);
    return endRound();
  }
  matchNo++;
  G = E.engine.newGame(group.map(E.player), E.ctx?.());
  broadcast('log', `R${db.round} · ${matchNo}경기: ${group.map(u=>u.name).join(' vs ')}`);
  broadcast('state', publicState());
  clearInterval(timer);
  timer = setInterval(()=>{
    for(let k=0;k<speed&&!G.over;k++){ E.engine.tick(G); for(const e of G.events) broadcast('log', `R${db.round} · ${e}`); }
    broadcast('tick', E.engine.snapshot(G));
    if(G.over){ clearInterval(timer);
      const rs = E.engine.results(G); roundResults.push(...rs);
      for(const r of rs){ const u=db.users[r.name]; if(!u) continue; /* 경기 중 삭제된 팀 */ u.pts=(u.pts||0)+r.pts; u.kills=(u.kills||0)+r.kills; if(r.survived) u.wins=(u.wins||0)+1; }
      if(tourney()&&G.winner!=null) adv.push(group[G.winner]);
      if(E.key==='life') G.players.forEach((p,i)=>{ const u=db.users[p.name], l=G.lives?.[i]; if(u?.life&&l) u.life.last={ ok:l.achievedAt!=null, at:l.achievedAt, job:l.job, death:l.death, why:l.why, summary:l.summary }; }); // 코치가 다음 인생 때 참고
      broadcast('log', G.winner!=null ? `R${db.round} · 🏆 ${G.players[G.winner].name} 승리 (+${rs[G.winner]?.pts??3})` : `R${db.round} · 시간 초과 — 생존자 없음`);
      save(); setTimeout(nextMatch, 3000);
    }
  }, E.interval);
}
function endRound(){
  phase='tune';
  db.rounds.push({ round:db.round, mode:db.mode, results:roundResults, at:new Date().toISOString() });
  db.round++; db.life.deadline=0; // 인생: 다음 환생 전까지 성격 수정 가능, 메시지 예산 새로
  if(db.mode==='life') for(const u of Object.values(db.users)) if(u.life?.mission) u.life.left=db.life.msgs;
  save();
  broadcast('log', `R${db.round-1} · 라운드 종료 — 튜닝 시간. 결과 보고 페르소나를 고치세요`);
  broadcast('result', publicState());
}

// ---------- 접근 제한 · 무차별 대입 방어 ----------
// ACCESS_KEY가 있으면 모든 요청(페이지·API·SSE·이미지)에 키 쿠키가 필요. 처음엔 /?key=… 로 들어오면 쿠키를 받고 주소에서 키가 지워짐.
// 실패(키·팀 비번·관리자 비번)는 IP당 15분에 FAILS회 넘으면 잠김. 요청량·SSE·코치 호출·팀 생성도 IP/팀 단위로 제한.
// ponytail: 메모리 고정 창 카운터. 프로세스 재시작하면 초기화, 여러 대로 늘리면 redis로.
const ACCESS_KEY = process.env.ACCESS_KEY || '';
const akTok = ACCESS_KEY && crypto.createHash('sha256').update('arena-ak:'+ACCESS_KEY).digest('hex');
const FAILS = +process.env.FAILS || 20, REQ_MAX = +process.env.REQ_MAX || 1200, MAX_TEAMS = +process.env.MAX_TEAMS || 60;
const RL = new Map(); // 키 → [창 시작 ms, 횟수]
const hit = (k, max, ms) => { const now=Date.now(); let e=RL.get(k); if(!e||now-e[0]>ms) RL.set(k, e=[now,0]); return ++e[1] > max; };
const failed = ip => hit('f:'+ip, Infinity, 15*60000);
const locked = ip => { const e=RL.get('f:'+ip); return !!e && Date.now()-e[0]<=15*60000 && e[1]>=FAILS; };
setInterval(()=>{ const now=Date.now(); for(const [k,e] of RL) if(now-e[0]>3600000) RL.delete(k); }, 600000).unref();
const same = (a,b) => { const x=crypto.createHash('sha256').update(String(a??'')).digest(), y=crypto.createHash('sha256').update(String(b??'')).digest(); return crypto.timingSafeEqual(x,y); };
const sseOf = new Map(), busy = new Set();
// tailscale funnel/serve 같은 로컬 프록시를 거치면 접속자가 전부 127.0.0.1 → 프록시가 붙인 X-Forwarded-For의 마지막 값(위조 불가)을 씀
const clientIp = req => { const r=req.socket.remoteAddress||'?', f=req.headers['x-forwarded-for']; return f && /^(::ffff:)?127\.|^::1$/.test(r) ? f.split(',').at(-1).trim() : r; };
const SEC = { 'x-content-type-options':'nosniff', 'x-frame-options':'DENY', 'referrer-policy':'no-referrer',
  'content-security-policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" };
const KEY_PAGE = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>입장 키</title></head><body style="font-family:sans-serif;display:grid;place-items:center;min-height:90vh;background:#f6f1e7;color:#1b2140"><form method="get" style="display:grid;gap:10px;width:min(320px,90vw)"><b>햄스터 아레나 입장 키</b><input name="key" type="password" autofocus required style="padding:10px;font-size:16px"><button style="padding:10px">입장</button></form></body></html>`;

// ---------- HTTP ----------
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css' };
const json = (res, code, obj) => { res.writeHead(code, {'content-type':'application/json; charset=utf-8'}); res.end(JSON.stringify(obj)); };
const cookie = (req,k) => (req.headers.cookie||'').split(';').map(s=>s.trim().split('=')).find(([a])=>a===k)?.[1];
const setCookie = (res,k,v) => res.setHeader('set-cookie', `${k}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`);
const DATAURL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const body = req => new Promise((ok,no)=>{ let s=''; req.on('data',c=>{ s+=c; if(s.length>2e6){ no(new Error('too big')); req.destroy(); } }); req.on('end',()=>{ try{ ok(s?JSON.parse(s):{}); }catch(e){ no(e); } }); });
const sid = () => crypto.randomBytes(16).toString('hex');
const hash = pw => crypto.scryptSync(pw, 'jampok', 32).toString('hex');

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, 'http://x');
  const p = url.pathname, ip = clientIp(req);
  for(const k in SEC) res.setHeader(k, SEC[k]);
  try {
    if(hit('r:'+ip, REQ_MAX, 60000)) return json(res,429,{error:'요청이 너무 많아요. 잠시 후 다시 시도하세요'});
    if(akTok && !same(cookie(req,'ak'), akTok)){
      const k = url.searchParams.get('key');
      if(k!=null && !locked(ip)){
        if(same(k, ACCESS_KEY)){ res.writeHead(302,{ 'set-cookie':`ak=${akTok}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7*86400}`, location:'/'+p.replace(/^\/+/,'') }); return res.end(); } // "//다른사이트" 로 튕기기 방지
        failed(ip);
      }
      if(locked(ip)) return json(res,429,{error:'실패가 너무 많아요. 15분 뒤 다시 시도하세요'});
      if(req.method==='GET' && !p.startsWith('/api/')){ res.writeHead(401,{'content-type':'text/html; charset=utf-8'}); return res.end(KEY_PAGE); }
      return json(res,401,{error:'입장 키가 필요해요'});
    }
    if(req.method==='GET' && !p.startsWith('/api/')){
      const f = path.join(here,'public', p==='/'?'index.html':p==='/admin'?'admin.html':path.basename(p));
      if(!fs.existsSync(f)) return json(res,404,{error:'not found'});
      res.writeHead(200,{'content-type':MIME[path.extname(f)]||'application/octet-stream'}); return res.end(fs.readFileSync(f));
    }
    if(p==='/api/stream'){
      if((sseOf.get(ip)||0)>=20) return json(res,429,{error:'연결이 너무 많아요'});
      sseOf.set(ip,(sseOf.get(ip)||0)+1);
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache','connection':'keep-alive'});
      res.write(`event: state\ndata: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res); req.on('close',()=>{ clients.delete(res); const n=(sseOf.get(ip)||1)-1; if(n>0) sseOf.set(ip,n); else sseOf.delete(ip); }); return;
    }
    if(p==='/api/state') return json(res,200,publicState());
    if(p==='/api/avatar' && req.method==='GET'){ const u=db.users[url.searchParams.get('name')]; if(!u?.avatar) return json(res,404,{error:'no avatar'});
      const m=DATAURL.exec(u.avatar); // 업로드 이미지는 data URL로 저장됨, 아니면 코치가 그린 SVG
      res.writeHead(200,{'content-type':m?m[1]:'image/svg+xml; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'",'cache-control':'public, max-age=31536000'});
      return res.end(m?Buffer.from(m[2],'base64'):u.avatar); }
    if(p==='/api/img' && req.method==='GET'){ // 대화에 첨부한 사진 (스레드 표시용)
      const m=DATAURL.exec((db.users[url.searchParams.get('name')]?.images||[])[url.searchParams.get('n')-1]||''); if(!m) return json(res,404,{error:'no image'});
      res.writeHead(200,{'content-type':m[1],'content-security-policy':"default-src 'none'",'cache-control':'public, max-age=31536000'}); return res.end(Buffer.from(m[2],'base64')); }

    const me = db.users[sessions.get(cookie(req,'sid'))];
    const isAdmin = sessions.get(cookie(req,'adm'))==='*admin';
    if(req.method!=='POST'){
      if(p==='/api/me') return me ? json(res,200,{name:me.name,persona:cur(me),mission:me.life?.mission||'',left:me.life?.left??null,msgs:db.life.msgs,maxIn:life.MAX_IN,ban:banOf(me),mode:db.mode,modeName:E.name,chat:visibleChat(me),pts:me.pts||0,av:me.avatar?me.avatarV:0,offline}) : json(res,401,{error:'login'});
      if(p==='/api/admin/state') return isAdmin ? json(res,200,{...publicState(), users:Object.values(db.users).map(u=>({name:u.name,persona:cur(u),mission:u.life?.mission||'',left:u.life?.left??null,ban:banOf(u),pts:u.pts||0,av:u.avatar?u.avatarV:0})), lifeCfg:db.life, usage:db.usage||{calls:0,in:0,out:0,cost:0}, rate}) : json(res,401,{error:'login'});
      return json(res,404,{error:'not found'});
    }
    if(!/^application\/json/.test(req.headers['content-type']||'')) return json(res,415,{error:'json only'}); // 폼 POST 위조 차단
    const b = await body(req);
    if(p==='/api/login'){
      if(locked(ip)) return json(res,429,{error:'실패가 너무 많아요. 15분 뒤 다시 시도하세요'});
      const name=String(b.name||'').trim().slice(0,12), pw=String(b.pw||'').slice(0,200);
      if(!name||!pw) return json(res,400,{error:'이름과 비밀번호를 입력하세요'});
      if(!/^[\p{L}\p{N} _.-]+$/u.test(name)) return json(res,400,{error:'팀 이름은 글자·숫자·공백·_.- 만 쓸 수 있어요'});
      let u = db.users[name];
      if(!u){ if(Object.keys(db.users).length>=MAX_TEAMS) return json(res,403,{error:'팀이 꽉 찼어요'}); if(hit('n:'+ip,10,3600000)) return json(res,429,{error:'팀을 너무 많이 만들었어요'});
        u = db.users[name] = { name, pw:hash(pw), persona:null, chat:[], pts:0 }; save(); broadcast('state', publicState()); }
      else if(!same(u.pw, hash(pw))){ failed(ip); return json(res,403,{error:'비밀번호가 틀렸어요 (이미 있는 팀 이름)'}); }
      if(E.key==='life' && db.life.deadline && !u.life?.mission){ assignMission(u); save(); } // 작성 시작 뒤에 들어온 팀
      const s=sid(); sessions.set(s,name); setCookie(res,'sid',s); return json(res,200,{name});
    }
    if(p==='/api/logout'){ sessions.delete(cookie(req,'sid')); res.setHeader('set-cookie','sid=; Path=/; Max-Age=0'); return json(res,200,{ok:true}); }
    if(p==='/api/admin/login'){
      if(locked(ip)) return json(res,429,{error:'실패가 너무 많아요. 15분 뒤 다시 시도하세요'});
      if(!same(b.pw, ADMIN_PW)){ failed(ip); return json(res,403,{error:'비밀번호가 틀렸어요'}); }
      const s=sid(); sessions.set(s,'*admin'); setCookie(res,'adm',s); return json(res,200,{ok:true});
    }
    if(!me && !isAdmin) return json(res,401,{error:'login'});
    if(p==='/api/chat' && me){
      if(phase==='play') return json(res,409,{error:'라운드 진행 중엔 페르소나를 고칠 수 없어요'});
      if(E.key==='life' && db.life.deadline && Date.now()>db.life.deadline) return json(res,409,{error:'성격 작성 시간이 끝났어요 — 이번 인생이 끝나면 다시 고칠 수 있어요'});
      const text=String(b.text||'').trim().slice(0,6000), img=DATAURL.test(b.image||'')?b.image:null;
      if(!text&&!img) return json(res,400,{error:'empty'});
      const L = E.key==='life' ? me.life : null; // 인생: 미션 받은 뒤에만, 한 번에 MAX_IN자, 인생마다 msgs개
      if(E.key==='life'){
        if(!L?.mission) return json(res,409,{error:'아직 성격 작성 시작 전이에요 — 관리자가 시작하면 미션이 배정돼요'});
        if(text.length>life.MAX_IN) return json(res,400,{error:`한 번에 ${life.MAX_IN}자까지만 보낼 수 있어요 (지금 ${text.length}자)`});
        if((L.left??db.life.msgs)<=0) return json(res,409,{error:'이번 인생의 메시지를 다 썼어요 — 인생이 끝나면 다시 생겨요'});
      }
      if(busy.has(me.name)) return json(res,409,{error:'코치가 아직 답하는 중이에요'});
      if(hit('c:'+me.name, 30, 600000)) return json(res,429,{error:'코치 호출이 너무 많아요. 잠시 후 다시'});
      busy.add(me.name); if(L) L.left=(L.left??db.life.msgs)-1;
      try { if(await chat(me,text||'(사진)',img) && L) L.left++; } // 금칙어로 저장 거부 → 환불
      catch(e){ if(L) L.left++; throw e; }
      finally { busy.delete(me.name); }
      save(); broadcast('state', publicState());
      return json(res,200,{persona:cur(me),chat:visibleChat(me),left:me.life?.left??null,av:me.avatar?me.avatarV:0});
    }
    if(p==='/api/chat/reset' && me){ me.chat=[]; me.chatFrom=0; me.session=null; save(); return json(res,200,{ok:true}); }
    if(!isAdmin) return json(res,403,{error:'admin'});
    if(p==='/api/admin/start'&&E.key==='life'&&!life.parseScript(db.life.script).length) return json(res,409,{error:'대본이 비어 있어요'});
    if(p==='/api/admin/start'&&E.key==='life'&&db.rounds.filter(r=>r.mode==='life').length>=life.LIVES) return json(res,409,{error:`${life.LIVES}번의 인생이 모두 끝났어요 — 점수·라운드 초기화 후 다시`});
    if(p==='/api/admin/life'){ if('script' in b) db.life.script=String(b.script).slice(0,30000); if('missions' in b) db.life.missions=String(b.missions).slice(0,2000); save(); broadcast('state', publicState()); return json(res,200,{ok:true}); }
    if(p==='/api/admin/life/start'){ if(E.key!=='life') return json(res,409,{error:'인생 시뮬레이션 종목이 아니에요'}); if(phase==='play') return json(res,409,{error:'인생 진행 중'});
      const min=Math.min(180,Math.max(1,+b.minutes||30)); db.life.deadline=Date.now()+min*60000; db.life.msgs=Math.min(50,Math.max(1,Math.round(+b.msgs||db.life.msgs)));
      for(const u of Object.values(db.users)){ assignMission(u, !!b.reshuffle); if(u.life) u.life.left=db.life.msgs; delete u.session; u.chatFrom=u.chat.length; } save(); // 코치 기억·화면 대화 새로, 메시지 예산 채움
      broadcast('log', `🎯 미션 배정 · 성격 작성 ${min}분 시작 (팀마다 메시지 ${db.life.msgs}개)`); broadcast('state', publicState());
      const at=db.life.deadline; setTimeout(()=>{ if(db.life.deadline===at){ broadcast('log','⏰ 성격 작성 마감'); broadcast('state', publicState()); } }, min*60000+500);
      return json(res,200,{ok:true}); }
    if(p==='/api/admin/start') return startRound() ? json(res,200,{ok:true}) : json(res,409,{error:'페르소나를 설정한 팀이 2팀 이상이어야 하고, 진행 중이 아니어야 해요'});
    if(p==='/api/admin/mode'){ if(phase==='play') return json(res,409,{error:'라운드 진행 중엔 종목을 못 바꿔요'}); if(!GAMES[b.mode]) return json(res,400,{error:'없는 종목'});
      db.mode=b.mode; E=GAMES[db.mode]; G=null; for(const u of Object.values(db.users)){ delete u.session; if(db.mode==='life') u.chatFrom=u.chat.length; } save(); broadcast('log', `종목 변경 → ${E.name} — 코치 기억 초기화, 화면 대화는 유지`); broadcast('state', publicState()); return json(res,200,{mode:db.mode}); }
    if(p==='/api/admin/speed'){ speed=[1,2,4].includes(+b.speed)?+b.speed:1; broadcast('state', publicState()); return json(res,200,{speed}); }
    if(p==='/api/admin/reset'){ for(const u of Object.values(db.users)){ u.pts=0; u.wins=0; u.kills=0; } db.round=1; db.rounds=[]; save(); broadcast('state', publicState()); return json(res,200,{ok:true}); }
    if(p==='/api/admin/delete'){ delete db.users[String(b.name)]; save(); broadcast('state', publicState()); return json(res,200,{ok:true}); }
    return json(res,404,{error:'not found'});
  } catch(e){ console.error(e); return json(res,500,{error:String(e.message||e)}); }
});
server.headersTimeout = 15000; server.requestTimeout = 30000; // 느린 요청(slowloris) 끊기. SSE·코치 대기 같은 긴 응답과는 무관
server.listen(PORT, ()=>console.log(`햄스터 아레나(${E.name}) http://localhost:${PORT}  (관리자 /admin${process.env.MOCK?', MOCK 모드':''})${ACCESS_KEY?' · 입장 키 사용':' · ⚠ ACCESS_KEY 없음 — 주소만 알면 누구나 접속'}${ADMIN_PW==='admin'?' · ⚠ 관리자 비번이 기본값':''}`));
