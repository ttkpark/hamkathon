// 인생 시뮬레이션 엔진. 임원진이 쓴 연도별 사건 대본을 모든 팀의 캐릭터가 같이 겪는다(같은 세계, 다른 성격).
// 한 라운드 = 인생 한 번(환생). 성격→반응은 ctx.sim(LLM)이 라운드 시작 때 미리 계산하고, 그 결과를 DURATION초 동안 나이순으로 재생한다.
// game.js 인터페이스: newGame(players, ctx) / tick(1초) / snapshot / results / MAXP. players: [{name, md:성격 마크다운, mission}]
export const MAXP = Infinity, LIVES = 6, MAX_MD = 4000, DURATION = +process.env.LIFE_SEC || 600;
const EV_W = 6, YR_W = 1; // 사건 있는 해 : 평범한 해 재생 시간 비율

// 대본: "12: 역대급 한파가 찾아온다" 한 줄 = 한 해. 같은 나이가 여러 줄이면 이어 붙임. 번호 없는 줄은 무시. 마지막 나이 = 인생의 끝.
export function parseScript(text) {
  const m = new Map();
  for (const line of String(text || '').split('\n')) {
    const r = /^\s*(\d{1,3})\s*(?:세|살)?\s*[:.)\-]\s*(.+?)\s*$/.exec(line); if (!r || +r[1] > 120) continue;
    m.set(+r[1], (m.get(+r[1]) ? m.get(+r[1]) + ' ' : '') + r[2]);
  }
  return [...m].sort((a, b) => a[0] - b[0]).map(([age, text]) => ({ age, text }));
}
export const normMd = t => String(t || '').replace(/\r/g, '').trim().slice(0, MAX_MD);
const clamp = v => Math.max(0, Math.min(100, Math.round(+v || 0)));
// LLM 출력 정리: 대본 범위 안의 해만, 나이순, 사망 이후는 잘라냄
export function normLife(o, script) {
  const end = script.at(-1)?.age ?? 80, death = o.death > 0 && o.death <= end ? Math.round(o.death) : null;
  const years = (Array.isArray(o.years) ? o.years : []).map(y => ({ age: Math.round(+y.age || 0), event: String(y.event || '').slice(0, 40), did: String(y.did || '').slice(0, 90),
    alt: String(y.alt || '').slice(0, 50), change: String(y.change || '').slice(0, 50), money: clamp(y.money), happy: clamp(y.happy), health: clamp(y.health) }))
    .filter(y => y.age >= 0 && y.age <= end && (death == null || y.age <= death)).sort((a, b) => a.age - b.age);
  return { years, death, job: String(o.job || '').slice(0, 30), summary: String(o.summary || '').slice(0, 600), achievedAt: null, why: '' };
}
export const setJudge = (l, j) => { l.why = String(j?.why || '').slice(0, 120); if (j?.achieved) l.achievedAt = Math.max(0, Math.min(l.death ?? 999, Math.round(+j.at || 0))); };
// MOCK용: 성격 문장을 돌려가며 사건에 갖다 붙이고 스탯은 랜덤 워크, 달성은 주사위
export function mockLife(p, script) {
  let m = 50, h = 60, k = 70; const R = Math.random, t = p.md.split('\n').map(x => x.replace(/^[-*#\s]+/, '').trim()).filter(Boolean).slice(0, 12); if (!t.length) t.push('성격 없음');
  const years = script.map((s, i) => ({ age: s.age, event: s.text.slice(0, 40), did: `"${t[i % t.length]}" 성격대로 넘김`, alt: '반대로 해봄', change: R() < .3 ? '조금 달라짐' : '',
    money: m = clamp(m + (R() - .5) * 40), happy: h = clamp(h + (R() - .5) * 40), health: k = clamp(k - R() * 12) }));
  const l = normLife({ years, death: k < 15 ? years.at(-1).age : 0, job: '(오프라인) 평범한 햄스터', summary: '(오프라인 모드) 코치가 연결되면 진짜 인생이 나와요.' }, script);
  setJudge(l, { achieved: R() < .4, at: years[Math.floor(R() * years.length)]?.age ?? 0, why: '(오프라인) 주사위' }); return l;
}

export function newGame(players, ctx) {
  const script = ctx.script, end = script.at(-1)?.age ?? 80, ev = new Set(script.map(s => s.age));
  const sched = [0]; let acc = 0; for (let a = 0; a <= end; a++) { acc += ev.has(a) ? EV_W : YR_W; sched.push(acc); } // sched[a+1] = a세가 끝나는 시각(단위)
  const g = { kind: 'life', t: 0, age: 0, end, script, sched: sched.map(s => s * DURATION / acc), players, lives: null, ready: false, err: null, pend: [], events: [], fx: [], over: false, winner: null };
  Promise.resolve().then(() => ctx.sim(players, script)).then(l => { g.lives = l; g.ready = true; g.pend.push('🧬 인생 계산 끝 — 0세부터 재생'); announce(g, 0); }, e => { g.err = String(e.message || e); g.pend.push('❌ 인생 계산 실패: ' + g.err); g.over = true; });
  return g;
}
function announce(g, age) {
  const ev = g.script.find(s => s.age === age); if (ev) g.pend.push(`📅 ${age}세 · ${ev.text}`);
  g.lives.forEach((l, i) => { const n = g.players[i].name, y = l.years.find(y => y.age === age);
    if (y) g.pend.push(`  ${n}: ${y.did}${y.change ? ' → ' + y.change : ''}`);
    if (l.death === age) g.pend.push(`🕯 ${n} ${age}세에 사망`);
    if (l.achievedAt === age) { g.pend.push(`🏁 ${n} 미션 달성 (${age}세)`); g.fx.push({ k: 'pop', text: '미션 달성!', sub: n }); } });
}
// 한 틱 = 1초. 계산이 끝날 때까지 기다렸다가 나이를 올리고, 사건이 있는 해마다 로그를 남긴다.
export function tick(g) {
  g.events = g.pend; g.pend = []; g.fx = [];
  if (g.over || !g.ready) return;
  g.t += 1;
  while (g.age < g.end && g.t >= g.sched[g.age + 1]) { g.age++; announce(g, g.age); }
  g.events.push(...g.pend); g.pend = [];
  if (g.t < g.sched[g.end + 1]) return;
  g.over = true;
  const rs = results(g), best = Math.max(...rs.map(r => r.pts));
  g.winner = best > 0 ? rs.findIndex(r => r.pts === best) : null;
  g.events.push(`🧾 인생 종료 — 미션 달성 ${rs.filter(r => r.pts).map(r => r.name).join(', ') || '없음'}`);
}
// 현재 나이까지만 드러낸 스냅샷. 요약·판정 근거는 끝나야 보임
export const snapshot = g => ({ kind: 'life', t: g.t, age: g.age, end: g.end, ready: g.ready, err: g.err, over: g.over, winner: g.winner, fx: g.fx,
  players: g.players.map((p, i) => { const l = g.lives?.[i]; return { name: p.name, mission: p.mission, life: l && {
    years: l.years.filter(y => y.age <= g.age), death: l.death != null && l.death <= g.age ? l.death : null, achievedAt: l.achievedAt != null && l.achievedAt <= g.age ? l.achievedAt : null,
    job: g.over ? l.job : '', summary: g.over ? l.summary : '', why: g.over ? l.why : '' } }; }) });
// 결과: 미션 달성 +1. game.js 와 같은 모양이라 점수판 코드를 공유 (survived = 달성, wins = 달성한 인생 수)
export const results = g => g.players.map((p, i) => { const ok = g.lives?.[i]?.achievedAt != null; return { name: p.name, pts: ok ? 1 : 0, survived: ok, kills: 0, self: 0, deathT: g.lives?.[i]?.death || 0 }; });

// 기본 대본 (1~80세). 관리자 페이지에서 고칠 수 있다. 미션(쉬었음 청년·전자공학과 교수·아프리카 봉사·MIT→마소)이 갈릴 만한 사건을 섞어 둠.
export const DEFAULT_SCRIPT = `1: 태어났다. 부모는 작은 전파상을 하는 평범한 햄스터 부부
2: 말이 늦어 부모가 걱정한다. 대신 라디오 소리에 유난히 반응한다
3: 옆집 햄스터 형이 고장 난 장난감 로봇을 준다. 뜯어보거나 그냥 가지고 놀거나
4: 동네 유치원 입학. 친구 사귀기가 쉽지 않다
5: 부모 가게에 도둑이 들어 한동안 집안 분위기가 어둡다
6: 초등학교 입학. 담임이 "이 아이는 뭘 하든 끝까지 한다"고 메모한다
7: 처음으로 바다를 본다. 외국 여행객 햄스터가 영어로 말을 건다
8: 과학 경진대회 포스터가 붙는다. 나갈지 말지
9: 가장 친한 친구가 전학 간다
10: 아버지가 중고 컴퓨터를 사 온다. 게임 아니면 코딩
11: 학교에서 아프리카 우물 파기 모금 행사를 한다
12: 역대급 한파가 찾아온다. 난방이 끊겨 한 달을 떨며 지낸다
13: 중학교 입학. 수학 선생이 유독 엄하다
14: 반 친구들이 스마트폰 게임에 빠진다. 성적이 갈리기 시작
15: 첫 짝사랑. 상대는 유학 준비 중
16: 고등학교 입학. 과학고 진학이냐 일반고냐가 이미 갈렸다
17: 전국 전자회로 대회 공고. 팀을 꾸릴 수 있다
18: 부모 가게가 대형마트에 밀려 문을 닫는다. 집안 형편이 기운다
19: 수능. 결과는 노력과 운이 반반
20: 대학 혹은 재수 혹은 취업. 남자면 군 입대 문제도 겹친다
21: 교양 수업에서 아프리카 봉사 다녀온 선배의 발표를 듣는다
22: 하이닉스 주식이 폭등한다. 주변에서 다들 돈 얘기만 한다
23: 교수가 "대학원 올 생각 없나"라고 지나가듯 묻는다
24: 졸업반. 취업 시장이 최악이라는 뉴스가 연일 나온다
25: 첫 직장 혹은 첫 백수 생활. 친구들은 하나둘 자리를 잡는다
26: 해외 교환·인턴 공고. 영어 점수가 필요하다
27: 오래 사귄 연인이 결혼 얘기를 꺼낸다
28: 스타트업 붐. 아는 선배가 같이 창업하자고 한다
29: 몸이 자주 아프다. 병원에서 "쉬라"고 한다
30: 서른. 동창회에서 서로 명함을 비교한다
31: 대학원 혹은 유학 지원 마지막 적기라는 말을 듣는다
32: 경기 침체. 회사마다 구조조정 소문
33: 부모가 "너 요즘 뭐 하고 사니"라고 묻는다
34: 국제 봉사단에서 2년 파견 모집을 한다
35: 결혼 혹은 비혼. 주변 압박이 정점
36: 우연히 쓴 글·영상이 작게 화제가 된다
37: 집값이 급등한다. 전세냐 매매냐 포기냐
38: 아이가 생기거나, 조카가 집에 와 산다
39: 오랜 친구가 사기를 당해 돈을 빌려 달라고 한다
40: 마흔. 건강검진에서 경고가 나온다
41: 다니던 조직이 외국계에 합병된다. 영어 회의가 시작
42: 어머니가 쓰러진다. 간병 문제
43: 후배가 자신을 앞질러 승진한다
44: 해외 대학·연구소에서 짧은 방문 제안이 온다
45: AI 열풍. 지금 하는 일의 절반이 자동화된다는 보고서
46: 오래 미뤘던 취미에 다시 손댄다
47: 아프리카에서 봉사하던 지인이 돌아와 식당을 연다
48: 큰 실패 혹은 큰 성공이 찾아온다. 운이 절반
49: 자식 또는 제자가 진로 상담을 해 온다
50: 쉰. 동네에서 "선생님"이라고 부르는 사람이 생기기 시작
51: 허리 디스크. 오래 앉는 일이 힘들다
52: 전파상이 있던 자리에 건물이 들어선다. 추억이 사라짐
53: 고향 친구들이 귀농 모임을 만든다
54: 후원하던 단체에서 현지 방문을 요청한다
55: 명예퇴직 바람. 남을지 떠날지
56: 자서전을 써 보라는 제안
57: 손주가 태어나거나, 반려 햄스터를 들인다
58: 큰 병을 앓던 동료가 세상을 뜬다
59: 뒤늦게 공부를 다시 시작하는 또래가 많아진다
60: 환갑. 모두가 "이제 뭐 할 거냐"고 묻는다
61: 연금이 생각보다 적다는 걸 안다
62: 젊은이들이 자기 동네 역사를 기록해 달라고 찾아온다
63: 해외 장기 여행 혹은 봉사 기회가 마지막으로 온다
64: 기억력이 떨어진다. 메모 없이는 힘들다
65: 지역 대학에서 특강 요청이 온다
66: 오래된 집을 팔지 말지
67: 옛 연인을 우연히 마주친다
68: 큰 수술. 회복은 생활 습관에 달렸다
69: 자녀 혹은 제자가 큰 상을 받는다
70: 칠순. 가족 아니면 혼자
71: 걷기 모임에 들어가거나 집에 머문다
72: 평생 모은 책·부품을 누구에게 줄지
73: 전쟁 뉴스. 후원하던 지역이 위험해졌다
74: 손주가 "할아버지·할머니는 뭘 했어?"라고 묻는다
75: 지역 신문이 인생 인터뷰를 청한다
76: 폭염. 혼자 사는 노인이 많이 쓰러진다
77: 오래된 친구 대부분이 떠났다
78: 유언장을 쓴다
79: 마지막 여행 혹은 마지막 수업
80: 여든. 삶을 돌아본다`;
