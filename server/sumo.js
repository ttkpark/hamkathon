// 햄볼 대난투 엔진. 원형 판 위에서 공 속 햄스터가 서로 밀어내고, 떨어지면 목숨 -1, 마지막까지 남으면 승리.
// game.js(전파폭탄)와 같은 인터페이스: newGame / tick / snapshot / results / MAXP. 한 틱 = 0.05초(물리 3스텝).
export const AR = 280, MAXP = 8;
const AR_MIN = 80, SHRINK_AT = 15, SHRINK_V = 5, BR = 23, LIVES = 3, TIME_LIMIT = 120, DT = 1 / 60, STEPS = 3;
const ACC = 640, DRAG = 1.5, VMAX = 280, DASH = 620, DASH_CD = 2.2, DASH_T = .28;
const L = { noise: .12, edge: 1.15, react: .05, aim: .95 }; // ponytail: 명세의 "v24 · 아침 7시" 실력으로 고정. 밤샘 레벨업이 필요하면 플레이어별 L로.
export const SKILL = { dash: '날쌘 발', heavy: '묵직한 몸', blink: '순간 회피', counter: '반사 장갑' };
export const ITEM = { speed: '쳇바퀴', shield: '방패', wave: '전파 충격파' };

// 성격 = 규칙(스탯) 목록. 규칙 = {name, when, act, w}. 코치가 이름을 붙여 몇 개든 만들고, 가중치 합이 BUDGET을 넘으면 비례 축소(상호 보완).
export const WHEN = { always: '항상', cornered: '내가 가장자리에 몰림', enemy_near: '적이 가까움', enemy_dashing: '적이 대시해 옴', enemy_cornered: '적이 가장자리에 몰림',
  item_near: '아이템이 가까움', few_lives: '내 목숨이 1개', arena_small: '판이 작아짐', powered: '아이템 효과 중' };
export const ACT = { attack: '가까운 적 들이받기', hunt: '몰린 적 밀어내기', item: '아이템 줍기', center: '중앙으로', evade: '적 피하기', circle: '적 주변 맴돌기', hold: '제자리 버티기' };
export const BUDGET = 3;
// 명세의 4성격은 규칙 묶음(프리셋)으로 남김. 예전 저장분(persona:'rush' 등) 변환에도 사용.
export const PERSONA = { rush: '돌격형', hunter: '사냥꾼형', counter: '카운터형', survivor: '생존형' };
export const PRESET = {
  rush: [['돌격', 'always', 'attack', 1]],
  hunter: [['사냥', 'enemy_cornered', 'hunt', 1], ['자리잡기', 'always', 'circle', .5]],
  counter: [['되받기', 'enemy_dashing', 'evade', 1], ['반격', 'enemy_near', 'attack', .7], ['맴돌기', 'always', 'circle', .4]],
  survivor: [['파밍', 'item_near', 'item', 1], ['회피', 'enemy_near', 'evade', .8], ['중앙', 'always', 'center', .3]],
};
export const rulesOf = key => (PRESET[key] || PRESET.rush).map(([name, when, act, w]) => ({ name, when, act, w }));
// 규칙 정리: 모르는 조건/행동 제거, 가중치 0~1, 최대 8개, 합이 BUDGET 초과면 비례 축소
export function normRules(rules) {
  const out = (Array.isArray(rules) ? rules : []).filter(r => r && WHEN[r.when] && ACT[r.act]).slice(0, 8)
    .map(r => ({ name: String(r.name || ACT[r.act]).slice(0, 12), when: r.when, act: r.act, w: Math.min(1, Math.max(0, +r.w || 0)) }));
  const sum = out.reduce((a, r) => a + r.w, 0);
  if (sum > BUDGET) for (const r of out) r.w = +(r.w * BUDGET / sum).toFixed(2);
  return out.length ? out : rulesOf('rush');
}
export const LINES = {
  rush: { dash: '비켜!!', ko: '한 방이면 충분', win: '박치기가 답이다' },
  hunter: { dash: '몰렸네?', ko: '가장자리는 내 구역', win: '사냥 끝' },
  counter: { dash: '지금이다', ko: '제 발로 왔네', win: '기다리는 놈이 이긴다' },
  survivor: { dash: '저리 가!', ko: '어부지리 감사', win: '버티면 이긴다' },
};
const hyp = Math.hypot, R = Math.random;
const active = p => !p.out && p.fall <= 0 && p.respawn <= 0;
const say = (g, i, txt, t) => { g.bubbles = g.bubbles.filter(b => b.i !== i); if (txt) g.bubbles.push({ i, txt, t }); };

// players: [{name, rules:[{name,when,act,w}], skill, say:{dash,ko,win}}] (최대 MAXP). rules 없고 persona 키만 있으면 프리셋으로 변환.
export function newGame(players) {
  const n = players.length;
  players = players.map(p => ({ ...p, rules: normRules(p.rules || rulesOf(p.persona)), say: p.say || LINES.rush }));
  const bots = players.map((tm, i) => {
    const a = -Math.PI / 2 + i * Math.PI * 2 / n, heavy = tm.skill === 'heavy';
    return { i, x: Math.cos(a) * 160, y: Math.sin(a) * 160, vx: 0, vy: 0, r: heavy ? BR * 1.2 : BR, m: heavy ? 1.45 : 1,
      lives: LIVES, out: false, fall: 0, respawn: 0, inv: 1.5, dashCd: .5 + R(), dashT: 0, blinkCd: 0, counterCd: 0, boost: 0, shield: 0,
      last: null, kos: 0, self: 0, think: 0, ctl: { ax: 0, ay: 0, dash: false }, face: a + Math.PI, deathT: 0, lastSay: -9, rule: '' };
  });
  return { kind: 'sumo', t: 0, r: AR, bots, items: [], nextItem: 4, players, events: [], fx: [], bubbles: [], over: false, winner: null };
}

const aim = (tx, ty, dash) => { const a = Math.atan2(ty, tx) + (R() - .5) * L.noise; return { ax: Math.cos(a), ay: Math.sin(a), dash: dash && R() < L.aim + .05 }; };
function decide(g, p) {
  const P = g.players[p.i], d0 = hyp(p.x, p.y), gap = g.r - d0, dist = o => hyp(o.x - p.x, o.y - p.y);
  const others = g.bots.filter(o => o !== p && active(o));
  const speedOut = (p.x * p.vx + p.y * p.vy) / (d0 || 1);
  if (gap < L.edge * (55 + Math.max(0, speedOut) * .35)) return aim(-p.x, -p.y, false); // 가장자리 감각(규칙과 무관한 생존 본능)
  const near = others.slice().sort((a, b) => dist(a) - dist(b)), o = near[0];
  const threat = others.find(q => q.dashT > 0 && dist(q) < 150 && ((p.x - q.x) * q.vx + (p.y - q.y) * q.vy) / (dist(q) * (hyp(q.vx, q.vy) || 1)) > .85);
  if (threat && P.skill === 'blink' && p.blinkCd <= 0 && R() < L.aim) return { blink: threat };
  const it = g.items.slice().sort((a, b) => dist(a) - dist(b))[0];
  const ec = others.filter(q => hyp(q.x, q.y) > g.r * .6).sort((a, b) => hyp(b.x, b.y) - hyp(a.x, a.y))[0];
  const cond = { always: true, cornered: gap < 90, enemy_near: !!o && dist(o) < 120, enemy_dashing: !!threat, enemy_cornered: !!ec,
    item_near: !!it && dist(it) < 150 && (!o || dist(it) < dist(o) * 1.2), few_lives: p.lives <= 1, arena_small: g.r < 170, powered: p.boost > 0 || p.shield > 0 };
  let best = null;
  for (const r of P.rules) if (cond[r.when]) { const s = r.w * (.85 + .3 * R()); if (!best || s > best.s) best = { r, s }; }
  const act = best ? best.r.act : 'center'; p.rule = best ? best.r.name : '';
  const ready = p.dashCd <= 0;
  const aimed = (q, k = .9) => { const dx = q.x - p.x, dy = q.y - p.y, dd = hyp(dx, dy) || 1; return (dx * p.vx + dy * p.vy) / (dd * (hyp(p.vx, p.vy) || 1)) > k || hyp(p.vx, p.vy) < 40; };
  let tx = -p.x, ty = -p.y, dash = false;
  switch (act) {
    case 'attack': if (!o) break;
      { const od = hyp(o.x, o.y) || 1; tx = o.x - o.x / od * 18 - p.x; ty = o.y - o.y / od * 18 - p.y; if (ready && hyp(tx, ty) < 170 && aimed(o, .7)) dash = true; } break;
    case 'hunt': { const q = ec || o; if (!q) break;
      const od = hyp(q.x, q.y) || 1, d = dist(q), behind = (q.x - p.x) * q.x / od + (q.y - p.y) * q.y / od > d * .6;
      if (behind && d < 190) { tx = q.x - p.x; ty = q.y - p.y; if (ready && aimed(q, .7)) dash = true; }
      else { tx = q.x - q.x / od * 70 - p.x; ty = q.y - q.y / od * 70 - p.y; } } break;
    case 'item': if (it) { tx = it.x - p.x; ty = it.y - p.y; } break;
    case 'evade': if (o) { tx = (p.x - o.x) - p.x * 1.2; ty = (p.y - o.y) - p.y * 1.2; } break;
    case 'circle': if (o) { const dx = p.x - o.x, dy = p.y - o.y; tx = -dy; ty = dx; if (tx * -p.x + ty * -p.y < 0) { tx = -tx; ty = -ty; } } break;
    case 'hold': tx = -p.x * .2; ty = -p.y * .2; break;
    default: break; // center
  }
  return aim(tx, ty, dash);
}

function spawnItem(g) {
  if (g.items.length >= 2) return;
  const a = R() * Math.PI * 2, d = R() * g.r * .65, kinds = Object.keys(ITEM);
  g.items.push({ x: Math.cos(a) * d, y: Math.sin(a) * d, kind: kinds[Math.floor(R() * kinds.length)] });
}

function step(g) {
  const dt = DT; g.t += dt;
  if (g.t > SHRINK_AT) g.r = Math.max(AR_MIN, AR - (g.t - SHRINK_AT) * SHRINK_V);
  g.nextItem -= dt; if (g.nextItem <= 0) { spawnItem(g); g.nextItem = 5 + R() * 3; }
  for (const p of g.bots) {
    if (p.out) continue;
    const P = g.players[p.i];
    for (const k of ['dashCd', 'dashT', 'blinkCd', 'counterCd', 'boost', 'inv']) p[k] = Math.max(0, p[k] - dt);
    if (p.respawn > 0) { p.respawn -= dt;
      if (p.respawn <= 0) { const a = R() * Math.PI * 2; p.x = Math.cos(a) * 40; p.y = Math.sin(a) * 40; p.vx = p.vy = 0; p.inv = 1.5; }
      continue; }
    if (p.fall > 0) { p.fall -= dt; p.x += p.vx * dt * .5; p.y += p.vy * dt * .5;
      if (p.fall <= 0) {
        p.lives--;
        const by = p.last && g.t - p.last.t < 4 ? p.last.by : null, dead = p.lives <= 0;
        if (by !== null) { g.bots[by].kos++; say(g, by, g.players[by].say.ko, 36); g.bots[by].lastSay = g.t; } else p.self++;
        if (dead) { p.out = true; p.deathT = g.t; } else p.respawn = 1.2;
        say(g, p.i, dead ? '다음 판에 보자…' : '으아악!', 28);
        g.events.push(by !== null ? `🥊 ${g.players[by].name} → ${P.name} 링아웃 (+1)${dead ? ' · 탈락' : ''}` : `🫠 ${P.name} 혼자 굴러떨어짐${dead ? ' · 탈락' : ''}`);
        g.fx.push({ k: 'pop', text: '링아웃!', sub: by !== null ? `${g.players[by].name} → ${P.name}` : `${P.name} 자멸` });
      }
      continue; }
    p.think -= dt;
    if (p.think <= 0) { p.think = L.react; const c = decide(g, p);
      if (c.blink) {
        const dx = p.x - c.blink.x, dy = p.y - c.blink.y, dd = hyp(dx, dy) || 1; let nx = -dy / dd, ny = dx / dd;
        if ((p.x + nx * 70) ** 2 + (p.y + ny * 70) ** 2 > (p.x - nx * 70) ** 2 + (p.y - ny * 70) ** 2) { nx = -nx; ny = -ny; }
        g.fx.push({ k: 'ghost', x: p.x, y: p.y, i: p.i });
        p.x += nx * 75; p.y += ny * 75; p.blinkCd = 3.5; p.ctl = { ax: nx, ay: ny, dash: false };
        g.fx.push({ k: 'ring', x: p.x, y: p.y, c: '#ffffff', r0: 10, r1: 40 });
      } else p.ctl = c; }
    const c = p.ctl, k = (p.boost > 0 ? 1.4 : 1) * (P.skill === 'dash' ? 1.3 : 1) / Math.sqrt(p.m);
    p.vx += c.ax * ACC * k * dt; p.vy += c.ay * ACC * k * dt;
    if (c.dash && p.dashCd <= 0) {
      const l = hyp(c.ax, c.ay) || 1, imp = DASH / Math.sqrt(p.m);
      p.vx += c.ax / l * imp; p.vy += c.ay / l * imp;
      p.dashCd = P.skill === 'dash' ? 1.7 : DASH_CD; p.dashT = DASH_T;
      if (g.t - p.lastSay > 3.5 && R() < .45) { say(g, p.i, P.say.dash, 24); p.lastSay = g.t; }
    }
    const drag = Math.exp(-DRAG * dt); p.vx *= drag; p.vy *= drag;
    const sp = hyp(p.vx, p.vy), cap = p.dashT > 0 ? 900 : VMAX * (p.boost > 0 ? 1.35 : 1);
    if (sp > cap) { p.vx *= cap / sp; p.vy *= cap / sp; }
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (sp > 20) p.face = Math.atan2(p.vy, p.vx);
  }
  // 충돌
  const act = g.bots.filter(active);
  for (let a = 0; a < act.length; a++) for (let b = a + 1; b < act.length; b++) {
    const p = act[a], q = act[b], dx = q.x - p.x, dy = q.y - p.y, d = hyp(dx, dy), rr = p.r + q.r;
    if (d >= rr || d === 0) continue;
    const nx = dx / d, ny = dy / d, rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny, ov = rr - d;
    p.x -= nx * ov * q.m / (p.m + q.m); p.y -= ny * ov * q.m / (p.m + q.m); q.x += nx * ov * p.m / (p.m + q.m); q.y += ny * ov * p.m / (p.m + q.m);
    if (rel <= 0) continue;
    const j = 1.95 * rel / (1 / p.m + 1 / q.m); let jp = j, jq = j;
    if (p.dashT > 0 && q.dashT <= 0) jq *= 1.55;
    if (q.dashT > 0 && p.dashT <= 0) jp *= 1.55;
    const PP = g.players[p.i], PQ = g.players[q.i];
    if (PQ.skill === 'counter' && q.dashT <= 0 && p.dashT > 0 && q.counterCd <= 0) { jp *= 1.6; jq *= .35; q.counterCd = 4; g.events.push(`🛡 ${PQ.name} 반사 장갑 → ${PP.name}`); g.fx.push({ k: 'pop', text: '반사!', sub: `${PQ.name}의 반사 장갑`, small: 1 }); }
    if (PP.skill === 'counter' && p.dashT <= 0 && q.dashT > 0 && p.counterCd <= 0) { jq *= 1.6; jp *= .35; p.counterCd = 4; g.events.push(`🛡 ${PP.name} 반사 장갑 → ${PQ.name}`); g.fx.push({ k: 'pop', text: '반사!', sub: `${PP.name}의 반사 장갑`, small: 1 }); }
    if (q.shield > 0) { jq *= .25; q.shield = 0; g.fx.push({ k: 'ring', x: q.x, y: q.y, c: '#7fd3ff', r0: q.r, r1: q.r * 2.4 }); }
    if (p.shield > 0) { jp *= .25; p.shield = 0; g.fx.push({ k: 'ring', x: p.x, y: p.y, c: '#7fd3ff', r0: p.r, r1: p.r * 2.4 }); }
    if (q.inv > 0) jq *= .3; if (p.inv > 0) jp *= .3;
    p.vx -= jp / p.m * nx; p.vy -= jp / p.m * ny; q.vx += jq / q.m * nx; q.vy += jq / q.m * ny;
    p.last = { by: q.i, t: g.t }; q.last = { by: p.i, t: g.t };
    g.fx.push({ k: 'spark', x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, power: Math.round(rel) });
  }
  // 아이템
  for (const p of act) for (let k = g.items.length - 1; k >= 0; k--) {
    const it = g.items[k];
    if (hyp(it.x - p.x, it.y - p.y) > p.r + 14) continue;
    g.items.splice(k, 1);
    if (it.kind === 'speed') p.boost = 4;
    else if (it.kind === 'shield') p.shield = 1;
    else { g.fx.push({ k: 'ring', x: it.x, y: it.y, c: '#ff6fc8', r0: 10, r1: 170, w: 6 });
      for (const o of act) { if (o === p) continue; const dx = o.x - p.x, dy = o.y - p.y, d = hyp(dx, dy) || 1;
        if (d < 160) { const f = 520 * (1 - d / 200) / o.m * (o.shield > 0 ? .25 : 1); o.vx += dx / d * f; o.vy += dy / d * f; o.last = { by: p.i, t: g.t }; } } }
    say(g, p.i, it.kind === 'speed' ? '쳇바퀴 풀가동!' : it.kind === 'shield' ? '방패 장착' : '전파 충격파!', 22);
    g.events.push(`✨ ${g.players[p.i].name} ${ITEM[it.kind]} 획득`);
  }
  // 링아웃
  for (const p of act) if (hyp(p.x, p.y) > g.r + p.r * .3) { p.fall = .6; g.fx.push({ k: 'splash', x: p.x, y: p.y, i: p.i }); }
  // 끝: 1명 이하 남거나 시간 종료 → 생존 > 목숨 > KO 순으로 승자
  const left = g.bots.filter(b => !b.out);
  if (left.length <= 1 || g.t >= TIME_LIMIT) {
    g.over = true;
    const rank = g.bots.slice().sort((a, b) => (b.out ? 0 : 1) - (a.out ? 0 : 1) || b.lives - a.lives || b.kos - a.kos);
    g.winner = rank[0].i;
    say(g, g.winner, g.players[g.winner].say.win, 70);
    if (g.t >= TIME_LIMIT) g.events.push('⏱ 시간 종료 — 목숨·KO 순으로 판정');
  }
}

// 한 틱(0.05초) 진행. g.events 에 로그 문자열, g.fx 에 이번 틱의 연출 이벤트가 쌓이고, 끝나면 g.over=true.
export function tick(g) {
  if (g.over) return;
  g.events = []; g.fx = [];
  for (let k = 0; k < STEPS && !g.over; k++) step(g);
  g.bubbles = g.bubbles.filter(b => --b.t > 0);
}

// 브라우저로 보내는 가벼운 스냅샷. bots: [x, y, r, lives, out, fall, respawn, dashing, shield, boost, kos, face, inv, dashCd, 현재 규칙 이름]
export const snapshot = g => ({
  kind: 'sumo', t: +g.t.toFixed(2), r: Math.round(g.r),
  bots: g.bots.map(b => [+b.x.toFixed(1), +b.y.toFixed(1), b.r, b.lives, b.out ? 1 : 0, +b.fall.toFixed(2), b.respawn > 0 ? 1 : 0, b.dashT > 0 ? 1 : 0, b.shield > 0 ? 1 : 0, b.boost > 0 ? 1 : 0, b.kos, +b.face.toFixed(2), b.inv > 0 ? 1 : 0, b.dashCd > 0 ? 1 : 0, b.rule]),
  items: g.items.map(i => [Math.round(i.x), Math.round(i.y), i.kind]), bubbles: g.bubbles.map(u => [u.i, u.txt]), fx: g.fx,
  players: g.players.map(p => p.name), over: g.over, winner: g.winner,
});

// 결과: 우승 +3, 링아웃(KO) +1 — game.js 와 같은 모양이라 점수판 코드를 공유
export const results = g => g.bots.map(b => ({ name: g.players[b.i].name, pts: (g.winner === b.i ? 3 : 0) + b.kos, survived: g.winner === b.i, kills: b.kos, self: b.self, deathT: b.deathT }));
