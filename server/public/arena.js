// 공용: 경기장 그리기 + SSE 구독 + 로그/점수판 + 아바타 캐시. index.html, admin.html 둘 다 사용.
const W=15,H=11,COLS=['#1d3fb0','#e2553f','#1f9a6a','#d9930b','#8e44ad','#16a2b8','#c2185b','#5d4037'];
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const cv=document.getElementById('cv'),cx=cv.getContext('2d');
function rr(x,y,w,h,r){cx.beginPath();cx.roundRect(x,y,w,h,r);cx.fill()}
// 아바타: 팀명 → Image (버전 바뀌면 다시 로드). 없으면 null → 기본 햄스터
const AV={};
const avUrl=(name,v)=>`/api/avatar?name=${encodeURIComponent(name)}&v=${v}`;
const avVer=name=>window.STATE?.scoreboard.find(t=>t.name===name)?.av||0;
function avatar(name){const v=avVer(name);if(!v)return null;const k=name+'#'+v;
  if(!(k in AV)){AV[k]=null;const im=new Image();im.onload=()=>{AV[k]=im;if(window.STATE?.live)draw(window.STATE.live)};im.src=avUrl(name,v)}
  return AV[k]}
const avImg=(name,v,cls='av')=>v?`<img class="${cls}" src="${avUrl(name,v)}" alt="">`:`<span class="${cls}" style="display:inline-grid;place-items:center;font-size:.9em">🐹</span>`;
window.SUMO={SKILL:{dash:'날쌘 발',heavy:'묵직한 몸',blink:'순간 회피',counter:'반사 장갑'},
  WHEN:{always:'항상',cornered:'내가 가장자리에 몰림',enemy_near:'적이 가까움',enemy_dashing:'적이 대시해 옴',enemy_cornered:'적이 가장자리에 몰림',item_near:'아이템이 가까움',few_lives:'내 목숨이 1개',arena_small:'판이 작아짐',powered:'아이템 효과 중'},
  ACT:{attack:'가까운 적 들이받기',hunt:'몰린 적 밀어내기',item:'아이템 줍기',center:'중앙으로',evade:'적 피하기',circle:'적 주변 맴돌기',hold:'제자리 버티기'},
  rules:p=>p.rules.map(r=>`${r.name}(${SUMO.WHEN[r.when]}→${SUMO.ACT[r.act]} ${r.w})`).join(' · ')};
window.BOXING={STYLE:{out:'아웃복서',in:'인파이터',cnt:'카운터',brawl:'난타형'},SKIN:{wood:'원목',white:'하얀 석고',black:'검정 무광',chrome:'크롬',pink:'분홍 플라스틱'},COLORS:['#ff4d5e','#3fa2ff','#ffd23f','#4cd964','#b37bff','#ff8a2e','#ff6fc8','#f6f1e7']};
// 인생 시뮬레이션은 캔버스 대신 HTML(팀별 타임라인 SVG). #life 상자는 처음 쓸 때 캔버스 앞에 만든다.
const lifeBox=()=>{let d=document.getElementById('life');if(!d){d=document.createElement('div');d.id='life';d.hidden=true;cv.before(d)}return d};
const escL=s=>String(s??'').replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
function lifeSvg(l,end,age){
  const W=640,H=130,x=a=>14+a/end*(W-28),ys=v=>128-v*.28; // 스탯 0~100 → 세로 28px 띠
  let s=`<svg viewBox="0 0 ${W} ${H}" class="tl" preserveAspectRatio="none"><line x1="${x(0)}" y1="62" x2="${x(end)}" y2="62" stroke="currentColor" stroke-opacity=".35" stroke-width="1.5"/>`;
  for(let a=10;a<end;a+=10)s+=`<text x="${x(a)}" y="74" font-size="8" text-anchor="middle" fill="currentColor" fill-opacity=".5">${a}</text>`;
  const Y=l.years,last=Y.at(-1);
  for(const[k,c]of[['money','#d9930b'],['happy','#e2553f'],['health','#1f9a6a']])if(Y.length)s+=`<polyline points="${x(0)},${ys(50)} ${Y.map(y=>x(y.age)+','+ys(y[k])).join(' ')}" fill="none" stroke="${c}" stroke-width="1.5" stroke-opacity=".8"/>`;
  for(const y of Y){const X=x(y.age),cur=y===last;
    s+=`<g><title>${escL(y.age+'세 '+y.event+'\n→ '+y.did+(y.change?'\n('+y.change+')':'')+(y.alt?'\n안 간 길: '+y.alt:''))}</title>`;
    s+=`<path d="M${X},62 q6,-14 14,-26" fill="none" stroke="#1d3fb0" stroke-width="${cur?2.5:1.5}"/><circle cx="${X+14}" cy="36" r="${cur?3:2}" fill="#1d3fb0"/>`;
    if(y.alt)s+=`<path d="M${X},62 q6,14 14,26" fill="none" stroke="currentColor" stroke-opacity=".3" stroke-width="1.2" stroke-dasharray="3 2"/>`;
    s+=`<circle cx="${X}" cy="62" r="${cur?4:2.5}" fill="${cur?'#e2553f':'var(--ink)'}"/></g>`;
    if(cur&&!l.death)s+=`<text x="${Math.min(X+16,W-150)}" y="24" font-size="9" fill="currentColor">${escL(y.did.slice(0,28))}</text>`}
  if(l.death!=null)s+=`<text x="${x(l.death)}" y="58" font-size="14" text-anchor="middle">🕯</text>`;
  if(l.achievedAt!=null)s+=`<text x="${x(l.achievedAt)}" y="20" font-size="14" text-anchor="middle">🏁</text>`;
  s+=`<line x1="${x(age)}" y1="8" x2="${x(age)}" y2="${H}" stroke="#e2553f" stroke-opacity=".5" stroke-dasharray="2 3"/></svg>`;return s}
function drawLife(g){
  cv.hidden=true;const L=lifeBox();L.hidden=false;
  const head=g.err?`<div class="err">${escL(g.err)}</div>`:!g.ready?'<div class="note">🧬 인생 계산 중… 팀마다 인생 1회 + 심판 1회 (1~4분)</div>':
    `<div class="lbar"><i style="width:${Math.round(g.age/g.end*100)}%"></i></div><div class="note"><b>${g.age}세</b> / ${g.end}세 ${g.over?'· 인생 종료':''} · <i class="sw" style="background:#d9930b"></i>돈 <i class="sw" style="background:#e2553f"></i>행복 <i class="sw" style="background:#1f9a6a"></i>건강 · 위 가지 = 택한 길, 아래 점선 = 안 간 길 (마우스를 올리면 내용)</div>`;
  L.innerHTML=head+g.players.map((p,i)=>{const l=p.life,last=l?.years.at(-1);
    return `<div class="lcard"><div class="lh">${avImg(p.name,avVer(p.name),'av xs')}<b>${escL(p.name)}</b><small>🎯 ${escL(p.mission)}</small>${l?.achievedAt!=null?`<span class="chip">🏁 ${l.achievedAt}세 달성</span>`:l?.death!=null?`<span class="chip">🕯 ${l.death}세 사망</span>`:''}</div>
      ${l?lifeSvg(l,g.end,g.age)+`<div class="lnow">${last?`${last.age}세 ${escL(last.event)} → <b>${escL(last.did)}</b>${last.change?` <i>(${escL(last.change)})</i>`:''}${last.alt?` <small>· 안 간 길: ${escL(last.alt)}</small>`:''}`:'…'}</div>`+
      (g.over?`<div class="lsum"><b>${escL(l.job)}</b> — ${escL(l.summary)}${l.why?`<br><small>심판: ${escL(l.why)}</small>`:''}<details><summary>인생 전체 보기</summary>${l.years.map(y=>`<div>${y.age}세 ${escL(y.event)} → ${escL(y.did)}${y.change?` <i>(${escL(y.change)})</i>`:''}</div>`).join('')}</details></div>`:''):''}</div>`}).join('');
  document.getElementById('board').innerHTML='';
  for(const f of g.fx||[])if(f.k==='pop')addLog(`🏁 ${f.sub} 미션 달성!`);
}
function draw(g){
  if(g&&g.kind==='life')return drawLife(g);
  lifeBox().hidden=true;cv.hidden=false;
  if(g&&(g.kind==='sumo'||g.kind==='boxing'))return liveFeed(g);
  S.cur=null;cx.setTransform(1,0,0,1,0,0);if(cv.height!==440){cv.width=600;cv.height=440;cv.style.aspectRatio=''}
  drawBomb(g)}
function drawBomb(g){
  const s=cv.width/W;cx.clearRect(0,0,cv.width,cv.height);
  cx.fillStyle=css('--floor');cx.fillRect(0,0,cv.width,cv.height);
  if(!g){cx.fillStyle=css('--muted');cx.font=`700 ${s*.5}px 'Noto Sans KR',sans-serif`;cx.textAlign='center';cx.textBaseline='middle';cx.fillText('라운드 대기 중',cv.width/2,cv.height/2);return}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const v=g.map[y][x];
    if(v==='1'){cx.fillStyle=css('--wall');rr(x*s+3,y*s+3,s-6,s-6,8)}
    if(v==='2'){cx.fillStyle=css('--soft');rr(x*s+2,y*s+2,s-4,s-4,6);cx.strokeStyle=css('--line');cx.lineWidth=1.5;
      cx.beginPath();for(let k=0;k<3;k++){cx.moveTo(x*s+8,y*s+12+k*8);cx.lineTo(x*s+s-8,y*s+12+k*8)}cx.stroke()}}
  cx.font=`${s*.42}px 'Lilita One',sans-serif`;cx.textAlign='center';cx.textBaseline='middle';
  for(const k in g.items){const[x,y]=k.split(',').map(Number);cx.fillStyle='#d9930b';cx.beginPath();cx.arc(x*s+s/2,y*s+s/2,s*.28,0,7);cx.fill();cx.fillStyle=css('--panel');cx.fillText(g.items[k],x*s+s/2,y*s+s/2+1)}
  for(const[x,y,t]of g.flames){cx.globalAlpha=.35+t*.12;cx.fillStyle='#ff7a2f';rr(x*s+4,y*s+4,s-8,s-8,s/3);cx.globalAlpha=1}
  for(const[x,y,t,o]of g.bombs){const c=o<0?css('--muted'):COLS[o%8],p=1+.08*Math.sin(t);
    cx.fillStyle=c;cx.beginPath();cx.arc(x*s+s/2,y*s+s/2,s*.3*p,0,7);cx.fill();
    cx.strokeStyle=c;cx.lineWidth=2;for(let k=1;k<=2;k++){cx.globalAlpha=(t%6)/6;cx.beginPath();cx.arc(x*s+s/2,y*s+s/2,s*.3+k*5,-.8,.8);cx.stroke();cx.beginPath();cx.arc(x*s+s/2,y*s+s/2,s*.3+k*5,Math.PI-.8,Math.PI+.8);cx.stroke()}cx.globalAlpha=1}
  g.bots.forEach(([x,y,alive],i)=>{if(!alive)return;const X=x*s+s/2,Y=y*s+s/2,c=COLS[i%8],im=avatar(g.players[i]);
    if(im){cx.save();cx.beginPath();cx.arc(X,Y,s*.42,0,7);cx.fillStyle=c;cx.fill();cx.clip();cx.drawImage(im,X-s*.4,Y-s*.4,s*.8,s*.8);cx.restore();
      cx.strokeStyle=c;cx.lineWidth=2.5;cx.beginPath();cx.arc(X,Y,s*.42,0,7);cx.stroke();
      cx.fillStyle=c;cx.beginPath();cx.arc(X+s*.3,Y+s*.3,s*.15,0,7);cx.fill();cx.fillStyle='#fff';cx.font=`${s*.2}px 'Lilita One',sans-serif`;cx.fillText(i+1,X+s*.3,Y+s*.31);return}
    cx.fillStyle=c;cx.beginPath();cx.arc(X-s*.2,Y-s*.24,s*.12,0,7);cx.arc(X+s*.2,Y-s*.24,s*.12,0,7);cx.fill();
    cx.beginPath();cx.arc(X,Y+2,s*.33,0,7);cx.fill();
    cx.fillStyle=css('--panel');cx.beginPath();cx.arc(X-s*.11,Y-1,s*.05,0,7);cx.arc(X+s*.11,Y-1,s*.05,0,7);cx.fill();
    cx.font=`${s*.26}px 'Lilita One',sans-serif`;cx.fillText(i+1,X,Y+s*.17)});
  cx.font=`700 ${s*.3}px 'Noto Sans KR',sans-serif`;
  for(const[i,txt]of g.bubbles){const[bx0,by0]=g.bots[i],X=bx0*s+s/2,Y=by0*s-4,w=cx.measureText(txt).width+14;
    const bx=Math.min(Math.max(X-w/2,2),cv.width-w-2),by=Math.max(Y-s*.5,2);
    cx.fillStyle=css('--panel');cx.strokeStyle=COLS[i%8];cx.lineWidth=2;rr(bx,by,w,s*.48,8);cx.stroke();
    cx.fillStyle=css('--fg');cx.fillText(txt,bx+w/2,by+s*.25)}
  document.getElementById('board').innerHTML=g.bots.map(([x,y,alive,range,max],i)=>`<span class="chip" style="border-color:${COLS[i%8]}">${avImg(g.players[i],avVer(g.players[i]),'av xs')}${i+1} ${g.players[i]} ${alive?`· 범위${range} 폭탄${max}`:'· 탈락'}</span>`).join('');
}
// ---- 생중계 종목(햄볼 대난투·마네킹 복싱): 서버 스냅샷(50ms마다)을 받아 두 스냅샷 사이를 rAF로 보간해 그린다. 연출(불꽃·큰 글씨·꽃가루)은 클라이언트 수명 ----
const S={prev:null,cur:null,at:0,raf:0,fx:[],pops:[],flash:[],shake:0,cam:0,last:0},SC=['#ff5a5f','#3fa9ff','#b37bff','#4cd964','#ffb02e','#ff6fc8','#2ee6d6','#f6f1cf'];
function liveFeed(g){
  const fresh=!S.cur||g.t<S.cur.t||S.cur.kind!==g.kind; // 새 경기
  if(fresh){S.prev=null;S.fx=[];S.pops=[];S.flash=[];S.shake=0;S.cam=0}
  else if(S.cur.t===g.t){S.cur=g;return}
  else S.prev=S.cur;
  const wasOver=!fresh&&!!S.cur?.over;S.cur=g;S.at=performance.now();
  if(g.kind==='boxing'){
    if(fresh)S.pops.push({text:'ROUND 1',sub:`${g.players[0]} vs ${g.players[1]}`,life:1.4,max:1.4,c:'#ffd23f'});
    boxEvents(g);
    document.getElementById('board').innerHTML=g.f.map((b,i)=>`<span class="chip" style="border-color:${BX.CORNER[i]}">${avImg(g.players[i],avVer(g.players[i]),'av xs')}${i+1} ${g.players[i]} · 체력 ${b.hp} · 다운 ${'●'.repeat(b.downs)}${'○'.repeat(3-b.downs)}</span>`).join('');
  } else {
    for(const f of g.fx){
      if(f.k==='spark'){const n=Math.min(24,4+f.power/35);for(let k=0;k<n;k++){const a=Math.random()*7,v=60+Math.random()*(80+f.power*.5);S.fx.push({k:'spark',x:f.x,y:f.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:.5,max:.6})}}
      else if(f.k==='pop')S.fx.push({...f,life:f.small?.9:1.3,max:f.small?.9:1.3});
      else if(f.k==='splash')S.fx.push({...f,c:SC[f.i%8],life:.6,max:.6});
      else S.fx.push({...f,life:.45,max:.45})}
    if(g.over&&!wasOver)for(let k=0;k<90;k++)S.fx.push({k:'confetti',x:(Math.random()-.5)*500,y:-330-Math.random()*120,vx:(Math.random()-.5)*80,vy:120+Math.random()*160,life:3.5,max:3.5,c:SC[Math.floor(Math.random()*8)],rot:Math.random()*6});
    document.getElementById('board').innerHTML=g.bots.map((b,i)=>`<span class="chip" style="border-color:${SC[i%8]}">${avImg(g.players[i],avVer(g.players[i]),'av xs')}${i+1} ${g.players[i]} ${b[4]?'· 탈락':'· '+'●'.repeat(b[3])+'○'.repeat(3-b[3])+' KO '+b[10]+(b[14]?' · '+b[14]:'')}</span>`).join('');
  }
  if(!S.raf){S.last=performance.now();S.raf=requestAnimationFrame(liveLoop)}}
function liveLoop(now){
  if(!S.cur||!cv.isConnected){S.raf=0;return}
  const dt=Math.min(.05,(now-S.last)/1000);S.last=now;
  for(const f of S.fx){f.life-=dt;
    if(f.k==='bspark'){f.x+=f.vx*dt;f.y+=f.vy*dt;f.vy-=6*dt}
    else if(f.k==='bconf'){f.sx+=f.vx*dt;f.sy+=f.vy*dt}
    else if(f.vx!==undefined){f.x+=f.vx*dt;f.y+=f.vy*dt;if(f.k==='spark'){f.vx*=.9;f.vy*=.9}}}
  S.fx=S.fx.filter(f=>f.life>0);
  for(const l of[S.pops,S.flash])for(const b of l)b.life-=dt;
  S.pops=S.pops.filter(p=>p.life>0);S.flash=S.flash.filter(f=>f.life>0);S.shake=Math.max(0,S.shake-dt*40);
  (S.cur.kind==='boxing'?drawBoxing:drawSumo)(now);S.raf=requestAnimationFrame(liveLoop)}
function drawSumo(now){
  const g=S.cur,p0=S.prev,k=p0?Math.min(1,(now-S.at)/50):1;
  if(cv.height!==600){cv.width=cv.height=600;cv.style.aspectRatio='1'}
  const bots=g.bots.map((b,i)=>{const a=p0&&p0.bots[i];return a?[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,...b.slice(2)]:b}),r=p0?p0.r+(g.r-p0.r)*k:g.r;
  cx.setTransform(1,0,0,1,0,0);cx.fillStyle='#0a0f28';cx.fillRect(0,0,600,600);cx.setTransform(1,0,0,1,300,300);
  cx.beginPath();cx.arc(0,10,r+6,0,7);cx.fillStyle='#05081a';cx.fill();
  if(r<280){cx.beginPath();cx.arc(0,0,280,0,7);cx.setLineDash([6,8]);cx.strokeStyle='rgba(255,77,109,.35)';cx.lineWidth=2;cx.stroke();cx.setLineDash([])}
  const gr=cx.createRadialGradient(0,-40,20,0,0,r);gr.addColorStop(0,'#2f3d96');gr.addColorStop(1,'#1f2a6e');cx.beginPath();cx.arc(0,0,r,0,7);cx.fillStyle=gr;cx.fill();
  cx.strokeStyle='rgba(246,241,207,.07)';cx.lineWidth=2;
  for(let i=0;i<16;i++){const a=i/16*Math.PI*2+g.t*.15;cx.beginPath();cx.moveTo(Math.cos(a)*30,Math.sin(a)*30);cx.lineTo(Math.cos(a)*r,Math.sin(a)*r);cx.stroke()}
  cx.beginPath();cx.arc(0,0,r*.5,0,7);cx.stroke();
  cx.beginPath();cx.arc(0,0,r,0,7);cx.lineWidth=7;cx.strokeStyle=r<170?`rgba(255,77,109,${.55+.45*(.5+.5*Math.sin(now/120))})`:'#ffd23f';cx.stroke();
  for(const[x,y,kind]of g.items){cx.save();cx.translate(x,y+Math.sin(now/260+x)*3);cx.beginPath();cx.arc(0,0,14,0,7);cx.fillStyle='#0d1330';cx.fill();cx.lineWidth=3;
    if(kind==='speed'){cx.strokeStyle='#ffd23f';cx.stroke();cx.rotate(now/200);for(let i=0;i<6;i++){cx.rotate(Math.PI/3);cx.beginPath();cx.moveTo(0,0);cx.lineTo(9,0);cx.stroke()}}
    else if(kind==='shield'){cx.strokeStyle='#7fd3ff';cx.stroke();cx.beginPath();for(let i=0;i<6;i++){const a=i/6*Math.PI*2;cx.lineTo(Math.cos(a)*8,Math.sin(a)*8)}cx.closePath();cx.fillStyle='#7fd3ff';cx.fill()}
    else{cx.strokeStyle='#ff6fc8';cx.stroke();for(const q of[4,8]){cx.beginPath();cx.arc(-4,4,q,-Math.PI/2,0);cx.stroke()}}
    cx.restore()}
  for(const f of S.fx){const t=1-f.life/f.max;
    if(f.k==='ring'){cx.globalAlpha=1-t;cx.beginPath();cx.arc(f.x,f.y,f.r0+(f.r1-f.r0)*t,0,7);cx.strokeStyle=f.c;cx.lineWidth=f.w||3;cx.stroke()}
    else if(f.k==='splash'){cx.globalAlpha=1-t;cx.beginPath();cx.arc(f.x,f.y,10+50*t,0,7);cx.strokeStyle=f.c;cx.lineWidth=4;cx.stroke()}
    else if(f.k==='ghost'){cx.globalAlpha=(1-t)*.5;ball(f.x,f.y,g.bots[f.i][2],f.i,g.players[f.i],0,false)}
    cx.globalAlpha=1}
  bots.map((b,i)=>[b,i]).sort((a,b)=>a[0][1]-b[0][1]).forEach(([b,i])=>{const[x,y,r0,,out,fall,resp,,shield,boost,,face,inv,cd]=b;if(out||resp)return;
    let rr=r0,al=1;if(fall>0){const q=1-fall/.6;rr=r0*(1-.8*q);al=1-q*.8}
    if(inv&&Math.floor(now/90)%2)al*=.45;cx.globalAlpha=al;
    if(shield){cx.beginPath();cx.arc(x,y,rr+6,0,7);cx.strokeStyle='#7fd3ff';cx.lineWidth=3;cx.stroke()}
    if(boost){cx.beginPath();cx.arc(x,y,rr+3,0,7);cx.strokeStyle='#ffd23f';cx.setLineDash([4,4]);cx.lineWidth=2;cx.stroke();cx.setLineDash([])}
    ball(x,y,rr,i,g.players[i],Math.sin(face)*.25+(fall>0?(1-fall/.6)*4:0),fall>0);cx.globalAlpha=1;
    if(fall<=0){cx.font='14px "Lilita One","Noto Sans KR",sans-serif';cx.textAlign='center';cx.textBaseline='bottom';cx.lineWidth=4;cx.strokeStyle='#0a0f28';cx.strokeText(g.players[i],x,y-rr-10);cx.fillStyle=SC[i%8];cx.fillText(g.players[i],x,y-rr-10);
      cx.beginPath();cx.arc(x,y+rr+6,3,0,7);cx.fillStyle=cd?'rgba(246,241,207,.25)':'#ffd23f';cx.fill()}});
  for(const f of S.fx){const t=1-f.life/f.max;
    if(f.k==='spark'){cx.globalAlpha=1-t;cx.fillStyle=t<.3?'#fff':'#ffd23f';cx.fillRect(f.x-2,f.y-2,4,4)}
    else if(f.k==='confetti'){cx.save();cx.translate(f.x,f.y);cx.rotate(f.rot+t*10);cx.globalAlpha=Math.min(1,f.life);cx.fillStyle=f.c;cx.fillRect(-4,-2,8,4);cx.restore()}
    cx.globalAlpha=1}
  cx.font='700 15px "Noto Sans KR",sans-serif';cx.textAlign='center';cx.textBaseline='middle';
  for(const[i,txt]of g.bubbles){const b=bots[i];if(b[4]&&!g.over)continue;const x=b[0],y=b[1]-b[2]-34,w=cx.measureText(txt).width+18,h=26;
    cx.fillStyle='#f6f1cf';cx.beginPath();cx.roundRect(x-w/2,y-h,w,h,9);cx.fill();cx.beginPath();cx.moveTo(x-6,y);cx.lineTo(x+6,y);cx.lineTo(x,y+7);cx.closePath();cx.fill();
    cx.fillStyle='#141a3a';cx.fillText(txt,x,y-h/2+1)}
  for(const f of S.fx){if(f.k!=='pop')continue;const t=1-f.life/f.max,sc=t<.15?.6+t/.15*.5:1.1-(t-.15)*.15;
    cx.globalAlpha=Math.min(1,f.life/.3);cx.save();cx.scale(sc,sc);
    cx.font=`900 ${f.small?44:64}px "Noto Sans KR",sans-serif`;cx.lineWidth=10;cx.strokeStyle='#0a0f28';cx.strokeText(f.text,0,-20);cx.fillStyle=f.small?'#7fd3ff':'#ff4d6d';cx.fillText(f.text,0,-20);
    cx.font='700 20px "Noto Sans KR",sans-serif';cx.lineWidth=6;cx.strokeText(f.sub,0,28);cx.fillStyle='#f6f1cf';cx.fillText(f.sub,0,28);cx.restore();cx.globalAlpha=1}
  if(g.over&&g.winner!=null){cx.font='34px "Lilita One",sans-serif';cx.lineWidth=8;cx.strokeStyle='#0a0f28';cx.strokeText('WINNER',0,210);cx.fillStyle='#ffd23f';cx.fillText('WINNER',0,210);
    cx.font='900 30px "Noto Sans KR",sans-serif';cx.strokeText(g.players[g.winner],0,250);cx.fillStyle=SC[g.winner%8];cx.fillText(g.players[g.winner],0,250)}
  cx.font='18px "Lilita One",sans-serif';cx.textAlign='right';cx.textBaseline='top';cx.fillStyle='#ffd23f';cx.fillText(`${Math.floor(g.t/60)}:${String(Math.floor(g.t%60)).padStart(2,'0')}`,290,-290)}
// 공 속 햄스터. 아바타가 있으면 공 안에 아바타, 없으면 기본 햄스터 얼굴
function ball(x,y,r,i,name,tilt,ko){const c=SC[i%8],im=avatar(name),s=r/18;
  cx.save();cx.translate(x,y);
  cx.beginPath();cx.arc(0,0,r,0,7);cx.fillStyle=c+'38';cx.fill();cx.lineWidth=Math.max(2,r*.13);cx.strokeStyle=c;cx.stroke();
  cx.beginPath();cx.arc(-r*.35,-r*.4,r*.28,Math.PI*1.05,Math.PI*1.6);cx.strokeStyle='rgba(255,255,255,.55)';cx.lineWidth=Math.max(1.5,r*.08);cx.stroke();
  cx.rotate(tilt);
  if(im){cx.beginPath();cx.arc(0,0,r*.78,0,7);cx.clip();cx.drawImage(im,-r*.78,-r*.78,r*1.56,r*1.56);if(ko){cx.fillStyle='rgba(10,15,40,.5)';cx.fillRect(-r,-r,2*r,2*r)}cx.restore();return}
  cx.fillStyle='#f3c58f';cx.beginPath();cx.arc(-7*s,-7*s,3.6*s,0,7);cx.arc(7*s,-7*s,3.6*s,0,7);cx.fill();
  cx.fillStyle='#e89aa0';cx.beginPath();cx.arc(-7*s,-7*s,1.8*s,0,7);cx.arc(7*s,-7*s,1.8*s,0,7);cx.fill();
  cx.fillStyle='#f3c58f';cx.beginPath();cx.ellipse(0,s,11*s,10*s,0,0,7);cx.fill();
  cx.fillStyle='#fff4e0';cx.beginPath();cx.ellipse(0,5*s,6.5*s,5*s,0,0,7);cx.fill();
  cx.fillStyle='#1b1b1b';
  if(ko){cx.lineWidth=1.4*s;cx.strokeStyle='#1b1b1b';for(const ex of[-4,4]){cx.beginPath();cx.moveTo(ex*s-2*s,-2*s);cx.lineTo(ex*s+2*s,2*s);cx.moveTo(ex*s+2*s,-2*s);cx.lineTo(ex*s-2*s,2*s);cx.stroke()}}
  else{cx.beginPath();cx.arc(-4*s,0,1.6*s,0,7);cx.arc(4*s,0,1.6*s,0,7);cx.fill()}
  cx.fillStyle='#e8778a';cx.beginPath();cx.arc(0,2.8*s,1.2*s,0,7);cx.fill();
  cx.fillStyle='rgba(232,119,138,.45)';cx.beginPath();cx.arc(-7*s,3.5*s,2*s,0,7);cx.arc(7*s,3.5*s,2*s,0,7);cx.fill();
  cx.restore()}
// ---- 마네킹 복싱: 마네킹복싱.html 시제품의 링·마네킹·HUD 그리기 이식. 월드 단위(m) → 화면은 W(x,y) ----
const BX={RING:2.9,CORNER:['#ff4d5e','#3fa2ff'],COLORS:BOXING.COLORS,
  SKIN:{wood:{c:'#d6a878',j:'#a87a4e'},white:{c:'#ece6da',j:'#b9b1a2'},black:{c:'#4a4552',j:'#2b2731'},chrome:{c:'#b9c6d4',j:'#7d8a99'},pink:{c:'#f3b6c6',j:'#cf8599'}},
  POSE:[[0,.89],[-.01,1.39],[-.015,1.63],[-.256,1.218],[-.282,1.517],[-.222,1.178],[-.222,1.478],[-.251,.505],[-.18,.04],[.04,.432],[.3,.04]], // 서 있는 자세(초상화용), boxing.js poseTargets 출력
  CROWD:Array.from({length:90},(_,k)=>({x:(k*.6180339)%1,row:k%3,h:.7+((k*7919)%13)/30}))};
const PI=Math.PI,FONT_B='"Black Han Sans","Noto Sans KR",sans-serif';
function shade(hex,k){const n=parseInt(hex.slice(1),16),f=c=>Math.max(0,Math.min(255,Math.round(c*k)));return `rgb(${f(n>>16)},${f((n>>8)&255)},${f(n&255)})`}
function limb(c,a,b,w,col){c.strokeStyle=col;c.lineWidth=w;c.beginPath();c.moveTo(a[0],a[1]);c.lineTo(b[0],b[1]);c.stroke()}
function star(c,x,y,r,col,n=5){c.fillStyle=col;c.beginPath();for(let k=0;k<n*2;k++){const a=k/(n*2)*PI*2-PI/2,rr=k%2?r*.45:r;c.lineTo(x+Math.cos(a)*rr,y+Math.sin(a)*rr)}c.closePath();c.fill()}
// F:{p:[{x,y}×11], f:바라보는 방향}, look:{skin,glove,trunk}, W:월드→화면(W.s 배율)
function drawMannequin(c,F,look,W,ko){
  const sk=BX.SKIN[look.skin]||BX.SKIN.wood,q=F.p,back=shade(sk.c,.72),gl=BX.COLORS[look.glove]||BX.COLORS[0],tr=BX.COLORS[look.trunk]||BX.COLORS[1];
  const pt=j=>W(q[j].x,q[j].y),u=W.s,f=F.f;
  c.lineCap='round';c.lineJoin='round';
  const P0=pt(0),C0=pt(1),H0=pt(2);
  limb(c,P0,pt(9),.13*u,back);limb(c,pt(9),pt(10),.11*u,back);
  c.fillStyle='#222';c.beginPath();c.ellipse(pt(10)[0]+f*.04*u,pt(10)[1],.09*u,.04*u,0,0,7);c.fill();
  limb(c,C0,pt(5),.1*u,back);limb(c,pt(5),pt(6),.09*u,back);
  c.fillStyle=shade(gl,.7);c.beginPath();c.arc(pt(6)[0],pt(6)[1],.11*u,0,7);c.fill();
  limb(c,P0,C0,.25*u,sk.c);
  const mid=[P0[0]*.6+C0[0]*.4,P0[1]*.6+C0[1]*.4];
  c.fillStyle=shade(sk.c,1.08);c.beginPath();c.arc(C0[0]+f*.04*u,C0[1]+.06*u,.08*u,0,7);c.fill();
  limb(c,P0,[P0[0]+(mid[0]-P0[0])*.5,P0[1]+(mid[1]-P0[1])*.5],.29*u,tr);
  c.fillStyle=tr;c.beginPath();c.arc(P0[0],P0[1]+.05*u,.145*u,0,7);c.fill();
  limb(c,[P0[0]-.16*u,P0[1]-.12*u],[P0[0]+.16*u,P0[1]-.12*u],.035*u,'#f6f1e7');
  const na=Math.atan2(H0[1]-C0[1],H0[0]-C0[0]);
  limb(c,C0,H0,.09*u,sk.j);
  c.save();c.translate(H0[0],H0[1]);c.rotate(na+PI/2);
  c.fillStyle=sk.c;c.beginPath();c.ellipse(0,-.02*u,.115*u,.15*u,0,0,7);c.fill();
  c.fillStyle='rgba(255,255,255,.28)';c.beginPath();c.ellipse(-f*.04*u,-.07*u,.03*u,.06*u,-.3*f,0,7);c.fill();
  if(ko){c.strokeStyle='#1b1b1b';c.lineWidth=.018*u;for(const ex of[0,.07]){const x=f*ex*u,y=-.02*u;c.beginPath();c.moveTo(x-.022*u,y-.022*u);c.lineTo(x+.022*u,y+.022*u);c.moveTo(x+.022*u,y-.022*u);c.lineTo(x-.022*u,y+.022*u);c.stroke()}}
  else{c.fillStyle=shade(sk.j,.8);c.beginPath();c.ellipse(f*.1*u,0,.02*u,.035*u,0,0,7);c.fill()}
  c.restore();
  limb(c,P0,pt(7),.14*u,sk.c);limb(c,pt(7),pt(8),.12*u,sk.c);
  c.fillStyle=sk.j;c.beginPath();c.arc(pt(7)[0],pt(7)[1],.055*u,0,7);c.fill();
  c.fillStyle='#222';c.beginPath();c.ellipse(pt(8)[0]+f*.04*u,pt(8)[1],.1*u,.045*u,0,0,7);c.fill();
  limb(c,C0,pt(3),.11*u,sk.c);limb(c,pt(3),pt(4),.1*u,sk.c);
  c.fillStyle=sk.j;for(const a of[C0,pt(3)]){c.beginPath();c.arc(a[0],a[1],.05*u,0,7);c.fill()}
  const G4=pt(4);
  c.fillStyle=gl;c.beginPath();c.arc(G4[0],G4[1],.115*u,0,7);c.fill();
  c.fillStyle='rgba(255,255,255,.35)';c.beginPath();c.arc(G4[0]-.035*u,G4[1]-.04*u,.04*u,0,7);c.fill();
  limb(c,[pt(3)[0]*.25+G4[0]*.75,pt(3)[1]*.25+G4[1]*.75],[pt(3)[0]*.35+G4[0]*.65,pt(3)[1]*.35+G4[1]*.65],.13*u,'#f6f1e7');
}
// 서버 엔진 이벤트(hit/block/down/…) → 화면 연출
function boxEvents(g){
  for(const e of g.fx){
    if(e.type==='hit'){const big=e.big;S.pops.push({word:big?'쾅!':['퍽!','빡!','팍!'][Math.floor(Math.random()*3)],x:e.x,y:e.y,life:big?.7:.45,max:big?.7:.45,big,c:BX.CORNER[e.by]});
      for(let k=0,n=big?22:10;k<n;k++){const a=Math.random()*7,v=1+Math.random()*(big?4:2.2);S.fx.push({k:'bspark',x:e.x,y:e.y,vx:Math.cos(a)*v,vy:Math.sin(a)*v,life:.3+Math.random()*.25,max:.55})}
      S.fx.push({k:'burst',x:e.x,y:e.y,life:.18,max:.18,r:big?.32:.2});S.shake=Math.max(S.shake,big?12:4);
      if(big)for(let k=0;k<6;k++)S.flash.push({x:Math.random(),y:Math.random(),life:.25+Math.random()*.3})}
    else if(e.type==='block')S.fx.push({k:'bring',x:e.x,y:e.y,life:.25,max:.25,c:'#7fd3ff'});
    else if(e.type==='down'){S.pops.push({text:'DOWN!',sub:`${g.players[e.by]} → ${g.players[e.who]}`,life:1.5,max:1.5,c:'#ff4d5e'});for(let k=0;k<14;k++)S.flash.push({x:Math.random(),y:Math.random(),life:.2+Math.random()*.5})}
    else if(e.type==='slip'){const F=g.f[e.who];S.pops.push({word:'미끄덩',x:F.p[1][0],y:F.p[1][1]+.4,life:.9,max:.9,big:true,c:'#b3a9c9'})}
    else if(e.type==='count')S.pops.push({count:e.n,life:.4,max:.4});
    else if(e.type==='bell')S.pops.push({text:'FIGHT!',sub:'',life:.8,max:.8,c:'#ffd23f'});
    else if(e.type==='round')S.pops.push({text:`ROUND ${e.round}`,sub:'',life:1,max:1,c:'#ffd23f'});
    else if(e.type==='end'){S.pops.push({text:e.how==='판정'?'판정승':e.how==='TKO'?'T.K.O.':'K.O.!',sub:g.players[e.winner],life:3.6,max:3.6,c:'#ffd23f'});
      for(let k=0;k<110;k++)S.fx.push({k:'bconf',sx:Math.random(),sy:-.1-Math.random()*.3,vx:(Math.random()-.5)*.1,vy:.2+Math.random()*.25,life:3.6,max:3.6,c:BX.COLORS[Math.floor(Math.random()*8)],rot:Math.random()*6})}
  }}
function drawBoxing(now){
  const g=S.cur,p0=S.prev,k=p0?Math.min(1,(now-S.at)/50):1;
  if(cv.height!==540){cv.width=960;cv.height=540;cv.style.aspectRatio='16/9'}
  const Wd=960,Hd=540,F=g.f.map((b,i)=>({...b,p:b.p.map((q,j)=>{const a=p0&&p0.f[i].p[j];return a?{x:a[0]+(q[0]-a[0])*k,y:a[1]+(q[1]-a[1])*k}:{x:q[0],y:q[1]}})}));
  const viewW=5,s=Wd/viewW,ground=Hd*.87,mid=(F[0].p[0].x+F[1].p[0].x)/2,lim=BX.RING+.7-viewW/2;
  S.cam+=(Math.max(-lim,Math.min(lim,mid))-S.cam)*.08;
  const shx=S.shake?(Math.random()-.5)*S.shake:0,shy=S.shake?(Math.random()-.5)*S.shake:0;
  const W=(x,y)=>[(x-S.cam)*s+Wd/2+shx,ground-y*s+shy];W.s=s;
  cx.setTransform(1,0,0,1,0,0);
  const bg=cx.createLinearGradient(0,0,0,Hd);bg.addColorStop(0,'#07050c');bg.addColorStop(.6,'#1a1028');bg.addColorStop(1,'#0b0812');cx.fillStyle=bg;cx.fillRect(0,0,Wd,Hd);
  for(const c of BX.CROWD){const x=((c.x*1.4-.2-S.cam*.02*(c.row+1))%1.4+1.4)%1.4*Wd-.2*Wd,y=Hd*(.36+c.row*.08),r=Wd*.018*(1+c.row*.25);
    cx.fillStyle=['#140d20','#1b1229','#221733'][c.row];cx.beginPath();cx.arc(x,y-r*c.h,r*.7,0,7);cx.fill();cx.fillRect(x-r,y-r*c.h+r*.4,r*2,Hd)}
  for(const f of S.flash){cx.globalAlpha=Math.min(1,f.life*3);cx.fillStyle='#fff';cx.beginPath();cx.arc(f.x*Wd,Hd*(.25+f.y*.3),3,0,7);cx.fill();cx.globalAlpha=1}
  const sp=cx.createRadialGradient(Wd/2,ground-Hd*.25,10,Wd/2,ground-Hd*.25,Wd*.55);sp.addColorStop(0,'rgba(255,240,200,.16)');sp.addColorStop(1,'rgba(255,240,200,0)');cx.fillStyle=sp;cx.fillRect(0,0,Wd,Hd);
  const L=W(-BX.RING-.2,0),R=W(BX.RING+.2,0);
  cx.fillStyle='#2b5fa8';cx.fillRect(L[0],ground+shy,R[0]-L[0],Hd*.06);cx.fillStyle='#1d3f73';cx.fillRect(L[0],ground+Hd*.06+shy,R[0]-L[0],Hd*.12);
  cx.fillStyle='rgba(255,255,255,.08)';cx.fillRect(W(-.9,0)[0],ground+Hd*.012+shy,s*1.8,Hd*.03);
  for(const[x,col]of[[-BX.RING,'#ff4d5e'],[BX.RING,'#3fa2ff']]){const b0=W(x,0),t0=W(x,1.4);cx.fillStyle=col;cx.fillRect(b0[0]-.05*s,t0[1],.1*s,b0[1]-t0[1])}
  for(const[h,col]of[[.45,'#c9c2d8'],[.8,'#ff4d5e'],[1.15,'#c9c2d8']]){const a=W(-BX.RING,h+.12),b=W(BX.RING,h+.12);cx.strokeStyle=shade(col,.55);cx.lineWidth=.025*s;cx.beginPath();cx.moveTo(a[0],a[1]);cx.lineTo(b[0],b[1]);cx.stroke()}
  for(const f of F){const c=W(f.p[0].x,0);cx.fillStyle='rgba(0,0,0,.35)';cx.beginPath();cx.ellipse(c[0],c[1]+.02*s,.45*s,.06*s,0,0,7);cx.fill()}
  F.map((f,i)=>[f,i]).sort((a,b)=>(a[0].mode==='up')-(b[0].mode==='up')).forEach(([f,i])=>drawMannequin(cx,f,g.look[i],W,f.mode==='down'&&!f.slip));
  for(const f of F)if(f.mode==='down'||f.stun){const h=W(f.p[2].x,f.p[2].y+.2);for(let k=0;k<3;k++){const a=now/300+k*2.1;star(cx,h[0]+Math.cos(a)*.14*s,h[1]+Math.sin(a)*.04*s,.04*s,'#ffd23f')}}
  for(const h of[.45,.8,1.15]){const a=W(-BX.RING,h),b=W(BX.RING,h);cx.strokeStyle='rgba(246,241,231,.28)';cx.lineWidth=.03*s;cx.beginPath();cx.moveTo(a[0],a[1]);cx.lineTo(b[0],b[1]);cx.stroke()}
  for(const f of S.fx){const t=1-f.life/f.max;
    if(f.k==='bspark'){const p=W(f.x,f.y);cx.globalAlpha=1-t;cx.fillStyle=t<.3?'#fff':'#ffd23f';cx.fillRect(p[0]-2,p[1]-2,4,4)}
    else if(f.k==='burst'){const p=W(f.x,f.y);cx.globalAlpha=1-t;star(cx,p[0],p[1],f.r*s*(.6+t),'#fff6c8',10)}
    else if(f.k==='bring'){const p=W(f.x,f.y);cx.globalAlpha=1-t;cx.strokeStyle=f.c;cx.lineWidth=3;cx.beginPath();cx.arc(p[0],p[1],(.08+.2*t)*s,0,7);cx.stroke()}
    else if(f.k==='bconf'){cx.save();cx.translate(f.sx*Wd,f.sy*Hd);cx.rotate(f.rot+t*10);cx.globalAlpha=Math.min(1,f.life);cx.fillStyle=f.c;cx.fillRect(-5,-2.5,10,5);cx.restore()}
    cx.globalAlpha=1}
  cx.textAlign='center';cx.textBaseline='middle';
  for(const p of S.pops)if(p.word){const t=1-p.life/p.max,q=W(p.x,p.y+.25+t*.15),sz=(p.big?.34:.22)*s*(t<.15?.6+t/.15*.5:1.1);
    cx.globalAlpha=Math.min(1,p.life/.15);cx.font=`${sz}px ${FONT_B}`;cx.lineWidth=sz*.16;cx.strokeStyle='#120d1c';cx.strokeText(p.word,q[0],q[1]);cx.fillStyle=p.big?'#ffd23f':'#fff6c8';cx.fillText(p.word,q[0],q[1]);cx.globalAlpha=1}
  for(const[i,txt]of g.bubbles){const f=F[i],h=W(f.p[2].x-f.f*.05,Math.max(f.p[2].y,.4)+.24),fs=Math.max(13,.12*s);
    cx.font=`${fs}px ${FONT_B}`;const w=cx.measureText(txt).width+fs*1.1,hh=fs*1.7;
    cx.fillStyle='#f6f1e7';cx.beginPath();cx.roundRect(h[0]-w/2,h[1]-hh,w,hh,fs*.5);cx.fill();cx.beginPath();cx.moveTo(h[0]-fs*.4,h[1]);cx.lineTo(h[0]+fs*.4,h[1]);cx.lineTo(h[0],h[1]+fs*.45);cx.closePath();cx.fill();
    cx.fillStyle='#120d1c';cx.fillText(txt,h[0],h[1]-hh/2+1)}
  boxHud(g,Wd,Hd);
  const U=Wd/900;
  for(const p of S.pops){if(p.word)continue;const t=1-p.life/p.max,sc=t<.12?.5+t/.12*.6:1.1-(t-.12)*.12;
    cx.globalAlpha=Math.min(1,p.life/.25);cx.save();cx.translate(Wd/2,Hd*.42);cx.scale(sc,sc);cx.textAlign='center';cx.textBaseline='middle';
    if(p.count){cx.font=`${130*U}px "Lilita One",sans-serif`;cx.lineWidth=14*U;cx.strokeStyle='#120d1c';cx.strokeText(String(p.count),0,0);cx.fillStyle='#f6f1e7';cx.fillText(String(p.count),0,0)}
    else{const latin=/^[A-Z.! 0-9]+$/.test(p.text);cx.font=`${(latin?104:92)*U}px ${latin?'"Lilita One",sans-serif':FONT_B}`;cx.lineWidth=14*U;cx.strokeStyle='#120d1c';cx.strokeText(p.text,0,0);cx.fillStyle=p.c;cx.fillText(p.text,0,0);
      if(p.sub){cx.font=`${34*U}px ${FONT_B}`;cx.lineWidth=8*U;cx.strokeText(p.sub,0,72*U);cx.fillStyle='#f6f1e7';cx.fillText(p.sub,0,72*U)}}
    cx.restore();cx.globalAlpha=1}
}
function boxHud(g,Wd,Hd){
  const U=Wd/900,pad=18*U,bw=Wd*.34,bh=16*U,top=18*U;
  g.f.forEach((F,i)=>{const left=i===0,x0=left?pad:Wd-pad-bw,nm=g.players[i];
    cx.font=`${26*U}px ${FONT_B}`;cx.textBaseline='top';cx.textAlign=left?'left':'right';
    cx.fillStyle=BX.CORNER[i];cx.fillText(nm,left?x0:x0+bw,top);const nw=cx.measureText(nm).width;
    cx.font=`${15*U}px "Noto Sans KR",sans-serif`;cx.fillStyle='rgba(246,241,231,.7)';cx.fillText(BOXING.STYLE[g.look[i].style]||'',left?x0+nw+10*U:x0+bw-nw-10*U,top+8*U);
    const y=top+34*U;cx.fillStyle='rgba(0,0,0,.5)';cx.fillRect(x0,y,bw,bh);
    const hp=Math.max(0,F.hp)/100;cx.fillStyle=hp>.35?'#ffd23f':'#ff4d5e';if(left)cx.fillRect(x0+bw*(1-hp),y,bw*hp,bh);else cx.fillRect(x0,y,bw*hp,bh);
    cx.fillStyle='rgba(127,211,255,.85)';const sw=bw*.6*F.sta;if(left)cx.fillRect(x0+bw-sw,y+bh+4*U,sw,5*U);else cx.fillRect(x0,y+bh+4*U,sw,5*U);
    for(let k=0;k<3;k++){const c=left?x0+k*16*U+6*U:x0+bw-k*16*U-6*U;cx.beginPath();cx.arc(c,y+bh+20*U,5*U,0,7);cx.fillStyle=k<F.downs?'#ff4d5e':'rgba(246,241,231,.18)';cx.fill()}});
  cx.textAlign='center';cx.textBaseline='top';cx.font=`${30*U}px "Lilita One",sans-serif`;cx.fillStyle='#f6f1e7';cx.fillText(`${Math.floor(g.rt)}`,Wd/2,top+22*U);
  cx.font=`${15*U}px "Lilita One",sans-serif`;cx.fillStyle='#ffd23f';cx.fillText(`ROUND ${g.round}`,Wd/2,top+4*U);
  if(g.over&&g.winner!=null){cx.font=`700 ${20*U}px "Noto Sans KR",sans-serif`;cx.fillStyle='#ffd23f';cx.fillText(`🏆 ${g.players[g.winner]} · ${g.how}`,Wd/2,Hd-34*U)}
}
// 코너 카드용 초상화: 서 있는 마네킹 한 장 (index.html·admin.html)
window.portrait=(look,w=54,h=72)=>{const c=document.createElement('canvas');c.width=w*2;c.height=h*2;c.style.width=w+'px';c.style.height=h+'px';
  const F={f:-1,p:BX.POSE.map(([x,y])=>({x,y}))},s=h*2/2.05,W=(x,y)=>[x*s+w+8,h*2-8-y*s];W.s=s;drawMannequin(c.getContext('2d'),F,look,W,false);return c};
const logEl=document.getElementById('log');
function addLog(t){const d=document.createElement('div');d.textContent=t;logEl.prepend(d);while(logEl.children.length>80)logEl.lastChild.remove()}
function renderState(st){
  window.STATE=st;
  const s=document.getElementById('status');
  const L=st.life;
  s.innerHTML=st.modeName+' · '+(L?(st.phase==='play'?`${L.n+1}번째 인생 진행 중 (총 ${L.lives}회) — 성격 잠김, 속도 ${st.speed}×`:L.deadline>Date.now()?`성격 작성 중 — 마감까지 <b id="ddl"></b>`:L.deadline?`성격 작성 마감 — ${L.n+1}번째 인생 대기`:`인생 ${L.n}/${L.lives} 끝 — 성격 수정 가능`):
    (st.phase==='play'?`라운드 ${st.round} 진행 중 (${st.matchNo}/${st.matchTotal}경기) — 페르소나 잠김, 속도 ${st.speed}×`:`라운드 ${st.round} 준비 — 튜닝 시간`));
  const sc=document.getElementById('score');
  if(sc.tagName==='TBODY')sc.innerHTML=st.scoreboard.map((t,i)=>`<tr><td>${i+1}</td><td>${avImg(t.name,t.av,'av xs')}${t.name}${t.hasPersona?'':' <small>(페르소나 없음)</small>'}</td><td>${t.pts}</td><td>${t.wins}</td><td>${t.kills}</td></tr>`).join('')||'<tr><td colspan=5>아직 팀이 없어요</td></tr>';
  else sc.innerHTML=st.scoreboard.map((t,i)=>`<div class="it">${avImg(t.name,t.av,'av xs')}<b>${i+1}. ${t.name}</b><small>${t.hasPersona?`${t.pts}점 · 승${t.wins} 격파${t.kills}`:'페르소나 없음'}</small></div>`).join('')||'<div class="note">아직 팀이 없어요</div>';
  const r=document.getElementById('result');
  if(st.lastRound&&!st.live&&st.lastRound.mode==='life')r.innerHTML=`<b>인생 결과</b><br>`+[...st.lastRound.results].sort((a,b)=>b.pts-a.pts).map(x=>`${x.survived?'🏁':'·'} <b>${x.name}</b> ${x.survived?'미션 달성 +1':'미달성'}${x.deathT?` (${x.deathT}세 사망)`:''}`).join('<br>');
  else if(st.lastRound&&!st.live)r.innerHTML=`<b>라운드 ${st.lastRound.round} 결과</b><br>`+[...st.lastRound.results].sort((a,b)=>b.pts-a.pts).map(x=>`${x.survived?'🏆':x.self?'💥':'·'} <b>${x.name}</b> +${x.pts} (격파 ${x.kills}${x.self?', 자폭':''})`).join('<br>');
  else if(st.live)r.innerHTML='';
  draw(st.live);
  document.dispatchEvent(new CustomEvent('state',{detail:st}));
}
setInterval(()=>{const el=document.getElementById('ddl'),d=window.STATE?.life?.deadline;if(!el||!d)return;const r=Math.max(0,d-Date.now());el.textContent=`${Math.floor(r/60000)}:${String(Math.floor(r/1000)%60).padStart(2,'0')}`},500);
const es=new EventSource('/api/stream');
es.addEventListener('state',e=>renderState(JSON.parse(e.data)));
es.addEventListener('result',e=>{renderState(JSON.parse(e.data));document.dispatchEvent(new Event('roundend'))});
es.addEventListener('tick',e=>draw(JSON.parse(e.data)));
es.addEventListener('log',e=>addLog(JSON.parse(e.data)));
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>window.STATE&&draw(window.STATE.live));
window.api=async(p,b)=>{const r=await fetch(p,b?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j};
