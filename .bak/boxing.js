// 마네킹 복싱 엔진 — 마네킹복싱.html 시제품 이식. Verlet 입자 몸 + 근육(목표 자세로 당기는 PD 스프링).
// 3라운드 × 30초, 다운 세 번이나 10카운트면 KO, 아니면 점수 판정(무승부 없음 — 토너먼트라 반드시 한 명이 올라간다).
// sumo.js와 같은 인터페이스(newGame / tick / snapshot / results / MAXP). 한 틱 = 0.05초(물리 3스텝), 다운 직후 1.1초는 슬로모션(1스텝).
export const MAXP = 2, RING = 2.9, ROUND_T = 30, ROUNDS = 3;
const DT = 1 / 60, GRAV = 13, ITER = 6, STEPS = 3, HIP_H = 0.9;
const LEN = { thigh: 0.46, shin: 0.47, spine: 0.5, neck: 0.24, upper: 0.3, fore: 0.3 };
const PI = Math.PI, D2R = PI / 180;
/* 입자 번호: 골반 가슴 머리 앞팔꿈치 앞장갑 뒷팔꿈치 뒷장갑 앞무릎 앞발 뒷무릎 뒷발 */
const P = 0, C = 1, H = 2, EF = 3, GF = 4, EB = 5, GB = 6, KF = 7, FF = 8, KB = 9, FB = 10;
const MASS = [3, 3, 1.4, 0.5, 0.6, 0.5, 0.6, 1, 1, 1, 1];
const RAD = [0.16, 0.17, 0.13, 0.05, 0.1, 0.05, 0.1, 0.06, 0.04, 0.06, 0.04];
const UPPER_BONES = [[P, C, LEN.spine], [C, H, LEN.neck], [C, EF, LEN.upper], [EF, GF, LEN.fore], [C, EB, LEN.upper], [EB, GB, LEN.fore]];
const LEG_BONES = [[P, KF, LEN.thigh], [KF, FF, LEN.shin], [P, KB, LEN.thigh], [KB, FB, LEN.shin]];
const rng = Math.random, clamp = (v, a, b) => v < a ? a : v > b ? b : v;

export const STYLE = {
  out:   { name: '아웃복서', desc: '잽 거리에서 치고 빠지기. 맞기 전에 물러남', range: 0.8, mix: [['jab', 0.55], ['cross', 0.3], ['body', 0.15]], agg: 0.6, cnt: 0.3, back: 0.9, crouch: 0.05, lean: 0.04, guard: 1, speed: 1.2 },
  in:    { name: '인파이터', desc: '파고들어 몸통과 어퍼컷. 가드 올리고 전진', range: 0.6, mix: [['jab', 0.12], ['cross', 0.18], ['body', 0.38], ['upper', 0.32]], agg: 0.85, cnt: 0.15, back: 0, crouch: 0.1, lean: 0.16, guard: 1, dmg: 1.15 },
  cnt:   { name: '카운터', desc: '가드 굳히고 기다렸다가, 상대 주먹이 빠질 때 받아침', range: 0.76, mix: [['jab', 0.25], ['cross', 0.55], ['upper', 0.2]], agg: 0.2, cnt: 1, back: 0.35, crouch: 0.15, lean: 0.02, guard: 1.1 },
  brawl: { name: '난타형', desc: '가드보다 주먹. 체중 실은 스트레이트를 계속 던짐', range: 0.7, mix: [['cross', 0.55], ['upper', 0.25], ['jab', 0.2]], agg: 1.15, cnt: 0.1, back: 0, crouch: 0.1, lean: 0.12, guard: 0.5, power: 0.25, dmg: 1.0 },
};
export const SKIN = { wood: '원목', white: '하얀 석고', black: '검정 무광', chrome: '크롬', pink: '분홍 플라스틱' };
export const COLORS = ['빨강', '파랑', '노랑', '초록', '보라', '주황', '분홍', '흰색']; // 장갑·트렁크 색 번호 0~7 (화면 색은 arena.js)
export const LINES = {
  out: { intro: '잽 맛 좀 볼래?', down: '거리 조절 실패지?', win: '나비처럼 날았지' },
  in: { intro: '안으로 들어간다', down: '배가 약하네', win: '거리 따윈 없어' },
  cnt: { intro: '먼저 쳐 봐', down: '제 발로 왔네', win: '기다리는 놈이 이긴다' },
  brawl: { intro: '한 방이면 끝나', down: '한 방이면 충분', win: '맞으면서 이긴다' },
};
// ponytail: 실력은 시제품의 "v24 · 아침 7시"로 고정. 밤새 레벨업 없음 — 대회 전에 컨셉만 정하고 그대로 둔다. 필요하면 플레이어별 LV로.
const LV = { aim: 0.04, react: 0.08, guard: 0.95, rng: 0.03, flail: 0, lean: 0.35, read: 0.9, combo: 0.65, tempo: 1 };
/* 펀치: 팔(0 앞팔, 1 뒷팔), 단계 시간, 노리는 곳 */
const MOVES = {
  jab:   { name: '잽', arm: 0, wind: 0.03, ext: 0.16, ret: 0.13, part: 'head', lean: 0.08 },
  cross: { name: '스트레이트', arm: 1, wind: 0.05, ext: 0.2, ret: 0.18, part: 'head', lean: 0.3 },
  body:  { name: '보디', arm: 0, wind: 0.04, ext: 0.18, ret: 0.14, part: 'belly', lean: 0.22, crouch: 0.4 },
  upper: { name: '어퍼컷', arm: 1, wind: 0.1, ext: 0.2, ret: 0.18, part: 'chin', lean: 0.12, crouch: 0.25, upper: true },
};
const GUARD = [{ sh: -35 * D2R, el: 120 * D2R }, { sh: -45 * D2R, el: 135 * D2R }];
const LOW = [{ sh: -70 * D2R, el: 50 * D2R }, { sh: -75 * D2R, el: 45 * D2R }];
const dirW = (f, a) => [f * Math.cos(a), Math.sin(a)];

function makeFighter(style, side, idx) {
  const F = {
    i: idx, style, f: -side, base: side * 1.15, mode: 'up', modeT: 0,
    hp: 100, stun: 0, sta: 1, downs: 0, pts: 0, landed: 0, thrown: 0, blocked: 0, slips: 0,
    cnt: 0, cntT: 0, riseAt: 0, slip: false, tiltT: 0, lastHitT: -9, lastHitBy: null,
    cmd: { move: 0, lean: 0, crouch: 0, punch: -1, arms: [{ ...GUARD[0] }, { ...GUARD[1] }] },
    p: [], feet: [], armed: [true, true], ai: newAI(),
  };
  F.p = Array.from({ length: 11 }, () => ({ x: 0, y: 0, px: 0, py: 0 }));
  const T = poseTargets(F, F.base);
  T.forEach((t, k) => { F.p[k].x = F.p[k].px = t.x; F.p[k].y = F.p[k].py = t.y; });
  F.feet = [{ x: T[FF].x, sx: 0, tx: 0, t: -1 }, { x: T[FB].x, sx: 0, tx: 0, t: -1 }];
  return F;
}
function newAI() { return { act: null, hist: [], guardUp: true, guardT: 0, flailT: 0, flail: null, retreatT: 0, duckT: 0, cool: 0, wantCnt: 0, moveJ: 0, lowT: 0 }; }

/* 서 있는 자세의 목표 위치 (일어설 때·처음 놓을 때) */
export function poseTargets(F, bx) {
  const f = F.f, c = F.cmd, T = [];
  const hy = HIP_H - c.crouch * 0.2;
  T[P] = { x: bx, y: hy };
  T[C] = { x: bx + f * Math.sin(c.lean) * LEN.spine, y: hy + Math.cos(c.lean) * LEN.spine };
  T[H] = { x: T[C].x + f * Math.sin(c.lean) * LEN.neck, y: T[C].y + Math.cos(c.lean) * LEN.neck };
  [[EF, GF, 0], [EB, GB, 1]].forEach(([e, gl, k]) => {
    const a = c.arms[k], d1 = dirW(f, a.sh), d2 = dirW(f, a.sh + a.el);
    T[e] = { x: T[C].x + d1[0] * LEN.upper, y: T[C].y + d1[1] * LEN.upper };
    T[gl] = { x: T[e].x + d2[0] * LEN.fore, y: T[e].y + d2[1] * LEN.fore };
  });
  T[FF] = { x: bx + f * 0.18, y: RAD[FF] }; T[FB] = { x: bx - f * 0.3, y: RAD[FB] };
  T[KF] = knee(T[P], T[FF], f); T[KB] = knee(T[P], T[FB], f);
  return T;
}
function knee(hip, foot, f) {
  let dx = foot.x - hip.x, dy = foot.y - hip.y, d = Math.hypot(dx, dy) || 1e-6;
  const maxd = LEN.thigh + LEN.shin - 0.002; if (d > maxd) { dx *= maxd / d; dy *= maxd / d; d = maxd; }
  const ux = dx / d, uy = dy / d;
  const a = (LEN.thigh * LEN.thigh - LEN.shin * LEN.shin + d * d) / (2 * d), h = Math.sqrt(Math.max(0, LEN.thigh * LEN.thigh - a * a));
  return { x: hip.x + ux * a + f * -uy * h, y: hip.y + uy * a + f * ux * h };
}

/* ---------- 뇌 (봇이 매 0.05초 정하는 것) ---------- */
function seenOf(O) {
  const q = O.p;
  return { x: q[P].x, hx: q[H].x, hy: q[H].y, cx: q[C].x, cy: q[C].y, bx: (q[P].x + q[C].x) / 2, by: (q[P].y + q[C].y) / 2,
    g: [[q[GF].x, q[GF].y, q[GF].x - q[GF].px, q[GF].y - q[GF].py], [q[GB].x, q[GB].y, q[GB].x - q[GB].px, q[GB].y - q[GB].py]], up: O.mode === 'up' };
}
const guardHigh = seen => seen.g.every(gg => gg[1] > seen.cy - 0.02 && Math.abs(gg[0] - seen.hx) < 0.35);
const aimAt = (F, tx, ty) => { const c = F.p[C]; return Math.atan2(ty - c.y, (tx - c.x) * F.f); };

function brain(M, F) {
  const O = M.F[1 - F.i], ai = F.ai, st = STYLE[F.style], lv = LV;
  ai.hist.push(seenOf(O)); if (ai.hist.length > 12) ai.hist.shift();
  const seen = ai.hist[Math.max(0, ai.hist.length - 1 - Math.round(lv.react * 20))];
  const c = F.cmd, me = F.p;
  const dist = Math.abs(seen.x - me[P].x);
  const tick = 0.05;
  ai.cool -= tick; ai.lowT -= tick; ai.retreatT -= tick; ai.duckT -= tick; ai.guardT -= tick;
  let lean = st.lean, crouch = st.crouch, move;
  if (ai.guardT <= 0) { ai.guardUp = rng() < lv.guard * st.guard; ai.guardT = 0.4 + rng() * 0.4; }
  const want = st.range + (rng() - 0.5) * lv.rng * 2 + (F.sta < 0.25 && lv.read > 0.5 ? 0.35 : 0);
  ai.moveJ += (rng() - 0.5) * 0.5; ai.moveJ *= 0.8;
  move = clamp((dist - want) * 3.5, -1, 1) * Math.sign(seen.x - me[P].x) + ai.moveJ * 0.3;
  if (ai.retreatT > 0) move = -Math.sign(seen.x - me[P].x) * 0.9;
  let incoming = false, low = false;
  for (const gg of seen.g) {
    const tx = me[H].x, ty = (me[H].y + me[P].y) / 2;
    const toMe = (tx - gg[0]) * gg[2] + (ty - gg[1]) * gg[3];
    const sp = Math.hypot(gg[2], gg[3]) * 60, d = Math.hypot(tx - gg[0], ty - gg[1]);
    if (toMe > 0 && sp > 2.5 && d < 0.85) { incoming = true; if (gg[1] < me[C].y - 0.12) low = true; }
  }
  if (incoming && !ai.act && rng() < lv.read) {
    ai.guardUp = true; ai.guardT = 0.5;
    if (low) ai.lowT = 0.3;
    if (st.back > 0.5 && rng() < st.back) ai.retreatT = 0.25;
    else if (rng() < 0.35) ai.duckT = 0.25;
    if (rng() < st.cnt) ai.wantCnt = 0.35;
  }
  if (ai.duckT > 0) { crouch = 0.8; lean = 0.35; }
  ai.wantCnt -= tick;
  if (ai.flailT > 0) ai.flailT -= tick;
  else if (rng() < lv.flail * 0.12) {
    ai.flailT = 0.3 + rng() * 0.5;
    ai.flail = { arms: [0, 1].map(() => ({ sh: (rng() * 180 - 90) * D2R, el: rng() * 150 * D2R })), lean: (rng() * 2 - 1) * lv.lean, move: rng() * 2 - 1 };
  }
  const inRange = dist < 0.86 + (rng() - 0.5) * lv.rng * 2;
  if (!ai.act && ai.cool <= 0 && seen.up && F.sta > (lv.read > 0.5 ? 0.12 : 0)) {
    let pick = null;
    if (ai.wantCnt > 0 && inRange) { pick = st.cnt > 0.6 ? (dist < 0.62 ? 'upper' : 'cross') : 'jab'; ai.wantCnt = 0; }
    else if ((inRange || lv.flail > 0.3) && rng() < st.agg * lv.tempo * 0.2 * (st.back > 0.5 && dist < st.range ? 2.2 : 1)) pick = dist < 0.62 && rng() < lv.read ? (rng() < 0.5 ? 'upper' : 'body') : pickMove(st.mix, dist, null, guardHigh(seen) && rng() < lv.read * 0.9);
    if (pick) { startPunch(F, pick, seen); if (ai.wantCnt === 0 && st.cnt > 0.6) ai.act.counter = true; ai.wantCnt = -1; }
  }
  let arms = ai.guardUp ? [{ ...GUARD[0] }, { ...GUARD[1] }] : [{ ...LOW[0] }, { ...LOW[1] }];
  if (ai.act) {
    const a = ai.act, mv = MOVES[a.kind];
    a.t += tick;
    const k = mv.arm;
    if (a.t < mv.wind) arms[k] = mv.upper ? { sh: -75 * D2R, el: 30 * D2R } : { sh: a.aim - 12 * D2R, el: 95 * D2R };
    else if (a.t < mv.wind + mv.ext) {
      arms[k] = mv.upper ? { sh: a.aim - 25 * D2R, el: 50 * D2R } : { sh: a.aim, el: (mv.part === 'belly' ? 12 : 0) * D2R };
      lean += mv.lean + (st.power || 0) + (lv.flail > 0.3 ? (rng() - 0.3) * lv.lean * 0.6 : 0);
      crouch = Math.max(crouch, mv.crouch || 0);
    } else if (a.t >= mv.wind + mv.ext + mv.ret) {
      ai.act = null; ai.cool = (0.12 + rng() * 0.25) / lv.tempo;
      if (st.back > 0.5 && rng() < st.back * 0.7) ai.retreatT = 0.3;
      if (rng() < lv.combo * (st.agg > 0.7 ? 1 : 0.6) && dist < st.range + 0.2) { ai.cool = 0; startPunch(F, pickMove(st.mix, dist, a.kind), seen); }
    }
  }
  if (ai.lowT > 0 && !(ai.act && MOVES[ai.act.kind].arm === 0)) arms[0] = { sh: -80 * D2R, el: 100 * D2R };
  if (ai.flailT > 0) { arms = ai.flail.arms.map(a => ({ ...a })); lean = ai.flail.lean; move = ai.flail.move; }
  c.punch = punchArm(ai);
  c.move = clamp(move, -1, 1); c.lean = clamp(lean, -1.3, 1.3); c.crouch = crouch; c.arms = arms;
}
function punchArm(ai) {
  const a = ai.act; if (!a) return -1;
  const mv = MOVES[a.kind];
  return a.t >= mv.wind && a.t < mv.wind + mv.ext + 0.05 ? mv.arm : -1;
}
function pickMove(mix, dist, not, low) {
  if (low) return dist < 0.7 && rng() < 0.4 ? 'upper' : 'body';
  let list = mix.filter(m => m[0] !== not);
  if (dist > 0.75) list = list.filter(m => m[0] !== 'upper');
  if (!list.length) list = mix;
  let s = list.reduce((a, m) => a + m[1], 0) * rng();
  for (const m of list) { s -= m[1]; if (s <= 0) return m[0]; }
  return list[0][0];
}
function startPunch(F, kind, seen) {
  const mv = MOVES[kind];
  let tx = seen.hx, ty = seen.hy;
  if (mv.part === 'belly') { tx = seen.bx; ty = seen.by + 0.05; }
  if (mv.part === 'chin') ty -= 0.06;
  F.ai.act = { kind, t: 0, aim: aimAt(F, tx, ty) + (rng() * 2 - 1) * LV.aim };
  F.thrown++;
}
/* 쉬는 시간·다운 카운트 중: 가드 올리고 거리 벌리기 */
function neutral(M, F, winPose) {
  const O = M.F[1 - F.i], c = F.cmd;
  F.ai.act = null; c.punch = -1;
  c.lean = 0.02; c.crouch = 0.05;
  if (winPose) { c.arms = [{ sh: 75 * D2R, el: 10 * D2R }, { sh: 100 * D2R, el: -10 * D2R }]; c.move = 0; return; }
  c.arms = [{ ...GUARD[0] }, { ...GUARD[1] }];
  const d = Math.abs(O.p[P].x - F.p[P].x);
  c.move = M.phase === 'break' ? clamp((-F.f * 1.6 - F.base) * 2, -1, 1) : d < 1.5 ? -Math.sign(O.p[P].x - F.p[P].x) : 0;
}

/* ---------- 물리 한 걸음 ---------- */
function pd(q, tx, ty, k, d, v) { v[0] = v[0] * (1 - d) + (tx - q.x) * k; v[1] = v[1] * (1 - d) + (ty - q.y) * k; }
function stepFighter(F) {
  const p = F.p, f = F.f, c = F.cmd;
  const V = p.map(q => [q.x - q.px, q.y - q.py]);
  const g = GRAV * DT * DT;
  for (const v of V) v[1] -= g;
  if (F.mode === 'up') {
    const spd = 1.7 * (0.6 + 0.4 * F.sta) * (1 - c.crouch * 0.45) * (STYLE[F.style].speed || 1);
    F.base = clamp(F.base + c.move * spd * DT, -RING + 0.45, RING - 0.45);
    const hy = HIP_H - c.crouch * 0.2;
    pd(p[P], F.base, hy, 0.16, 0.55, V[P]);
    const sp = [f * Math.sin(c.lean), Math.cos(c.lean)];
    const before = [V[C][0], V[C][1]];
    pd(p[C], p[P].x + sp[0] * LEN.spine, p[P].y + sp[1] * LEN.spine, 0.22, 0.6, V[C]);
    V[P][0] -= (V[C][0] - before[0]) * 0.35; V[P][1] -= (V[C][1] - before[1]) * 0.2;
    pd(p[H], p[C].x + sp[0] * LEN.neck, p[C].y + sp[1] * LEN.neck, 0.2, 0.45, V[H]);
    const ks = 0.3 * (0.55 + 0.45 * F.sta);
    [[EF, GF, 0], [EB, GB, 1]].forEach(([e, gl, k]) => {
      const a = c.arms[k], d1 = dirW(f, a.sh);
      const b0 = [V[e][0], V[e][1]];
      pd(p[e], p[C].x + d1[0] * LEN.upper, p[C].y + d1[1] * LEN.upper, ks, 0.72, V[e]);
      V[C][0] -= (V[e][0] - b0[0]) * 0.12; V[C][1] -= (V[e][1] - b0[1]) * 0.08;
      const ua = Math.atan2(p[e].y - p[C].y, (p[e].x - p[C].x) * f);
      const d2 = dirW(f, ua + a.el);
      pd(p[gl], p[e].x + d2[0] * LEN.fore, p[e].y + d2[1] * LEN.fore, ks, 0.72, V[gl]);
    });
  } else if (F.mode === 'rise') {
    const k = Math.min(1, F.modeT / 0.7) * 0.2;
    const T = poseTargets(F, F.base);
    for (let j = 0; j < 11; j++) pd(p[j], T[j].x, T[j].y, k, 0.35, V[j]);
  } else {
    for (const v of V) { v[0] *= 0.985; v[1] *= 0.995; }
  }
  for (let j = 0; j < 11; j++) {
    const q = p[j];
    if (F.mode === 'up' && j >= KF) continue;
    q.px = q.x; q.py = q.y; q.x += V[j][0]; q.y += V[j][1];
  }
  if (F.mode === 'up') legs(F);
}
/* 서 있을 때 다리: 발은 바닥에 딛고, 몸이 멀어지면 한 발씩 옮김 */
function legs(F) {
  const p = F.p, f = F.f, hip = p[P];
  const want = [hip.x + f * 0.18, hip.x - f * 0.3];
  const stepping = F.feet.some(ft => ft.t >= 0);
  F.feet.forEach((ft, k) => {
    if (ft.t < 0 && !stepping && Math.abs(want[k] - ft.x) > 0.13) { ft.t = 0; ft.sx = ft.x; ft.tx = want[k] + (want[k] - ft.x) * 0.25; }
  });
  F.feet.forEach((ft, k) => {
    const fi = k ? FB : FF, ki = k ? KB : KF;
    let y = RAD[fi];
    if (ft.t >= 0) {
      ft.t += DT / 0.13; const u = Math.min(1, ft.t);
      ft.x = ft.sx + (ft.tx - ft.sx) * u; y += Math.sin(u * PI) * 0.07;
      if (u >= 1) ft.t = -1;
    }
    const fq = p[fi]; fq.px = fq.x; fq.py = fq.y; fq.x = ft.x; fq.y = y;
    const kn = knee(hip, fq, f), kq = p[ki]; kq.px = kq.x; kq.py = kq.y; kq.x = kn.x; kq.y = kn.y;
  });
}
function solveDist(p, a, b, len, legsKin) {
  const A = p[a], B = p[b];
  let dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1e-6;
  const wa = legsKin && a >= KF ? 0 : 1 / MASS[a], wb = legsKin && b >= KF ? 0 : 1 / MASS[b];
  const s = (d - len) / d / (wa + wb || 1);
  A.x += dx * s * wa; A.y += dy * s * wa; B.x -= dx * s * wb; B.y -= dy * s * wb;
}
function sepCircle(A, ra, ma, B, rb, mb, push = 1) {
  const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy), m = ra + rb;
  if (d >= m || d < 1e-6) return false;
  const o = (m - d) / d * push, wa = 1 / ma, wb = 1 / mb, w = wa + wb;
  A.x -= dx * o * wa / w; A.y -= dy * o * wa / w; B.x += dx * o * wb / w; B.y += dy * o * wb / w;
  return true;
}
function segPoint(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy || 1e-9;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1);
  return [ax + dx * t, ay + dy * t, t];
}

/* 주먹 맞음 판정: 막힘(장갑·팔뚝) 먼저, 그다음 머리·가슴·배 */
function punches(M, Fa, Fd) {
  const pa = Fa.p, pd_ = Fd.p, ev = M.ev;
  [[GF, 0], [GB, 1]].forEach(([gi, k]) => {
    const gl = pa[gi];
    const vg = [gl.x - gl.px, gl.y - gl.py];
    if (Fa.cmd.punch !== k) Fa.armed[k] = true;
    if (!Fa.armed[k] || Fa.cmd.punch !== k || Fa.mode !== 'up' || Fd.mode === 'down') return;
    const rel = (tq) => { const dx = tq.x - gl.x, dy = tq.y - gl.y, d = Math.hypot(dx, dy) || 1e-6; return [dx / d, dy / d, d, ((vg[0] - (tq.x - tq.px)) * dx / d + (vg[1] - (tq.y - tq.py)) * dy / d) * 60]; };
    /* 막기 — 주먹을 뻗는 중인 쪽은 막지 못함 (카운터가 노리는 틈) */
    if (Fd.cmd.punch < 0) for (const [e, g2] of [[EF, GF], [EB, GB]]) {
      const bl = pd_[g2];
      const [sx, sy] = segPoint(pd_[e].x, pd_[e].y, bl.x, bl.y, gl.x, gl.y);
      const near = Math.hypot(gl.x - bl.x, gl.y - bl.y) < RAD[GF] * 2 || Math.hypot(gl.x - sx, gl.y - sy) < RAD[GF] + 0.02;
      if (near) {
        const r = rel(bl);
        if (r[3] > 2.2) {
          Fa.armed[k] = false; Fd.blocked++;
          Fd.sta = Math.max(0, Fd.sta - 0.02 * r[3] / 6);
          bl.px -= r[0] * r[3] / 60 * 0.4; bl.py -= r[1] * r[3] / 60 * 0.4;
          ev.push({ type: 'block', who: Fd.i, by: Fa.i, x: +gl.x.toFixed(3), y: +gl.y.toFixed(3) });
          return;
        }
      }
    }
    /* 맞기 */
    const belly = { x: (pd_[P].x * 0.55 + pd_[C].x * 0.45), y: (pd_[P].y * 0.55 + pd_[C].y * 0.45), px: (pd_[P].px * 0.55 + pd_[C].px * 0.45), py: (pd_[P].py * 0.55 + pd_[C].py * 0.45) };
    const chest = { x: pd_[C].x * 0.75 + pd_[P].x * 0.25, y: pd_[C].y * 0.75 + pd_[P].y * 0.25, px: pd_[C].px * 0.75 + pd_[P].px * 0.25, py: pd_[C].py * 0.75 + pd_[P].py * 0.25 };
    const targets = [['head', pd_[H], RAD[H] + 0.02], ['body', chest, 0.15], ['body', belly, 0.16]];
    for (const [part, tq, tr] of targets) {
      const r = rel(tq);
      if (r[2] > tr + RAD[GF] + 0.01 || r[3] < 2.2) continue;
      const v = r[3], head = part === 'head';
      const st = STYLE[Fa.style], cntHit = Fa.ai.act && Fa.ai.act.counter;
      const dmg = Math.max(1, (v - 2) * (head ? 2.2 : 1.35)) * (0.7 + 0.3 * Fa.sta) * (st.dmg || 1) * (cntHit ? 1.5 : 1);
      Fa.armed[k] = false;
      Fd.hp = Math.max(0, Fd.hp - dmg); Fa.pts += dmg; Fa.landed++;
      if (head) Fd.stun += dmg * 7; else { Fd.sta = Math.max(0, Fd.sta - dmg * 0.02); Fd.stun += dmg * 1.6; }
      Fd.lastHitT = M.t; Fd.lastHitBy = Fa.i;
      const imp = v / 60;
      const hitQ = head ? pd_[H] : tq === belly ? pd_[P] : pd_[C];
      hitQ.px -= r[0] * imp * (head ? 0.75 : 0.45); hitQ.py -= r[1] * imp * (head ? 0.75 : 0.45);
      pd_[C].px -= r[0] * imp * 0.22; pd_[C].py -= r[1] * imp * 0.1;
      gl.px += r[0] * imp * 0.6; gl.py += r[1] * imp * 0.6;
      Fd.base = clamp(Fd.base + Math.sign(r[0]) * v * (head ? 0.03 : 0.012), -RING + 0.45, RING - 0.45);
      ev.push({ type: 'hit', who: Fd.i, by: Fa.i, part, dmg: +dmg.toFixed(1), counter: !!cntHit, x: +(gl.x + r[0] * RAD[GF]).toFixed(3), y: +(gl.y + r[1] * RAD[GF]).toFixed(3), big: dmg > 11 });
      return;
    }
  });
}

function collide(M) {
  const [A, B] = M.F;
  for (const F of M.F) {
    const p = F.p, kin = F.mode === 'up';
    for (const [a, b, l] of UPPER_BONES) solveDist(p, a, b, l, kin);
    if (!kin) for (const [a, b, l] of LEG_BONES) solveDist(p, a, b, l, false);
    for (let j = 0; j < 11; j++) {
      if (kin && j >= KF) continue;
      const q = p[j], r = RAD[j];
      if (q.y < r) { const vx = q.x - q.px; q.y = r; q.py = r; q.px = q.x - vx * 0.7; }
      if (q.x > RING - r) { const vx = q.x - q.px; q.x = RING - r; q.px = q.x + Math.abs(vx) * 0.5; }
      if (q.x < -RING + r) { const vx = q.x - q.px; q.x = -RING + r; q.px = q.x - Math.abs(vx) * 0.5; }
    }
  }
  const pa = A.p, pb = B.p;
  const BR = [0.25, 0.23, 0.15];
  for (const ja of [P, C, H]) for (const jb of [P, C, H]) sepCircle(pa[ja], BR[ja], MASS[ja], pb[jb], BR[jb], MASS[jb], 1);
  for (const [Fa, Fd] of [[A, B], [B, A]]) {
    for (const gi of [GF, GB]) {
      const gl = Fa.p[gi];
      for (const t of [H, C, GF, GB]) sepCircle(gl, RAD[GF], MASS[GF], Fd.p[t], RAD[t], MASS[t] * (t === H ? 1.5 : 1), 0.8);
      const mid = { x: (Fd.p[P].x + Fd.p[C].x) / 2, y: (Fd.p[P].y + Fd.p[C].y) / 2 };
      const dx = gl.x - mid.x, dy = gl.y - mid.y, d = Math.hypot(dx, dy);
      if (d < 0.26 && d > 1e-6) { gl.x = mid.x + dx / d * 0.26; gl.y = mid.y + dy / d * 0.26; }
    }
  }
}

const emit = (M, e) => M.ev.push(e);
function knockdown(M, F, slip) {
  F.mode = 'down'; F.modeT = 0; F.slip = slip; F.cnt = 0; F.cntT = 0; F.ai.act = null;
  for (const j of [KF, FF, KB, FB]) { const q = F.p[j]; q.px = q.x; q.py = q.y; }
  if (slip) { F.slips++; emit(M, { type: 'slip', who: F.i }); return; }
  F.downs++; F.stun = 25;
  const O = M.F[1 - F.i]; O.pts += 10;
  F.riseAt = F.hp <= 0 || F.downs >= 3 ? 99 : 4 + Math.min(4, Math.floor((100 - F.hp) / 22)) + Math.floor(rng() * 2);
  emit(M, { type: 'down', who: F.i, by: O.i, downs: F.downs, final: F.riseAt > 10 });
  M.slow = 1.1;
}

function stepMatch(M) {
  M.n++; M.t += DT;
  const [A, B] = M.F;
  const anyDown = M.F.some(F => F.mode !== 'up' && !F.slip);
  if (M.phase === 'pre') { M.pt -= DT; if (M.pt <= 0) { M.phase = 'fight'; emit(M, { type: 'bell', round: M.round }); } }
  else if (M.phase === 'fight' && !anyDown) {
    M.rt += DT;
    if (M.rt >= ROUND_T) {
      emit(M, { type: 'roundEnd', round: M.round });
      if (M.round >= ROUNDS) return judge(M);
      M.phase = 'break'; M.pt = 2.6;
    }
    /* 로프에 몰리거나 붙어서 오래 엉키면 심판이 떼어 놓음 */
    const dist = Math.abs(A.p[P].x - B.p[P].x), pinned = M.F.some(F => Math.abs(F.base) > RING - 0.6);
    if (M.phase === 'fight' && dist < 0.85 && (pinned || dist < 0.6)) M.ropeT += DT; else M.ropeT = Math.max(0, M.ropeT - DT * 2);
    if (M.ropeT > (pinned ? 2.2 : 3)) {
      M.ropeT = 0; M.sepT = 0.7; M.breaks++;
      const c = clamp((A.base + B.base) / 2, -0.8, 0.8);
      M.sepTo = [c - 0.65, c + 0.65];
      emit(M, { type: 'sep' });
    }
  } else if (M.phase === 'break') {
    M.pt -= DT;
    if (M.pt <= 0) {
      M.round++; M.rt = 0; M.phase = 'pre'; M.pt = 1.0;
      for (const F of M.F) { F.sta = Math.min(1, F.sta + 0.5); F.stun = 0; F.hp = Math.min(100, F.hp + 6); }
      emit(M, { type: 'round', round: M.round });
    }
  }
  if (M.sepT > 0) {
    M.sepT -= DT;
    M.F.forEach((F, k) => { if (F.mode === 'up') F.base += (M.sepTo[k] - F.base) * 0.12; });
  }
  if (M.n % 3 === 0) for (const F of M.F) {
    if (F.mode !== 'up') continue;
    const O = M.F[1 - F.i];
    if (M.phase === 'end') neutral(M, F, M.winner === F.i);
    else if (M.phase !== 'fight' || O.mode !== 'up' || M.sepT > 0) neutral(M, F, false);
    else brain(M, F);
  }
  for (const F of M.F) stepFighter(F);
  if (A.mode === 'up' && B.mode === 'up') {
    const gap = Math.abs(A.base - B.base), sg = Math.sign(B.base - A.base) || 1;
    if (gap < 0.6) { const push = (0.6 - gap) / 2; A.base = clamp(A.base - sg * push, -RING + 0.45, RING - 0.45); B.base = clamp(B.base + sg * push, -RING + 0.45, RING - 0.45); }
  }
  if (M.phase === 'fight') { punches(M, A, B); punches(M, B, A); }
  for (let it = 0; it < ITER; it++) collide(M);
  for (const F of M.F) {
    F.modeT += DT;
    const p = F.p;
    if (F.mode === 'up') {
      const gs = Math.hypot(p[GF].x - p[GF].px, p[GF].y - p[GF].py) + Math.hypot(p[GB].x - p[GB].px, p[GB].y - p[GB].py);
      F.sta = clamp(F.sta - Math.max(0, gs * 60 - 3) * 0.08 * DT + 0.1 * DT, 0, 1);
      F.stun = Math.max(0, F.stun - 8 * DT);
      const tilt = Math.atan2((p[C].x - p[P].x) * F.f, p[C].y - p[P].y);
      if (Math.abs(tilt) > 0.95) F.tiltT += DT; else F.tiltT = 0;
      if (M.phase === 'fight' && (F.stun >= 70 || F.hp <= 0)) knockdown(M, F, false);
      else if (F.tiltT > 0.25) knockdown(M, F, M.t - F.lastHitT > 0.5);
    } else if (F.mode === 'down') {
      if (F.slip) { if (F.modeT > 1.1) { F.mode = 'rise'; F.modeT = 0; F.base = clamp(p[P].x, -RING + 0.45, RING - 0.45); } }
      else if (M.phase !== 'end') {
        F.cntT += DT;
        if (F.cntT > 0.6 + F.cnt * 0.42) {
          F.cnt++; emit(M, { type: 'count', who: F.i, n: F.cnt });
          if (F.cnt >= F.riseAt) { F.mode = 'rise'; F.modeT = 0; F.base = clamp(p[P].x, -RING + 0.45, RING - 0.45); F.cmd.lean = 0; F.cmd.crouch = 0; F.cmd.arms = [{ ...GUARD[0] }, { ...GUARD[1] }]; emit(M, { type: 'up', who: F.i }); }
          else if (F.cnt >= 10) finish(M, 1 - F.i, F.downs >= 3 && F.hp > 0 ? 'TKO' : 'KO');
        }
      }
    } else if (F.mode === 'rise' && F.modeT > 0.85) {
      F.mode = 'up'; F.modeT = 0; F.tiltT = 0;
      F.feet[0].x = p[P].x + F.f * 0.18; F.feet[1].x = p[P].x - F.f * 0.3; F.feet.forEach(ft => ft.t = -1);
    }
  }
}
function finish(M, w, how) { M.phase = 'end'; M.winner = w; M.how = how; emit(M, { type: 'end', winner: w, how }); }
// 판정: 점수 → 남은 체력 → 적중 수. 무승부 없음(토너먼트라 반드시 한 명이 올라간다)
function judge(M) { const [A, B] = M.F; const d = (A.pts - B.pts) || (A.hp - B.hp) || (A.landed - B.landed); finish(M, d >= 0 ? 0 : 1, '판정'); }

// ---------- 아레나 인터페이스 ----------
const say = (g, i, txt, t) => { g.bubbles = g.bubbles.filter(b => b.i !== i); if (txt) g.bubbles.push({ i, txt, t }); };
// players: [{name, style, skin, glove, trunk, say:{intro,down,win}}] (정확히 2명)
export function newGame(players) {
  const g = { kind: 'boxing', F: players.map((p, i) => makeFighter(STYLE[p.style] ? p.style : 'out', i ? 1 : -1, i)),
    t: 0, ropeT: 0, sepT: 0, breaks: 0, rt: 0, round: 1, phase: 'pre', pt: 1.4, n: 0, ev: [], winner: null, how: null, slow: 0, lastHit: -9,
    players, events: [], fx: [], bubbles: [], over: false };
  players.forEach((p, i) => say(g, i, p.say.intro, 32 - i * 4));
  return g;
}
// 한 틱(0.05초). g.events 로그 문자열, g.fx 이번 틱의 엔진 이벤트(브라우저가 연출로 바꿈), 끝나면 g.over=true.
export function tick(g) {
  if (g.over) return;
  g.events = []; g.fx = [];
  const steps = g.slow > 0 ? 1 : STEPS; // 다운 직후 슬로모션
  for (let k = 0; k < steps && g.phase !== 'end'; k++) { stepMatch(g); if (g.slow > 0) g.slow -= DT; }
  const N = i => g.players[i].name, [A, B] = g.F;
  for (const e of g.ev) {
    if (e.type === 'hit') { if (e.big || g.t - g.lastHit > 2.5) { g.events.push(`👊 ${N(e.by)} → ${N(e.who)} ${e.part === 'head' ? '얼굴' : '몸통'} ${e.big ? '강타' : '적중'} (${e.dmg.toFixed(0)})`); g.lastHit = g.t; } }
    else if (e.type === 'down') { g.events.push(`🔻 ${N(e.by)} → ${N(e.who)} 다운 (${e.downs}번째, +1)`); say(g, e.by, g.players[e.by].say.down, 40); }
    else if (e.type === 'slip') { g.events.push(`🫠 ${N(e.who)} 혼자 휘청이다 넘어짐`); say(g, e.who, '어어어?!', 20); }
    else if (e.type === 'up') { g.events.push(`${N(e.who)} 다시 일어남`); say(g, e.who, '아직이야!', 24); }
    else if (e.type === 'bell') g.events.push(`🔔 ${e.round}라운드 시작`);
    else if (e.type === 'roundEnd') g.events.push(`${e.round}라운드 종료 · 점수 ${A.pts.toFixed(0)} : ${B.pts.toFixed(0)}`);
    else if (e.type === 'end') { g.events.push(`🥊 ${N(e.winner)} 승리 · ${e.how}`); say(g, e.winner, g.players[e.winner].say.win, 70); }
  }
  g.fx = g.ev; g.ev = [];
  g.bubbles = g.bubbles.filter(b => --b.t > 0);
  if (g.phase === 'end') g.over = true;
}
// 브라우저로 보내는 스냅샷: 입자 11개 좌표 + 상태. 생김새(look)도 같이 보내 화면이 그대로 그린다.
export const snapshot = g => ({
  kind: 'boxing', t: +g.t.toFixed(2), round: g.round, rt: Math.max(0, ROUND_T - g.rt), phase: g.phase, how: g.how,
  f: g.F.map(F => ({ p: F.p.map(q => [+q.x.toFixed(3), +q.y.toFixed(3)]), f: F.f, mode: F.mode, slip: F.slip ? 1 : 0, hp: Math.round(F.hp), sta: +F.sta.toFixed(2), downs: F.downs, pts: Math.round(F.pts), stun: F.stun > 50 ? 1 : 0, landed: F.landed, thrown: F.thrown })),
  look: g.players.map(p => ({ skin: p.skin, glove: p.glove, trunk: p.trunk, style: p.style })),
  fx: g.fx, bubbles: g.bubbles.map(u => [u.i, u.txt]), players: g.players.map(p => p.name), over: g.over, winner: g.winner,
});
// 결과: 경기 승리 +3, 상대를 다운시킬 때마다 +1 — 점수판 코드 공유(kills = 다운 뺏음)
export const results = g => g.F.map((F, i) => { const O = g.F[1 - i]; return { name: g.players[i].name, pts: (g.winner === i ? 3 : 0) + O.downs, survived: g.winner === i, kills: O.downs, self: F.slips, deathT: 0 }; });
