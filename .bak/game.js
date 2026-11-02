// 전파폭탄 엔진. 서버에서 틱을 돌리고 상태만 브라우저로 쏜다.
export const W = 15, H = 11, FUSE = 18, MAX_T = 1100;
const SPAWNS = [[0,0],[W-1,H-1],[W-1,0],[0,H-1],[7,0],[7,H-1],[0,5],[W-1,5]];
export const MAXP = SPAWNS.length;
const D4 = [[1,0],[-1,0],[0,1],[0,-1]];
const inb = (x,y) => x>=0 && y>=0 && x<W && y<H;
const rnd = n => Math.floor(Math.random()*n);

// players: [{name, say, a, c, g, r}] (최대 MAXP)
export function newGame(players){
  const g = {t:0, map:[], bombs:[], flames:[], items:{}, bots:[], bubbles:[], players, events:[], over:false};
  for(let y=0;y<H;y++){ g.map.push([]); for(let x=0;x<W;x++) g.map[y].push((x%2===1&&y%2===1)?1:(Math.random()<.62?2:0)); }
  players.forEach((p,i)=>{
    const [x,y] = SPAWNS[i];
    for(const [dx,dy] of [[0,0],[1,0],[0,1],[-1,0],[0,-1],[2,0],[0,2],[-2,0],[0,-2]]){ const X=x+dx,Y=y+dy; if(inb(X,Y)&&g.map[Y][X]===2) g.map[Y][X]=0; }
    g.bots.push({i,x,y,alive:true,max:1,range:2,step:3,cd:0,deathT:0,kills:0,self:0});
  });
  return g;
}

function blast(g,b){ const out=[[b.x,b.y]]; for(const [dx,dy] of D4) for(let k=1;k<=b.r;k++){ const X=b.x+dx*k,Y=b.y+dy*k; if(!inb(X,Y)||g.map[Y][X]===1) break; out.push([X,Y]); if(g.map[Y][X]===2) break; } return out; }
function dangerMap(g,extra){ const d=Array.from({length:H},()=>Array(W).fill(99)); for(const b of g.bombs.concat(extra||[])) for(const [x,y] of blast(g,b)) d[y][x]=Math.min(d[y][x],b.t); for(const f of g.flames) d[f.y][f.x]=0; return d; }
const bombAt = (g,x,y) => g.bombs.some(b=>b.x===x&&b.y===y);
const free = (g,x,y) => inb(x,y) && g.map[y][x]===0 && !bombAt(g,x,y);

function bfs(g,bot,dm,goal){ // 다음 한 걸음
  const q=[[bot.x,bot.y,0,null]], seen=new Set([bot.x+','+bot.y]);
  while(q.length){ const [x,y,s,first]=q.shift();
    if(s>0&&goal(x,y,s)) return first;
    if(s>14) continue;
    for(const [dx,dy] of D4){ const X=x+dx,Y=y+dy,k=X+','+Y; if(seen.has(k)||!free(g,X,Y)) continue;
      const arrive=(s+1)*bot.step; if(dm[Y][X]<=arrive+1&&dm[Y][X]>=arrive-bot.step) continue; if(dm[Y][X]===0) continue;
      seen.add(k); q.push([X,Y,s+1,first||[dx,dy]]); } }
  return null;
}
const say = (g,b,txt) => g.bubbles.push({i:b.i,txt,t:14});

function think(g,b){
  const P=g.players[b.i], dm=dangerMap(g);
  if(dm[b.y][b.x]<99){ const m=bfs(g,b,dm,(x,y)=>dm[y][x]===99); return m?['m',m]:['w']; }
  if(Math.random()<P.r*.35){ const [dx,dy]=D4[rnd(4)]; return free(g,b.x+dx,b.y+dy)&&dm[b.y+dy][b.x+dx]===99?['m',[dx,dy]]:['w']; }
  const mine=g.bombs.filter(x=>x.o===b.i).length;
  if(mine<b.max&&!bombAt(g,b.x,b.y)){
    const nb={x:b.x,y:b.y,r:b.range,t:FUSE}, tiles=blast(g,nb);
    const hitsEnemy=g.bots.some(o=>o.alive&&o.i!==b.i&&tiles.some(([x,y])=>x===o.x&&y===o.y));
    const hitsSoft=tiles.some(([x,y])=>g.map[y][x]===2);
    const want=hitsEnemy?P.a*.9+.1:hitsSoft?(.25+.35*(1-P.a)):0;
    if(Math.random()<want){
      const careful=Math.random()<P.c*1.05;
      const dm2=dangerMap(g,[nb]); const esc=bfs(g,b,dm2,(x,y)=>dm2[y][x]===99);
      if(esc||!careful) return ['b'];
    }
  }
  const opts=[];
  for(const k in g.items){ const [x,y]=k.split(',').map(Number); opts.push({x,y,w:P.g*1.6}); }
  g.bots.forEach(o=>{ if(o.alive&&o.i!==b.i) opts.push({x:o.x,y:o.y,w:P.a*1.2,near:1}); });
  const m=bfs(g,b,dm,(x,y)=>{
    for(const o of opts){ if(o.near?Math.abs(o.x-x)+Math.abs(o.y-y)<=1&&Math.random()<o.w*.5:(o.x===x&&o.y===y&&Math.random()<o.w)) return true; }
    return D4.some(([dx,dy])=>inb(x+dx,y+dy)&&g.map[y+dy][x+dx]===2)&&Math.random()<.3+.4*(1-P.a);
  });
  return m?['m',m]:['w'];
}

// 한 틱 진행. g.events 에 로그 문자열이 쌓이고, 끝나면 g.over=true.
export function tick(g){
  if(g.over) return;
  g.t++; g.events=[];
  const P=i=>g.players[i];
  g.flames=g.flames.filter(f=>--f.t>0);
  for(const b of g.bombs) b.t--;
  const boom=g.bombs.filter(b=>b.t<=0);
  while(boom.length){ const b=boom.pop(); g.bombs=g.bombs.filter(x=>x!==b);
    for(const [x,y] of blast(g,b)){ g.flames.push({x,y,t:5,o:b.o});
      if(g.map[y][x]===2){ g.map[y][x]=0; if(Math.random()<.4) g.items[x+','+y]='RBS'[rnd(3)]; }
      else if(!(x===b.x&&y===b.y)) delete g.items[x+','+y];
      const c=g.bombs.find(o=>o.x===x&&o.y===y); if(c&&!boom.includes(c)){ c.t=0; boom.push(c); } } }
  for(const b of g.bots){ if(!b.alive) continue; const f=g.flames.find(f=>f.x===b.x&&f.y===b.y); if(!f) continue;
    b.alive=false; b.deathT=g.t;
    if(f.o===-1) g.events.push(`🌩 ${P(b.i).name} 잡음 폭풍에 탈락`);
    else if(f.o===b.i){ b.self++; g.events.push(`💥 ${P(b.i).name} 자폭`); say(g,b,'앗…'); }
    else { g.bots[f.o].kills++; g.events.push(`⚡ ${P(f.o).name} → ${P(b.i).name} 격파 (+1)`); say(g,g.bots[f.o],P(f.o).say); } }
  for(const b of g.bots){ if(!b.alive) continue; if(b.cd>0){ b.cd--; continue; }
    const [act,m]=think(g,b);
    if(act==='b'){ g.bombs.push({x:b.x,y:b.y,r:b.range,t:FUSE,o:b.i}); if(Math.random()<.25) say(g,b,P(b.i).say); b.cd=1; }
    else if(act==='m'){ b.x+=m[0]; b.y+=m[1]; b.cd=b.step-1;
      const k=b.x+','+b.y, it=g.items[k]; if(it){ delete g.items[k]; if(it==='R') b.range++; if(it==='B') b.max++; if(it==='S') b.step=Math.max(1,b.step-1); } } }
  if(g.t>420&&g.t%10===0){ const live=g.bots.filter(b=>b.alive), v=live[rnd(live.length)];
    if(v){ const X=v.x+rnd(5)-2, Y=v.y+rnd(5)-2; if(free(g,X,Y)) g.bombs.push({x:X,y:Y,r:2,t:FUSE,o:-1}); }
    if(g.t===430) g.events.push('🌩 잡음 폭풍 시작 — 버티기 금지'); }
  g.bubbles=g.bubbles.filter(x=>--x.t>0);
  const alive=g.bots.filter(b=>b.alive);
  if(alive.length<=1||g.t>MAX_T){ g.over=true; g.winner=alive.length===1?alive[0].i:null; }
}

// 브라우저로 보내는 가벼운 스냅샷
export const snapshot = g => ({
  t:g.t, map:g.map.map(r=>r.join('')), bombs:g.bombs.map(b=>[b.x,b.y,b.t,b.o]), flames:g.flames.map(f=>[f.x,f.y,f.t]),
  items:g.items, bots:g.bots.map(b=>[b.x,b.y,b.alive?1:0,b.range,b.max]), bubbles:g.bubbles.map(u=>[u.i,u.txt]),
  players:g.players.map(p=>p.name), over:g.over
});

// 결과: 생존 +3, 격파 +1
export const results = g => g.bots.map(b=>({name:g.players[b.i].name, pts:(g.winner===b.i?3:0)+b.kills, survived:g.winner===b.i, kills:b.kills, self:b.self, deathT:b.deathT}));
