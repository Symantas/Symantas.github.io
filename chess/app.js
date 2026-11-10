"use strict";
/* ================= constants ================= */
const KEY='mistake-trainer-v2';
const MODES={fast:[6,11],normal:[8,13],thorough:[13,13]};   // [scan depth, verify depth]
const CAND=6;                // scan pass: win-chance drop that sends a move to the verify pass
const MISTAKE=12,BLUNDER=20; // verify pass: win-chance points lost
const GOOD_ENOUGH=6,INTERVALS=[0,1,3,7,14,30,60],NEW_PER_SESSION=8,MAX_SESSION=20,DAY=864e5;
const VAL={p:1,n:3,b:3,r:5,q:9,k:0},GLYPH={k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟'};
const PIECE={p:'Pawn',n:'Knight',b:'Bishop',r:'Rook',q:'Queen',k:'King'};
const HANG=['Left something hanging','Moved a piece into danger'];
const DRAWS=['agreed','repetition','stalemate','insufficient','50move','timevsinsufficient'];
const ENDS={checkmated:'Checkmate',resigned:'Resignation',timeout:'On time',abandoned:'Abandoned',agreed:'Agreement',repetition:'Repetition',
  stalemate:'Stalemate',insufficient:'Insufficient material','50move':'50-move rule',timevsinsufficient:'Time vs insufficient'};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const avg=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:0;
const today=()=>{const d=new Date();d.setHours(0,0,0,0);return d.getTime()};
const dayKey=t=>{const d=new Date(t);return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0')};
const weekStart=t=>{const d=new Date(t);d.setHours(0,0,0,0);d.setDate(d.getDate()-((d.getDay()+6)%7));return d.getTime()};
const OW={L:1.5,D:1,W:.5};   // a mistake in a lost game weighs more than one in a game you won anyway
const fmtD=t=>new Date(t).toLocaleDateString(undefined,{month:'short',day:'numeric'});

/* ================= storage ================= */
let S={user:'',opts:{n:20,tc:'all',mode:'normal'},meta:{},games:{},cards:{},pos:{},log:{},eff:{nodes:0,pos:0,deepN:0,deepC:0,hits:0}};
try{const j=JSON.parse(localStorage.getItem(KEY));if(j)S=Object.assign(S,j)}catch(e){}
function save(){try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){
  try{S.pos={};localStorage.setItem(KEY,JSON.stringify(S))}catch(e2){}}}

/* ================= chess helpers ================= */
function parsePgn(pgn){
  if(/\[SetUp "1"\]/.test(pgn))return null;
  const body=pgn.replace(/^\[.*\]\s*$/gm,'');
  const clocks=[...body.matchAll(/\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/g)].map(m=>Math.round(+m[1]*3600+ +m[2]*60+ +m[3]));
  const toks=body.replace(/\{[^}]*\}/g,' ').replace(/\([^)]*\)/g,' ').replace(/\d+\.(\.\.)?/g,' ')
    .replace(/\$\d+/g,' ').split(/\s+/).filter(t=>t&&!['1-0','0-1','1/2-1/2','*'].includes(t));
  return {toks,clocks};
}
const replayMemo=new Map();
function replay(g){            // analysed game -> {fens, ucis}
  let r=replayMemo.get(g.u);if(r)return r;
  const ch=new Chess(),fens=[ch.fen()],ucis=[];
  for(const s of g.sans){const m=ch.move(s,{sloppy:true});if(!m)break;ucis.push(m.from+m.to+(m.promotion||''));fens.push(ch.fen())}
  r={fens,ucis};replayMemo.set(g.u,r);return r;
}
const uciMove=u=>({from:u.slice(0,2),to:u.slice(2,4),promotion:u[4]});
const winPct=cp=>{cp=Math.max(-1000,Math.min(1000,cp));return 50+50*(2/(1+Math.exp(-0.00368208*cp))-1)};
const accOf=loss=>Math.max(0,Math.min(100,103.1668*Math.exp(-0.04354*loss)-3.1669));
const posKey=fen=>fen.split(' ').slice(0,4).join(' ');
function material(ch,color){let t=0;for(const row of ch.board())for(const p of row)if(p)t+=(p.color===color?1:-1)*VAL[p.type];return t}
function lineSwing(fen,ucis,color,minPlies=3,maxPlies=10){
  const ch=new Chess(fen),start=material(ch,color);
  for(let i=0;i<Math.min(ucis.length,maxPlies);i++){const m=ch.move(uciMove(ucis[i]));if(!m)break;
    if(i>=minPlies&&!/[ce]/.test(m.flags)){ch.undo();break}}
  return material(ch,color)-start;
}
const isEndgame=fen=>(fen.split(' ')[0].match(/[nbrq]/gi)||[]).length<=6;
const toSan=(fen,uci)=>{const m=new Chess(fen).move(uciMove(uci));return m?m.san:uci};
function lineSan(fen,ucis,n){const ch=new Chess(fen),out=[];for(const u of ucis.slice(0,n)){const m=ch.move(uciMove(u));if(!m)break;out.push(m.san)}return out.join(' ')}
function movesText(sans,n){let s='';for(let i=0;i<n;i++)s+=(i%2?'':(i/2+1)+'.')+sans[i]+' ';return s.trim()}

/* ================= engine ================= */
let useWasm=typeof WebAssembly==='object';
class Engine{
  static async create(){
    const e=new Engine();e.w=new Worker(useWasm?'vendor/stockfish.wasm.js':'vendor/stockfish.js');e.cur=null;e.w.onmessage=ev=>e.on(ev.data);
    try{
      await new Promise((res,rej)=>{e.ready=res;const to=setTimeout(()=>rej(new Error('timeout')),useWasm?12000:30000);
        e.w.onerror=()=>{clearTimeout(to);rej(new Error('worker'))};
        ['uci','setoption name Contempt value 0','setoption name UCI_AnalyseMode value true','isready'].forEach(c=>e.w.postMessage(c))});
    }catch(err){
      e.quit();
      if(useWasm){useWasm=false;return Engine.create()}   // fall back to the asm.js build
      throw new Error('The chess engine failed to start in this browser.');
    }
    return e;
  }
  on(line){
    if(typeof line!=='string')return;
    if(line==='readyok'&&this.ready){this.ready();this.ready=null;return}
    const c=this.cur;if(!c)return;
    if(line.startsWith('info')){
      const n=line.match(/ nodes (\d+)/);if(n)c.nodes=+n[1];
      if(line.includes(' pv ')&&!/bound/.test(line)){const s=line.match(/score (cp|mate) (-?\d+)/);if(!s)return;
        c.kind=s[1];c.val=+s[2];c.pv=line.split(' pv ')[1].trim().split(/\s+/).slice(0,8)}
    }else if(line.startsWith('bestmove')){
      this.cur=null;const flip=c.black?-1:1;
      const mate=c.kind==='mate'?flip*c.val:null;
      const cp=c.kind==='mate'?flip*(c.val>0?10000:-10000):flip*(c.val||0);
      c.res({cp,mate,pv:c.pv||[],nodes:c.nodes||0});
    }
  }
  analyse(fen,depth,only){       // score from White's point of view; `only` restricts the search to one root move
    const ch=new Chess(fen);
    if(ch.game_over()){
      if(ch.in_checkmate()){const w=ch.turn()==='w';return Promise.resolve({cp:w?-10000:10000,mate:w?-1:1,pv:[],nodes:0})}
      return Promise.resolve({cp:0,mate:null,pv:[],nodes:0});
    }
    return new Promise(res=>{this.cur={res,black:ch.turn()==='b'};
      this.w.postMessage('position fen '+fen);this.w.postMessage('go depth '+depth+(only?' searchmoves '+only:''))});
  }
  quit(){try{this.w.terminate()}catch(e){}}
}

/* ================= analysis: dedupe -> backward scan -> verify =================
   1. Every position is looked up in a shared cache first (openings repeat across games, and across visits).
   2. A cheap low-depth scan walks each game BACKWARDS, so the engine's hash table already holds the continuation.
   3. Only moves whose scan result looks suspicious get a full-depth verify search (the position before and after).
   Quiet moves, which are most moves, never cost a deep search. */
const PC=new Map();      // posKey -> {d, p:Promise<info>}
for(const k in S.pos){const v=S.pos[k];PC.set(k,{d:v[3],p:Promise.resolve({cp:v[0],mate:v[1],pv:v[2]?v[2].split(' '):[],nodes:0})})}
function evalPos(engine,fen,depth,ply,deep,only){
  const k=posKey(fen)+(only?'|'+only:''),h=PC.get(k);
  if(h&&h.d>=depth){S.eff.hits++;return h.p}
  const p=engine.analyse(fen,depth,only).then(r=>{
    S.eff.nodes+=r.nodes;if(deep&&r.nodes){S.eff.deepN+=r.nodes;S.eff.deepC++}
    if(ply<=20&&r.pv.length&&!only)S.pos[k]=[r.cp,r.mate,r.pv.slice(0,4).join(' '),depth];
    return r});
  PC.set(k,{d:depth,p});return p;
}
async function analyseGame(engine,raw,meta,mode,tick){
  const parsed=parsePgn(raw.pgn);if(!parsed)return null;
  const ch=new Chess(),sans=[],ucis=[],fens=[ch.fen()];
  for(const t of parsed.toks.slice(0,240)){const m=ch.move(t,{sloppy:true});if(!m)break;
    sans.push(m.san);ucis.push(m.from+m.to+(m.promotion||''));fens.push(ch.fen())}
  const n=sans.length;if(n<8)return null;
  const [scanD,verD]=MODES[mode],me=meta.c,sign=me==='w'?1:-1,mine=i=>fens[i].split(' ')[1]===me;
  S.eff.pos+=n+1;
  // scan, backwards
  const A=new Array(n+1);
  for(let i=n;i>=0;i--){A[i]=await evalPos(engine,fens[i],scanD,i,scanD===verD);tick(0.6/(n+1))}
  // candidates -> verify
  const cand=[];
  for(let i=0;i<n;i++){if(!mine(i)||!A[i].pv.length||A[i].pv[0]===ucis[i])continue;
    if(winPct(sign*A[i].cp)-winPct(sign*A[i+1].cp)>=CAND)cand.push(i)}
  // verify each candidate from ONE root position at ONE depth: the best move, then the played move via `searchmoves`.
  // Both numbers share side to move, depth and horizon, which removes the noise of comparing two separate positions.
  const E=A.slice(),P={};
  for(const i of cand.slice().reverse()){
    E[i]=await evalPos(engine,fens[i],verD,i,true);
    if(E[i].pv[0]!==ucis[i])P[i]=await evalPos(engine,fens[i],verD,i,false,ucis[i]);
    tick(0.4/cand.length)}
  if(!cand.length)tick(0.4);
  // clocks
  const tcm=(meta.ctl||'').match(/^(\d+)(?:\+(\d+))?$/),base=tcm?+tcm[1]:0,inc=tcm?+(tcm[2]||0):0,cl=parsed.clocks.slice(0,n);
  const spent=i=>base&&cl[i]!=null?Math.max(0,(i>=2?cl[i-2]:base)-cl[i]+inc):null;
  const fastLim=Math.max(1.5,0.008*base),slowLim=0.08*base;
  // losses + mistakes
  const ls=new Array(n).fill(0),mistakes=[];let eg=n+1;
  for(let i=0;i<n;i++){
    if(eg>n&&isEndgame(fens[i]))eg=i;
    if(!mine(i))continue;
    const played=P[i],wb=winPct(sign*E[i].cp),wa=cand.includes(i)?(played?winPct(sign*played.cp):wb):winPct(sign*E[i+1].cp),drop=wb-wa;
    ls[i]=Math.max(0,Math.round(drop));
    if(!played||drop<MISTAKE)continue;
    const before=E[i],fen=fens[i];
    const mb=before.mate?sign*before.mate:0,ma=played.mate?sign*played.mate:0;
    const loss=lineSwing(fen,played.pv,me),gain=lineSwing(fen,before.pv,me),reply=played.pv[1];
    let motif;
    if(mb>0&&ma<=0)motif='Missed a forced mate';
    else if(ma<0&&mb>=0)motif='Walked into mate';
    else if(loss<=-2&&gain-loss>=2)motif=reply&&reply.slice(2,4)===ucis[i].slice(2,4)?'Moved a piece into danger':'Left something hanging';
    else if(gain>=2&&gain-loss>=2)motif='Missed a winning tactic';
    else motif='Positional slip';
    const sp=spent(i);
    mistakes.push({ply:i,san:sans[i],best:before.pv[0],bestSan:toSan(fen,before.pv[0]),line:lineSan(fen,before.pv,3),
      reply:reply?toSan(fens[i+1],reply):'',wb:Math.round(wb*10)/10,wa:Math.round(wa),drop:Math.round(drop),
      sev:drop>=BLUNDER?'Blunder':'Mistake',motif,phase:i<20?'Opening':i>=eg?'Endgame':'Middlegame',
      piece:PIECE[new Chess(fen).get(ucis[i].slice(0,2)).type],
      low:!!(base&&cl[i]!=null&&cl[i]<0.1*base),fast:sp!=null&&i>=16&&sp<=fastLim,slow:sp!=null&&sp>=slowLim});
  }
  const ob=[];for(let i=0;i<Math.min(24,n);i++)ob.push(mine(i)&&E[i].pv[0]||'');
  return {u:meta.u,usr:meta.usr,t:meta.t,m:meta,me,sans,ev:E.map(x=>Math.max(-10000,Math.min(10000,x.cp))),ls,cl,base,inc,eg,ob,mistakes,d:verD};
}

/* ================= download + run ================= */
function metaOf(g,u){
  const w=g.white.username.toLowerCase()===u,me=w?g.white:g.black,op=w?g.black:g.white;
  const o=me.result==='win'?'W':DRAWS.includes(me.result)?'D':'L';
  const eco=g.eco||((g.pgn||'').match(/\[ECOUrl "([^"]+)"\]/)||[])[1]||'';
  const words=[];for(const x of eco.split('/').pop().split('-')){if(/^\d/.test(x))break;words.push(x)}
  return {u:/^https:\/\/(www\.)?chess\.com\//.test(g.url||'')?g.url:'https://www.chess.com/#'+encodeURIComponent(String(g.url||Math.random())),usr:u,t:(g.end_time||0)*1000,c:w?'w':'b',tc:g.time_class||'',ctl:g.time_control||'',r:+me.rating||0,or:+op.rating||0,
    o,e:o==='W'?op.result:me.result,op:words.slice(0,3).join(' ')||'Unknown',n:((g.pgn||'').match(/\[%clk/g)||[]).length,
    opp:op.username,rated:g.rated!==false};
}
async function getJson(url){
  let r;try{r=await fetch(url)}catch(e){throw new Error('Could not reach Chess.com. Check your internet connection.')}
  if(r.status===404)throw new Error('Chess.com has no player with that username.');
  if(!r.ok)throw new Error('Chess.com answered with an error ('+r.status+'). Try again in a minute.');
  return r.json();
}
function progress(msg,frac,sub){$('prog').classList.remove('hide');$('pmsg').textContent=msg;$('fill').style.width=Math.round(100*frac)+'%';$('psub').textContent=sub||''}
let busy=false,lastPaint=0;
async function update(){
  if(busy)return;busy=true;$('error').classList.add('hide');$('go').disabled=true;
  const user=S.user.toLowerCase(),{n,tc,mode}=S.opts,engines=[],raws=[];
  try{
    progress('Downloading your games…',0);
    const archives=(await getJson('https://api.chess.com/pub/player/'+encodeURIComponent(user)+'/games/archives')).archives||[];
    let seen=0,used=0;
    for(let i=archives.length-1;i>=0&&used<12;i--,used++){
      if((seen>=300||used>=6)&&raws.length>=n)break;
      const month=(await getJson(archives[i])).games||[];
      for(let j=month.length-1;j>=0;j--){const g=month[j];if(g.rules!=='chess'||!g.pgn||!g.white||!g.black)continue;
        const m=metaOf(g,user);S.meta[m.u]=m;seen++;
        if(raws.length<n&&(tc==='all'||g.time_class===tc))raws.push([g,m])}
      progress('Downloading your games…',Math.min(.9,seen/300),seen+' games found');
    }
    if(!seen)throw new Error('No standard chess games found for that player.');
    const mine=Object.values(S.meta).filter(m=>m.usr===user).sort((a,b)=>b.t-a.t);
    mine.slice(500).forEach(m=>delete S.meta[m.u]);save();
    showApp();                                         // statistics are ready now; engine work continues below
    const verD=MODES[mode][1],todo=raws.filter(([g,m])=>!S.games[m.u]||S.games[m.u].d<verD);
    if(todo.length){
      progress('Starting the engine…',0);
      const k=Math.max(1,Math.min(4,(navigator.hardwareConcurrency||2)-1,todo.length));
      for(let i=0;i<k;i++)engines.push(await Engine.create());
      let done=0,finished=0,next=0;const t0=Date.now();
      const tick=x=>{done+=x;const f=Math.min(1,done/todo.length),left=f>0.04?Math.round((Date.now()-t0)*(1-f)/f/1000):null;
        progress('Engine analysis: game '+Math.min(todo.length,finished+1)+' of '+todo.length,f,
          (left==null?'':left>90?'about '+Math.round(left/60)+' min left':'about '+left+' s left')+' · you can browse meanwhile')};
      await Promise.all(engines.map(async e=>{
        while(next<todo.length){const [g,m]=todo[next++];
          const rec=await analyseGame(e,g,m,mode,tick);
          if(rec){S.games[m.u]=rec;save()}
          finished++;
          if(Date.now()-lastPaint>2500&&cur!=='train'){lastPaint=Date.now();derive();render()}}
      }));
    }
    const an=Object.values(S.games).filter(g=>g.usr===user).sort((a,b)=>b.t-a.t);
    an.slice(200).forEach(g=>delete S.games[g.u]);
    const pk=Object.keys(S.pos);pk.slice(0,Math.max(0,pk.length-2500)).forEach(k=>delete S.pos[k]);
    save();$('prog').classList.add('hide');busy=false;derive();render();
  }catch(e){$('prog').classList.add('hide');$('error').textContent=e.message||String(e);$('error').classList.remove('hide');
    if(!Object.values(S.meta).some(m=>m.usr===user))$('setup').classList.remove('hide')}
  finally{engines.forEach(e=>e.quit());busy=false;$('go').disabled=false}
}

/* ================= derived data ================= */
let F={tc:'all'},MG=[],G=[],M=[],CARDS=[],D={},INS=[];
const score=l=>l.length?100*(l.filter(m=>m.o==='W').length+.5*l.filter(m=>m.o==='D').length)/l.length:0;
const tally=(arr,f)=>{const o={};arr.forEach(m=>{const k=typeof f==='function'?f(m):m[f];o[k]=(o[k]||0)+1});return Object.entries(o).sort((a,b)=>b[1]-a[1])};
function derive(){
  const u=S.user.toLowerCase(),ok=m=>m.usr===u&&(F.tc==='all'||m.tc===F.tc);
  MG=Object.values(S.meta).filter(ok).sort((a,b)=>a.t-b.t);
  G=Object.values(S.games).filter(g=>g.usr===u&&ok(g.m)).sort((a,b)=>a.t-b.t);
  M=[];
  for(const g of G){let prev=null;for(const m of g.mistakes){
    M.push(Object.assign({},m,{id:g.u+'#'+m.ply,g,opening:g.m.op,clock:m.low?'Low on time':'Enough time',
      speed:m.fast?'Played instantly':m.slow?'After a long think':'Normal pace',cluster:prev!=null&&m.ply-prev<=6,winning:m.wb>=80}));prev=m.ply}}
  const d=D={};
  // sessions and tilt (all downloaded games)
  let prev=null,idx=0;d.afterL=[];d.afterW=[];d.early=[];d.late=[];
  for(const m of MG){const same=prev&&m.t-prev.t<45*60e3;idx=same?idx+1:1;
    if(same){(prev.o==='L'?d.afterL:prev.o==='W'?d.afterW:[]).push(m)}
    (idx<=4?d.early:d.late).push(m);prev=m}
  d.hours=[['Night (0–6)',0,6],['Morning (6–12)',6,12],['Afternoon (12–18)',12,18],['Evening (18–24)',18,24]]
    .map(([l,a,b])=>[l,MG.filter(m=>{const h=new Date(m.t).getHours();return h>=a&&h<b})]);
  d.vs=[['Higher rated (+25 or more)',MG.filter(m=>m.or-m.r>=25)],['Similar',MG.filter(m=>Math.abs(m.or-m.r)<25)],['Lower rated (−25 or more)',MG.filter(m=>m.r-m.or>=25)]];
  const tcs=tally(MG.filter(m=>m.rated&&m.r),'tc');d.rtc=F.tc!=='all'?F.tc:(tcs[0]||[''])[0];
  d.rating=MG.filter(m=>m.rated&&m.r&&m.tc===d.rtc).map(m=>({x:fmtD(m.t),y:m.r}));
  // engine-based
  const ph={Opening:[0,0,0],Middlegame:[0,0,0],Endgame:[0,0,0]};   // moves, loss sum, acc sum
  const sp={fast:[0,0],normal:[0,0],slow:[0,0]},lowc=[[0,0],[0,0]];
  d.acc=[];d.exit={};d.first=[];let hadWin=0,conv=0,hadLost=0,saved=0;
  for(const g of G){
    const sign=g.me==='w'?1:-1,off=g.me==='w'?0:1,accs=[];let mx=0,mn=100;const mset=new Set(g.mistakes.map(m=>m.ply));
    const fastLim=Math.max(1.5,0.008*g.base),slowLim=0.08*g.base;
    for(let i=off;i<g.sans.length;i+=2){
      const a=accOf(g.ls[i]),p=i<20?'Opening':i>=g.eg?'Endgame':'Middlegame';accs.push(a);
      ph[p][0]++;ph[p][1]+=g.ls[i];ph[p][2]+=a;
      const w=winPct(sign*g.ev[i]);if(i>=10){mx=Math.max(mx,w);mn=Math.min(mn,w)}
      if(g.base&&g.cl[i]!=null){
        const s=Math.max(0,(i>=2?g.cl[i-2]:g.base)-g.cl[i]+g.inc),b=i>=16?(s<=fastLim?'fast':s>=slowLim?'slow':'normal'):null;
        if(b){sp[b][0]++;if(mset.has(i))sp[b][1]++}
        const l=g.cl[i]<0.1*g.base?1:0;lowc[l][0]++;if(mset.has(i))lowc[l][1]++;
      }
    }
    g._acc=avg(accs);d.acc.push({x:fmtD(g.t)+' vs '+g.m.opp,y:Math.round(g._acc*10)/10});
    if(mx>=85){hadWin++;if(g.m.o==='W')conv++}
    if(mn<=15){hadLost++;if(g.m.o!=='L')saved++}
    const ex=winPct(sign*g.ev[Math.min(20,g.ev.length-1)]),ok2=g.m.op+'|'+g.me;(d.exit[ok2]=d.exit[ok2]||[]).push(ex);
    if(g.mistakes.length)d.first.push(Math.floor(g.mistakes[0].ply/2)+1);
  }
  d.ph=ph;d.sp=sp;d.lowc=lowc;d.conv=[hadWin,conv,hadLost,saved];
  d.accAll=avg(d.acc.map(a=>a.y));
  const wk={},W=t=>wk[weekStart(t)]=wk[weekStart(t)]||{t:weekStart(t),games:[],an:[],r:null};
  MG.forEach(m=>{const w=W(m.t);w.games.push(m);if(m.rated&&m.r&&m.tc===d.rtc)w.r=m.r});G.forEach(g=>W(g.t).an.push(g));
  d.weeks=Object.values(wk).sort((a,b)=>a.t-b.t);
  // recurring-position leaks (same position, same move, repeated loss)
  const seen={};
  for(const g of G){const r=replay(g),off=g.me==='w'?0:1;
    for(let i=off;i<Math.min(24,g.sans.length);i+=2){const k=posKey(r.fens[i])+'|'+g.sans[i];(seen[k]=seen[k]||[]).push({g,ply:i})}}
  d.leaks=[];
  for(const k in seen){const l=seen[k];if(l.length<2)continue;
    const loss=avg(l.map(x=>x.g.ls[x.ply])),s=l[l.length-1],best=s.g.ob[s.ply];
    if(loss<8||!best)continue;const r=replay(s.g);if(best===r.ucis[s.ply])continue;
    d.leaks.push({occ:l,n:l.length,loss,g:s.g,ply:s.ply,san:s.g.sans[s.ply],best,bestSan:toSan(r.fens[s.ply],best),seq:movesText(s.g.sans,s.ply)})}
  d.leaks.sort((a,b)=>b.n*b.loss-a.n*a.loss);d.leaks=d.leaks.slice(0,8);
  // cards = mistakes + leaks
  const ids=new Set(M.map(m=>m.id));
  d.leaks.forEach(l=>l.occ.forEach(o=>{const c=M.find(m=>m.id===o.g.u+'#'+o.ply);if(c)c.leak=l.n}));
  CARDS=M.concat(d.leaks.filter(l=>!l.occ.some(o=>ids.has(o.g.u+'#'+o.ply))).map(l=>{const sign=l.g.me==='w'?1:-1,wb=winPct(sign*l.g.ev[l.ply]);
    return {id:'leak:'+posKey(replay(l.g).fens[l.ply])+'|'+l.san,g:l.g,ply:l.ply,san:l.san,best:l.best,bestSan:l.bestSan,line:'',reply:'',
      wb:Math.round(wb*10)/10,wa:Math.round(wb-l.loss),drop:Math.round(l.loss),sev:'Leak',motif:'Opening leak',phase:'Opening',leak:l.n,
      opening:l.g.m.op,clock:'Enough time',speed:'Normal pace'}}));
  INS=insights();
  const pri={};INS.forEach(s=>(s.set||[]).forEach(c=>pri[c.id]=(pri[c.id]||0)+s.impact));
  CARDS.forEach(c=>c.pri=pri[c.id]||0);
}
const dueCards=()=>CARDS.filter(m=>S.cards[m.id]&&S.cards[m.id].due<=Date.now());
const newCards=()=>CARDS.filter(m=>!S.cards[m.id]);

/* ================= insights: every rule is driven by a statistic above ================= */
function insights(){
  const out=[],nG=Math.max(1,G.length),n=M.length,all=score(MG),share=l=>MG.length?l.length/MG.length:0;
  const cost=set=>.3*set.reduce((a,m)=>a+m.drop*OW[m.g.m.o],0)/nG;
  const eng=(set,min,title,why,how,check)=>{if(set.length<3||set.length/Math.max(1,n)<min)return;
    const lost=set.filter(m=>m.g.m.o==='L').length;
    out.push({title,why:why(set.length,Math.round(100*set.length/n))+(lost?` ${lost} of them came in games you lost.`:''),how,check,set,impact:cost(set)})};
  eng(M.filter(m=>HANG.includes(m.motif)),.12,'Stop giving material away',(c,p)=>`${c} of your ${n} mistakes (${p}%) lose material almost immediately.`,
    'Before you let go of a piece, run a 5-second safety check: after this move, what can my opponent capture, and is the square I am moving to attacked more often than defended?','Is every piece of mine defended after this move?');
  eng(M.filter(m=>m.motif==='Missed a winning tactic'||m.motif==='Missed a forced mate'),.12,'Take the tactics you are offered',(c,p)=>`${c} mistakes (${p}%) were wins you walked past.`,
    'On every move look at your checks, captures and threats first, before any plan. 10–15 minutes of puzzles a day trains exactly this scan.','Checks, captures, threats — mine first.');
  eng(M.filter(m=>m.motif==='Walked into mate'),.08,'Check your king before every move',(c,p)=>`${c} mistakes (${p}%) allowed a forced mate.`,
    'Ask "what are my opponent\'s checks?" before you commit. Count the attackers near your king and keep an escape square.','What are my opponent\'s checks?');
  eng(M.filter(m=>m.winning),.2,'Convert your winning positions',(c,p)=>`${c} mistakes (${p}%) happened when you were already clearly winning`+(D.conv[0]?` — you won ${D.conv[1]} of ${D.conv[0]} games in which you had a winning position.`:'.'),
    'When you are ahead, stop looking for brilliant moves. Trade pieces (not pawns), remove counterplay first, and double-check every move for the one trick your opponent has left.','Ahead? Simplify and kill counterplay.');
  eng(M.filter(m=>m.cluster),.2,'Do not let one mistake become two',(c,p)=>`${c} mistakes (${p}%) came within three moves of a previous one.`,
    'After you notice an error, stop for ten seconds and re-evaluate the position as if the game had just started.','After a mistake: breathe, reset, re-evaluate.');
  eng(M.filter(m=>m.phase==='Endgame'),.22,'Study basic endgames',(c,p)=>`${c} mistakes (${p}%) are in the endgame`+(D.ph.Endgame[0]?`, where your accuracy is ${Math.round(D.ph.Endgame[2]/D.ph.Endgame[0])}%.`:'.'),
    'Activate your king, create and push a passed pawn, put rooks behind passed pawns. King-and-pawn and rook endgame basics convert games you are already winning.');
  eng(M.filter(m=>m.motif==='Positional slip'&&m.phase!=='Opening'),.3,'Improve your worst piece',(c,p)=>`${c} mistakes (${p}%) are quiet moves that slowly give the position away.`,
    'When there is no tactic, ask which of your pieces is doing the least and improve it. Avoid pawn moves that create weaknesses without a concrete reason.');
  // pace: mistake RATE when moving instantly vs normally
  const rate=a=>a[0]?100*a[1]/a[0]:0,rf=rate(D.sp.fast),rn=rate(D.sp.normal),rs=rate(D.sp.slow);
  if(D.sp.fast[1]>=3&&D.sp.fast[0]>=20&&rf>=1.4*Math.max(rn,.5)){const set=M.filter(m=>m.fast);
    out.push({title:'Slow down on instant moves',set,impact:cost(set),
      why:`When you move almost instantly you make ${rf.toFixed(1)} mistakes per 100 moves, against ${rn.toFixed(1)} at a normal pace.`,
      how:'After the opening, never play the first move you see. Sit on your hands for three seconds and ask what changed with your opponent\'s last move.',check:'What did their last move change?'})}
  const rl=rate(D.lowc[1]),rh=rate(D.lowc[0]);
  if(D.lowc[1][1]>=3&&rl>=1.4*Math.max(rh,.5)){const set=M.filter(m=>m.low);
    out.push({title:'Fix your clock management',set,impact:cost(set),
      why:`With under 10% of your time left you make ${rl.toFixed(1)} mistakes per 100 moves, against ${rh.toFixed(1)} otherwise.`,
      how:'Play known opening moves quickly and cap normal moves at about 1/20 of your starting time. Save long thinks for positions with captures and checks on the board.',check:'Check the clock every five moves.'})}
  if(D.sp.slow[1]>=3&&D.sp.slow[0]>=10&&rs>=1.6*Math.max(rn,.5))out.push({title:'Long thinks are not paying off',set:M.filter(m=>m.slow),impact:.7*cost(M.filter(m=>m.slow)),
    why:`After a long think you make ${rs.toFixed(1)} mistakes per 100 moves, against ${rn.toFixed(1)} at a normal pace.`,
    how:'A long think usually means you are comparing too many moves. Pick two candidates, calculate each once to the end, then choose. Do not restart the calculation.'});
  // opening leaks and openings
  const opm=M.filter(m=>m.phase==='Opening'),lk=D.leaks[0];
  if(lk)out.push({title:'Fix a repeated opening leak',set:CARDS.filter(c=>c.leak),impact:.3*D.leaks.reduce((a,l)=>a+l.loss*l.n,0)/nG+1,
    why:`After ${lk.seq||'the first move'} you played ${lk.san} in ${lk.n} games; it costs about ${Math.round(lk.loss)} points of win chance each time. The engine prefers ${lk.bestSan}.`+(D.leaks.length>1?` ${D.leaks.length-1} more repeated leak${D.leaks.length>2?'s':''} below.`:''),
    how:'This is the cheapest improvement you have: the same position keeps coming, so one corrected move pays off in every future game. Drill the leak cards until they are automatic.'});
  else if(opm.length>=3&&opm.length/Math.max(1,n)>=.3)out.push({title:'Tighten your opening play',set:opm,impact:cost(opm),
    why:`${opm.length} mistakes (${Math.round(100*opm.length/n)}%) happen in the first 10 moves`+(D.first.length?`; on average your first mistake comes at move ${Math.round(avg(D.first))}.`:'.'),
    how:'Develop a piece with every move, castle before move 10, and do not move the same piece twice without a reason. Then review the first 10 moves of each loss.'});
  const ops={};MG.forEach(m=>{const k=m.op+'|'+m.c;(ops[k]=ops[k]||[]).push(m)});
  const worst=Object.entries(ops).filter(([k,l])=>l.length>=5&&score(l)<=all-12).sort((a,b)=>(all-score(b[1]))*b[1].length-(all-score(a[1]))*a[1].length)[0];
  if(worst){const [k,l]=worst,[name,c]=k.split('|');out.push({title:`Rethink the ${name} as ${c==='w'?'White':'Black'}`,impact:(all-score(l))*share(l),
    why:`You score ${Math.round(score(l))}% in ${l.length} games with it, against ${Math.round(all)}% overall.`,
    how:'Either learn the main ideas of this line properly (one model game is enough to start), or switch to something simpler for a month and compare the numbers here.'})}
  // colour, tilt, session length, time of day, flagging, early collapses
  const W=MG.filter(m=>m.c==='w'),B=MG.filter(m=>m.c==='b');
  if(W.length>=10&&B.length>=10&&Math.abs(score(W)-score(B))>=10){const wb=score(W)<score(B);
    out.push({title:`Your ${wb?'White':'Black'} games lag behind`,impact:Math.abs(score(W)-score(B))*.5*.5,
      why:`You score ${Math.round(score(W))}% as White and ${Math.round(score(B))}% as Black.`,
      how:wb?'With White you set the agenda. Pick one first move and one setup against each main defence, and play only that for the next 30 games.'
        :'Pick one solid defence against 1.e4 and one against 1.d4 and stick to them, so you reach positions you know.'})}
  if(D.afterL.length>=10&&score(D.afterL)<=all-8)out.push({title:'Take a break after a loss',impact:(all-score(D.afterL))*share(D.afterL),
    why:`In games started right after a loss you score ${Math.round(score(D.afterL))}%, against ${Math.round(all)}% overall (${D.afterL.length} games).`,
    how:'Set a rule: after a loss, stand up for five minutes before the next game. After two losses in a row, stop for the day.',check:'Lost the last game? Break first.'});
  if(D.late.length>=8&&score(D.late)<=score(D.early)-8)out.push({title:'Keep your sessions short',impact:(score(D.early)-score(D.late))*share(D.late),
    why:`From the 5th game of a session on you score ${Math.round(score(D.late))}%, against ${Math.round(score(D.early))}% in the first four (${D.late.length} games).`,
    how:'Cap a session at four games. Use the saved time for one training session here instead.'});
  const hb=D.hours.filter(([l,x])=>x.length>=10).sort((a,b)=>score(a[1])-score(b[1]))[0];
  if(hb&&score(hb[1])<=all-10)out.push({title:`Avoid rated games: ${hb[0].split(' ')[0].toLowerCase()}`,impact:(all-score(hb[1]))*share(hb[1]),
    why:`${hb[0]}: you score ${Math.round(score(hb[1]))}% in ${hb[1].length} games, against ${Math.round(all)}% overall.`,
    how:'Play your rated games at the time of day where your numbers are best, and use this slot for training or unrated games.'});
  const L=MG.filter(m=>m.o==='L'),flag=L.filter(m=>m.e==='timeout'),quick=L.filter(m=>m.n&&m.n<=40);
  if(L.length>=8&&flag.length/L.length>=.25)out.push({title:'You lose too many games on time',impact:100*flag.length/Math.max(1,MG.length)*.5,
    why:`${flag.length} of your ${L.length} losses (${Math.round(100*flag.length/L.length)}%) were on the clock.`,
    how:'Aim to reach move 20 with at least half your time. If you regularly cannot, play a slower time control for a while or simplify your openings.',check:'Half my time left at move 20?'});
  if(L.length>=8&&quick.length/L.length>=.25)out.push({title:'Survive the first 20 moves',impact:100*quick.length/Math.max(1,MG.length)*.4,
    why:`${quick.length} of your ${L.length} losses (${Math.round(100*quick.length/L.length)}%) were over within 20 moves.`,
    how:'Early collapses are almost always king safety or a loose piece. Castle early and do not grab pawns while your pieces are still at home.'});
  return out.sort((a,b)=>b.impact-a.impact).slice(0,6);
}

/* ================= small render helpers ================= */
const tile=(v,l,sub)=>`<div class="tile"><b>${v}</b><span>${l}</span>${sub?`<em>${sub}</em>`:''}</div>`;
function bars(title,rows,note){       // rows: [label, value, text]
  const mx=Math.max(1e-9,...rows.map(r=>r[1]));
  return `<div class="card"><h2>${title}</h2>`+(rows.length?rows.map(r=>`<div class="row" title="${esc(r[0])}: ${esc(r[2])}"><span>${esc(r[0])}</span><span class="c">${esc(r[2])}</span>
    <div class="m"><i style="width:${100*r[1]/mx}%"></i></div></div>`).join(''):'<p class="dim">Not enough data yet.</p>')+(note?`<p class="dim">${note}</p>`:'')+'</div>';
}
function wdlRow(label,l){
  if(!l.length)return '';const w=l.filter(m=>m.o==='W').length,d=l.filter(m=>m.o==='D').length,x=l.length-w-d;
  return `<div class="wdlrow" title="${esc(label)}: ${w} won, ${d} drawn, ${x} lost"><div><span>${esc(label)}</span><span class="dim">${w}–${d}–${x} · ${Math.round(score(l))}%</span></div>
    <div class="wdl"><i style="flex:${w};background:var(--good)"></i><i style="flex:${d};background:var(--neutral)"></i><i style="flex:${x};background:var(--crit)"></i></div></div>`;
}
const WDLKEY='<div class="key"><span><i style="background:var(--good)"></i>Won</span><span><i style="background:var(--neutral)"></i>Drawn</span><span><i style="background:var(--crit)"></i>Lost</span><span>· score %</span></div>';
let chartSeq=0;const chartData={};
function lineChart(pts,unit){
  if(pts.length<2)return '<p class="dim">Not enough data yet.</p>';
  const id='ch'+(++chartSeq),W=600,H=170,l=40,r=12,t=10,b=8,ys=pts.map(p=>p.y);let lo=Math.min(...ys),hi=Math.max(...ys);
  if(hi-lo<1){hi+=1;lo-=1}const pad=(hi-lo)*.1;lo-=pad;hi+=pad;
  const X=i=>l+(W-l-r)*i/(pts.length-1),Y=v=>t+(H-t-b)*(1-(v-lo)/(hi-lo));
  chartData[id]={pts,X,Y,W,H,unit:unit||''};
  let g='';for(let k=0;k<3;k++){const v=lo+(hi-lo)*(k+.5)/3,y=Y(v);
    g+=`<line x1="${l}" x2="${W-r}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1"/><text x="${l-6}" y="${y+4}" text-anchor="end" font-size="11" fill="var(--mute)">${hi-lo<6?v.toFixed(1):Math.round(v)}</text>`}
  const path=pts.map((p,i)=>(i?'L':'M')+X(i).toFixed(1)+' '+Y(p.y).toFixed(1)).join(' ');
  return `<div class="chart" id="${id}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="line chart">${g}
    <path d="${path}" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${X(pts.length-1)}" cy="${Y(ys[ys.length-1])}" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2"/>
    <line class="xh" y1="${t}" y2="${H-b}" stroke="var(--mute)" stroke-width="1" visibility="hidden"/>
    <circle class="dot" r="4" fill="var(--accent)" stroke="var(--card)" stroke-width="2" visibility="hidden"/></svg><div class="tipbox"></div></div>`;
}
function wireCharts(root){
  root.querySelectorAll('.chart').forEach(el=>{const c=chartData[el.id];if(!c)return;
    const svg=el.querySelector('svg'),xh=el.querySelector('.xh'),dot=el.querySelector('.dot'),tip=el.querySelector('.tipbox');
    const move=e=>{const r=svg.getBoundingClientRect(),x=(e.clientX-r.left)/r.width*c.W;
      let i=0,best=1e9;c.pts.forEach((p,k)=>{const dd=Math.abs(c.X(k)-x);if(dd<best){best=dd;i=k}});
      const px=c.X(i),py=c.Y(c.pts[i].y);xh.setAttribute('x1',px);xh.setAttribute('x2',px);xh.setAttribute('visibility','visible');
      dot.setAttribute('cx',px);dot.setAttribute('cy',py);dot.setAttribute('visibility','visible');
      tip.style.display='block';tip.style.left=Math.max(40,Math.min(r.width-40,px/c.W*r.width))+'px';tip.style.top=(py/c.H*r.height)+'px';
      tip.textContent=c.pts[i].x+': '+c.pts[i].y+c.unit};
    const out=()=>{xh.setAttribute('visibility','hidden');dot.setAttribute('visibility','hidden');tip.style.display='none'};
    svg.addEventListener('pointermove',move);svg.addEventListener('pointerdown',move);svg.addEventListener('pointerleave',out)});
}

/* ================= overview ================= */
function renderOver(){
  const el=$('over'),d=D;
  const tcs=tally(Object.values(S.meta).filter(m=>m.usr===S.user.toLowerCase()),'tc');
  const wins=MG.filter(m=>m.o==='W'),losses=MG.filter(m=>m.o==='L'),nG=G.length,bl=M.filter(m=>m.sev==='Blunder').length;
  const r=d.rating,rNow=r.length?r[r.length-1].y:null,rD=r.length>1?rNow-r[0].y:0;
  const per=x=>nG?(x/nG).toFixed(1):'–';
  let h=`<div class="card"><div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      <div><b>${esc(S.user)}</b> <span class="dim">· ${MG.length} games${MG.length?' · '+fmtD(MG[0].t)+' – '+fmtD(MG[MG.length-1].t):''}</span></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><select id="ftc" aria-label="Time control filter"><option value="all">All time controls</option>${tcs.map(([k,c])=>`<option value="${esc(k)}">${esc(k[0].toUpperCase()+k.slice(1))} (${c})</option>`).join('')}</select>
      <button id="refresh" ${busy?'disabled':''}>Get new games</button><button class="link" id="change">change player</button></div></div>
    <div class="tiles">${tile(MG.length?Math.round(score(MG))+'%':'–','score',`${wins.length}–${MG.length-wins.length-losses.length}–${losses.length}`)}
      ${tile(rNow||'–',(d.rtc||'')+' rating',r.length>1?(rD>=0?'+':'')+rD+' over '+r.length+' games':'')}
      ${tile(nG?Math.round(d.accAll)+'%':'–','accuracy (est.)',nG?nG+' analysed games':'engine still working')}
      ${tile(per(M.length),'mistakes per game',nG?per(bl)+' blunders':'')}
      ${tile(d.conv[0]?Math.round(100*d.conv[1]/d.conv[0])+'%':'–','winning positions converted',d.conv[0]?d.conv[1]+' of '+d.conv[0]:'')}
      ${tile(d.conv[2]?Math.round(100*d.conv[3]/d.conv[2])+'%':'–','lost positions saved',d.conv[2]?d.conv[3]+' of '+d.conv[2]:'')}</div></div>`;
  if(INS.length)h+=`<div class="card"><h2>Biggest lever right now</h2><h3>${esc(INS[0].title)}</h3><p class="dim">${esc(INS[0].why)}</p>
    <div class="ctl"><button class="primary" id="toCoach">See your plan</button>${dueCards().length+newCards().length?'<button id="toTrain">Train now</button>':''}</div></div>`;
  h+=`<div class="grid2"><div class="card"><h2>${esc(d.rtc||'')} rating</h2>${lineChart(r)}</div>
    <div class="card"><h2>Accuracy per analysed game</h2>${lineChart(d.acc,'%')}<p class="dim">Estimated from the engine's win-chance loss on each of your moves.</p></div></div>`;
  h+=`<div class="grid2"><div class="card"><h2>Results</h2>${WDLKEY}${wdlRow('All games',MG)}${wdlRow('As White',MG.filter(m=>m.c==='w'))}${wdlRow('As Black',MG.filter(m=>m.c==='b'))}
      ${d.vs.map(([l,x])=>wdlRow(l,x)).join('')}</div>
    <div class="card"><h2>When you play</h2>${WDLKEY}${d.hours.map(([l,x])=>wdlRow(l,x)).join('')}${wdlRow('Right after a win',d.afterW)}${wdlRow('Right after a loss',d.afterL)}
      ${wdlRow('Games 1–4 of a session',d.early)}${wdlRow('Game 5+ of a session',d.late)}</div></div>`;
  const endRows=l=>tally(l,m=>ENDS[m.e]||m.e).map(([k,c])=>[k,c,c+' · '+Math.round(100*c/l.length)+'%']);
  const lenOf=l=>{const x=l.filter(m=>m.n);return x.length?Math.round(avg(x.map(m=>m.n))/2):null};
  h+=`<div class="grid2">${bars('How you win',endRows(wins),lenOf(wins)?'Average win: '+lenOf(wins)+' moves.':'')}${bars('How you lose',endRows(losses),lenOf(losses)?'Average loss: '+lenOf(losses)+' moves.':'')}</div>`;
  // engine sections
  const phRows=k=>Object.entries(d.ph).filter(([p,v])=>v[0]).map(([p,v])=>k==='acc'?[p,v[2]/v[0],Math.round(v[2]/v[0])+'%']:
    [p,100*M.filter(m=>m.phase===p).length/v[0],(100*M.filter(m=>m.phase===p).length/v[0]).toFixed(1)]);
  const rate=(a,l)=>a[0]?[l,100*a[1]/a[0],(100*a[1]/a[0]).toFixed(1)+' ('+a[0]+' moves)']:null;
  if(nG){
    h+=`<div class="grid2">${bars('Accuracy by phase',phRows('acc'))}${bars('Mistakes per 100 moves, by phase',phRows('rate'),d.first.length?'Your first mistake comes at move '+Math.round(avg(d.first))+' on average.':'')}</div>`;
    h+=`<div class="grid2">${bars('Mistakes per 100 moves, by pace',[rate(d.sp.fast,'Played instantly'),rate(d.sp.normal,'Normal pace'),rate(d.sp.slow,'After a long think')].filter(Boolean),'Moves after move 8, by time spent.')}
      ${bars('Mistakes per 100 moves, by clock',[rate(d.lowc[0],'Enough time'),rate(d.lowc[1],'Under 10% of time left')].filter(Boolean))}</div>`;
    h+=`<div class="grid2">${bars('Mistake types',tally(M,'motif').map(([k,c])=>[k,c,String(c)]))}${bars('Piece you moved',tally(M,'piece').map(([k,c])=>[k,c,String(c)]))}</div>`;
  }else h+=`<div class="card"><h2>Engine statistics</h2><p class="dim">Accuracy, mistake types, pace and clock statistics appear here as the engine finishes each game.</p></div>`;
  // openings
  const ops={};MG.forEach(m=>{const k=m.op+'|'+m.c;(ops[k]=ops[k]||[]).push(m)});
  const rows=Object.entries(ops).sort((a,b)=>b[1].length-a[1].length).slice(0,10).map(([k,l])=>{const [name,c]=k.split('|'),ex=d.exit[k],
    mg=G.filter(g=>g.m.op===name&&g.me===c);
    return `<tr><td>${esc(name)}</td><td>${c==='w'?'White':'Black'}</td><td>${l.length}</td><td>${Math.round(score(l))}%</td>
      <td>${ex?Math.round(avg(ex))+'%':'–'}</td><td>${mg.length?(mg.reduce((a,g)=>a+g.mistakes.length,0)/mg.length).toFixed(1):'–'}</td></tr>`}).join('');
  h+=`<div class="card"><h2>Openings</h2><div class="scroll"><table><tr><th>Opening</th><th>As</th><th>Games</th><th>Score</th><th>Win chance at move 10</th><th>Mistakes / game</th></tr>${rows}</table></div>
    <p class="dim">"Win chance at move 10" is the engine's view of the position you get out of the opening; 50% is equal.</p></div>`;
  const e=S.eff,full=e.pos*(e.deepC?e.deepN/e.deepC:0);
  h+=`<p class="dim" style="text-align:center">Engine work so far: ${e.pos} positions`+(full&&e.nodes?`, about ${(full/e.nodes).toFixed(1)}× less search than analysing every move at full depth (estimate)`:'')+`. Data stays in this browser.</p>`;
  el.innerHTML=h;wireCharts(el);
  $('ftc').value=[...$('ftc').options].some(o=>o.value===F.tc)?F.tc:'all';
  $('ftc').onchange=()=>{F.tc=$('ftc').value;derive();render()};
  $('refresh').onclick=update;
  $('change').onclick=()=>{['over','coach','train','prog2','browse','tabs'].forEach(t=>$(t).classList.add('hide'));$('setup').classList.remove('hide');$('user').focus()};
  if($('toCoach'))$('toCoach').onclick=()=>show('coach');if($('toTrain'))$('toTrain').onclick=()=>show('train');
}

/* ================= coach ================= */
function renderCoach(){
  const el=$('coach');let h='<div class="card"><h2>Your plan — ranked by what costs you most</h2>';
  h+=INS.length?INS.map((s,i)=>`<div class="tip"><h3><span class="n">${i+1}</span>${esc(s.title)}</h3><p class="dim">${esc(s.why)}</p><p>${esc(s.how)}</p>
    ${s.set&&s.set.length?`<button data-ins="${i}">Practise these ${s.set.length} positions</button>`:''}</div>`).join('')
    :'<p class="dim">No clear pattern yet. This fills in once more games are downloaded and analysed.</p>';
  h+='</div>';
  const checks=[...new Set(INS.map(s=>s.check).filter(Boolean))].slice(0,4);
  if(checks.length)h+=`<div class="card"><h2>Your pre-move checklist</h2><ul class="check">${checks.map(c=>`<li>${esc(c)}</li>`).join('')}</ul>
    <p class="dim">Built from your own statistics. Read it before each session.</p></div>`;
  if(D.leaks.length)h+=`<div class="card"><h2>Repeated opening leaks</h2>${D.leaks.map(l=>`<div class="leak"><b>${esc(l.seq||'First move')}</b>
    <div>You play <b style="color:var(--crit)">${esc(l.san)}</b> <span class="dim">(${l.n} games, about −${Math.round(l.loss)}% win chance each)</span> · engine prefers <b style="color:var(--good)">${esc(l.bestSan)}</b></div></div>`).join('')}
    <p class="dim">Positions you reached more than once and answered the same way. These are in your training cards.</p></div>`;
  const by={};CARDS.forEach(c=>{const s=S.cards[c.id];if(s&&s.n){const b=by[c.motif]=by[c.motif]||[0,0,0];b[0]+=s.n;b[1]+=s.ok;if(s.box>=4)b[2]++}});
  const tr=Object.entries(by).map(([k,v])=>[k,100*v[1]/v[0],Math.round(100*v[1]/v[0])+'% right · '+v[0]+' attempts']);
  const box=c=>S.cards[c.id]?S.cards[c.id].box:-1,ms=CARDS.filter(c=>box(c)>=4).length,lr=CARDS.filter(c=>box(c)>=0&&box(c)<4).length;
  h+=`<div class="grid2">${bars('Trainer results by mistake type',tr,tr.length?'':'Train a few cards to see where you are improving.')}
    <div class="card"><h2>Training progress</h2><div class="tiles">${tile(dueCards().length,'due now')}${tile(newCards().length,'new')}${tile(lr,'learning')}${tile(ms,'mastered')}</div>
    <p class="dim">A card is mastered after four correct reviews in a row, spaced over about two weeks. Cards from your top priorities, and from games you lost, are shown first.</p>
    <div class="ctl"><button class="primary" id="coachTrain">Start training</button></div></div></div>`;
  el.innerHTML=h;
  el.querySelectorAll('[data-ins]').forEach(b=>b.onclick=()=>startSession(INS[+b.dataset.ins].set,INS[+b.dataset.ins].title));
  $('coachTrain').onclick=()=>{T=null;show('train')};
}

/* ================= progress ================= */
function renderProgress(){
  const el=$('prog2'),d=D,now=Date.now(),wl=t=>'week of '+fmtD(t);
  const A=l=>l.filter(x=>x.t>=now-7*DAY),B=l=>l.filter(x=>x.t<now-7*DAY&&x.t>=now-35*DAY);
  const blPer=l=>l.length?l.reduce((a,g)=>a+g.mistakes.filter(m=>m.sev==='Blunder').length,0)/l.length:null;
  const accPer=l=>l.length?avg(l.map(g=>g._acc)):null;
  const cmp=(a,b,lowerBetter,unit,dec)=>a==null?'no games':b==null?'nothing to compare yet':
    (Math.abs(a-b)<(dec?0.05:0.5)?'level with':((a<b)===lowerBetter?'▲ better than':'▼ worse than'))+' '+b.toFixed(dec)+unit+' before';
  const rr=MG.filter(m=>m.rated&&m.r&&m.tc===d.rtc),r7=A(rr),rPrev=rr.filter(m=>m.t<now-7*DAY).pop();
  const rDelta=r7.length&&rPrev?r7[r7.length-1].r-rPrev.r:null;
  const ba=blPer(A(G)),bb=blPer(B(G)),aa=accPer(A(G)),ab=accPer(B(G)),sa=A(MG).length?score(A(MG)):null,sb=B(MG).length?score(B(MG)):null;
  let h=`<div class="card"><h2>Last 7 days compared with the 4 weeks before</h2><div class="tiles">
    ${tile(rDelta==null?'–':(rDelta>=0?'+':'')+rDelta,(d.rtc||'')+' rating change',r7.length?r7.length+' rated games':'no rated games')}
    ${tile(sa==null?'–':Math.round(sa)+'%','score',cmp(sa,sb,false,'%',0))}
    ${tile(ba==null?'–':ba.toFixed(1),'blunders per game',cmp(ba,bb,true,'',1))}
    ${tile(aa==null?'–':Math.round(aa)+'%','accuracy (est.)',cmp(aa,ab,false,'%',0))}</div></div>`;
  const wr=d.weeks.filter(w=>w.r).map(w=>({x:wl(w.t),y:w.r})),wa=d.weeks.filter(w=>w.an.length);
  h+=`<div class="card"><h2>${esc(d.rtc||'')} rating at the end of each week</h2>${lineChart(wr)}</div>`;
  h+=`<div class="grid2"><div class="card"><h2>Blunders per game, by week</h2>${lineChart(wa.map(w=>({x:wl(w.t),y:Math.round(blPer(w.an)*10)/10})))}</div>
    <div class="card"><h2>Accuracy, by week</h2>${lineChart(wa.map(w=>({x:wl(w.t),y:Math.round(accPer(w.an))})),'%')}</div></div>`;
  const per=(w,f)=>(w.an.reduce((a,g)=>a+g.mistakes.filter(f).length,0)/w.an.length).toFixed(1);
  h+=`<div class="card"><h2>Week by week</h2><div class="scroll"><table><tr><th>Week of</th><th>Games</th><th>Score</th><th>Rating</th><th>Analysed</th><th>Blunders / game</th><th>Hung pieces / game</th><th>Missed tactics / game</th><th>Accuracy</th></tr>
    ${d.weeks.slice(-8).reverse().map(w=>`<tr><td>${fmtD(w.t)}</td><td>${w.games.length}</td><td>${w.games.length?Math.round(score(w.games))+'%':'–'}</td><td>${w.r||'–'}</td><td>${w.an.length}</td>
      <td>${w.an.length?per(w,m=>m.sev==='Blunder'):'–'}</td><td>${w.an.length?per(w,m=>HANG.includes(m.motif)):'–'}</td><td>${w.an.length?per(w,m=>/^Missed/.test(m.motif)):'–'}</td><td>${w.an.length?Math.round(accPer(w.an))+'%':'–'}</td></tr>`).join('')}</table></div>
    <p class="dim">Blunders, mistake types and accuracy come from engine-analysed games only (${G.length} so far). To see further back, analyse more.</p>
    <div class="ctl"><button id="more" ${busy||S.opts.n>=160?'disabled':''}>Analyse ${Math.min(160,S.opts.n*2)} games instead of ${S.opts.n}</button></div></div>`;
  // training days vs rating
  const days={};let prevR=null;
  for(const m of rr){const k=dayKey(m.t);if(!days[k])days[k]={start:prevR,end:m.r};days[k].end=m.r;prevR=m.r}
  const dl=Object.entries(days).filter(([k,v])=>v.start!=null).map(([k,v])=>[S.log[k]>0,v.end-v.start]);
  const tr=dl.filter(x=>x[0]).map(x=>x[1]),no=dl.filter(x=>!x[0]).map(x=>x[1]),sg=v=>(v>=0?'+':'')+v.toFixed(1);
  const trainedDays=Object.keys(S.log).length,cards=Object.values(S.log).reduce((a,b)=>a+b,0);
  h+=`<div class="card"><h2>Does training move your rating?</h2><div class="tiles">
    ${tile(tr.length?sg(avg(tr)):'–','avg rating change on days you trained',tr.length+' playing days')}
    ${tile(no.length?sg(avg(no)):'–','avg rating change on other days',no.length+' playing days')}
    ${tile(trainedDays,'days trained',cards+' cards reviewed')}</div>
    <p class="dim">${tr.length>=5&&no.length>=5?'This is a correlation, not proof: you may simply train on days you feel sharp.':'This needs at least five playing days of each kind before the comparison means anything. Train on some days before you play and check back.'}</p></div>`;
  el.innerHTML=h;wireCharts(el);
  $('more').onclick=()=>{S.opts.n=Math.min(160,S.opts.n*2);save();update()};
}

/* ================= board ================= */
function drawBoard(fen,flip,marks,playable){
  const rows=fen.split(' ')[0].split('/'),cells=[];
  for(let r=0;r<8;r++){let f=0;for(const ch of rows[r]){if(ch>='1'&&ch<='8')for(let i=0;i<+ch;i++)cells.push([r,f++,null]);else cells.push([r,f++,ch])}}
  if(flip)cells.reverse();
  const el=$('board');el.classList.toggle('play',!!playable);
  el.innerHTML=cells.map(([r,f,p])=>{const sq='abcdefgh'[f]+(8-r),side=p?(p===p.toUpperCase()?'w':'b'):'';
    return `<div class="s ${(r+f)%2?'d':'l'} ${side} ${marks[sq]||''}" data-sq="${sq}">${p?'<span>'+GLYPH[p.toLowerCase()]+'︎</span>':''}</div>`}).join('');
}
$('board').onclick=e=>{const s=e.target.closest('.s');if(s)onSquare(s.dataset.sq)};

/* ================= trainer (spaced repetition) ================= */
let T=null,trainEngine=null;
function buildQueue(){
  const due=dueCards().sort((a,b)=>S.cards[a.id].due-S.cards[b.id].due);
  const wd=c=>c.drop*OW[c.g.m.o],fresh=newCards().sort((a,b)=>b.pri-a.pri||wd(b)-wd(a)).slice(0,NEW_PER_SESSION);
  return due.concat(fresh);            // everything that is due, plus a few new cards
}
function startSession(set,label){
  let q;
  if(set){const rank=m=>!S.cards[m.id]?0:S.cards[m.id].due<=Date.now()?1:2;q=set.slice().sort((a,b)=>rank(a)-rank(b)||b.drop-a.drop).slice(0,MAX_SESSION)}
  else q=buildQueue();
  T={q,i:0,label:label||'',right:0,first:0,review:false};show('train');nextCard(0);
}
function nextCard(step){
  T.i+=step;if(T.i>=T.q.length)return endSession();
  const m=T.q[T.i],r=replay(m.g);
  Object.assign(T,{m,fens:r.fens,ucis:r.ucis,ply:m.ply,state:'ask',firstTry:!T.retry||!T.retry[m.id],hints:0,sel:null,targets:[],tryFen:null,verdict:'',checking:false});
  $('trainEmpty').classList.add('hide');$('trainer').classList.remove('hide');paint();
}
function endSession(){
  $('trainer').classList.add('hide');const e=$('trainEmpty');e.classList.remove('hide');
  const due=dueCards().length,fresh=newCards().length;let h='';
  if(T&&T.first)h+=`<h3>Session done</h3><p>${T.right} of ${T.first} right on the first try.</p>`;else h+='<h3>Nothing to review right now</h3>';
  const up=CARDS.map(m=>S.cards[m.id]).filter(c=>c&&c.due>Date.now()).map(c=>c.due).sort((a,b)=>a-b)[0];
  if(due||fresh)h+=`<p class="dim">${due} due · ${fresh} new waiting.</p><button class="primary" id="again">Start another session</button>`;
  else if(up)h+=`<p class="dim">Next review: ${new Date(up).toLocaleDateString(undefined,{weekday:'long',month:'short',day:'numeric'})}. Play some games, then press "Get new games" on the overview.</p>`;
  else h+=`<p class="dim">${busy?'The engine is still analysing your games. Cards appear here as it finishes each one.':'No mistakes found yet.'}</p>`;
  e.innerHTML=h;const a=$('again');if(a)a.onclick=()=>startSession();T=null;badge();
}
function paint(){
  const m=T.m,g=m.g,flip=g.me==='b',marks={};
  const mark=(u,c)=>{if(u){marks[u.slice(0,2)]=c;marks[u.slice(2,4)]=c}};
  let fen=T.fens[T.ply];const asking=T.state==='ask'&&T.ply===m.ply;
  if(T.state==='ask'){
    if(T.tryFen){fen=T.tryFen;mark(T.tryUci,'last')}
    else{if(T.ply>0)mark(T.ucis[T.ply-1],'last');if(T.hints>=2)marks[m.best.slice(0,2)]='hint';
      if(T.sel){marks[T.sel]='sel';T.targets.forEach(t=>marks[t]=(marks[t]||'')+' dot')}}
  }else if(T.ply===m.ply){mark(T.ucis[m.ply],'bad');mark(m.best,'good')}
  else if(T.ply>0)mark(T.ucis[T.ply-1],'last');
  drawBoard(fen,flip,marks,asking&&!T.tryFen);
  const moveNo=Math.floor(m.ply/2)+1,side=g.me==='w'?'White':'Black';
  let h=`<div class="dim">${T.review?'Review':'Card '+(T.i+1)+' of '+T.q.length}${T.label?' · '+esc(T.label):''}</div>
    <h3>You are ${side}. Find the best move.</h3>
    <div class="dim">Move ${moveNo} vs ${esc(g.m.opp)} · ${esc(g.m.tc)} · ${fmtD(g.t)}${m.leak?' · you reached this position '+m.leak+' times':''}</div>`;
  if(T.state==='ask'){
    h+=T.verdict||`<p>${m.leak?'You keep playing the same inaccurate move here.':'You went wrong in this position.'} Tap a piece, then the square to move it to.</p>`;
    if(T.hints>=1)h+=`<p class="dim">Hint: ${esc(hintText(m))}${T.hints>=2?' The piece to move is outlined.':''}</p>`;
    h+=`<div class="ctl">`+(T.tryFen&&!T.checking?`<button class="primary" id="retry">Try again</button>`:'')+
      (T.hints<2&&!T.tryFen?`<button id="hint">${T.hints?'Another hint':'Hint'}</button>`:'')+`<button id="giveup">Show answer</button></div>`;
  }else{
    h+=T.verdict+`<p><span class="pill">${m.sev}</span><span class="pill">${esc(m.motif)}</span><span class="pill">${m.phase}</span>${m.fast?'<span class="pill">played instantly</span>':''}${m.low?'<span class="pill">low on time</span>':''}</p>
      <p>In the game you played <b style="color:var(--crit)">${esc(m.san)}</b> — win chance ${Math.round(m.wb)}% → ${m.wa}%.`+(m.reply?` The punishment was <b>${esc(m.reply)}</b>.`:'')+
      `<br>Best was <b style="color:var(--good)">${esc(m.bestSan)}</b>`+(m.line&&m.line!==m.bestSan?` <span class="dim">(${esc(m.line)})</span>`:'')+`.</p>
      <div class="why"><p><b>Why:</b> ${esc(explain(m,T.fens[m.ply]))}</p><p><b>Rule:</b> ${esc(ruleOf(m))}</p></div>
      <div class="ctl"><button id="prev" ${T.ply<=0?'disabled':''} aria-label="Previous move">◀</button><button id="here">Position</button>
        <button id="fwd" ${T.ply>=T.fens.length-1?'disabled':''} aria-label="Next move">▶</button>
        <a href="${esc(g.u)}" target="_blank" rel="noopener noreferrer" style="align-self:center">open game</a></div>
      <div class="ctl">${T.review?'<button id="backList">Back to list</button>':`<button class="primary" id="next">${T.i+1<T.q.length?'Next card':'Finish'}</button>`}</div>`;
    if(!T.review){const c=S.cards[m.id];if(c){const dd=Math.round((c.due-today())/DAY);h+=`<p class="dim">Comes back ${dd<=0?'later today':dd===1?'tomorrow':'in '+dd+' days'}.</p>`}}
  }
  $('side').innerHTML=h;
  const on=(id,fn)=>{const b=$(id);if(b)b.onclick=fn};
  on('hint',()=>{T.hints++;paint()});on('giveup',()=>finish('giveup'));
  on('retry',()=>{T.tryFen=null;T.verdict='';T.sel=null;T.targets=[];paint()});
  on('next',()=>nextCard(1));on('prev',()=>{T.ply--;paint()});on('fwd',()=>{T.ply++;paint()});on('here',()=>{T.ply=m.ply;paint()});
  on('backList',()=>{T=null;show('browse')});
}
function attackedBy(fen,sq,color){       // can `color` capture on sq in this position?
  const f=fen.split(' ');f[1]=color;f[3]='-';
  try{return new Chess(f.join(' ')).moves({verbose:true}).some(x=>x.to===sq&&x.captured)}catch(e){return false}
}
function explain(m,fen){                  // plain-language reason for the best move, built from the engine line by rules
  const ch=new Chess(fen),me=m.g.me,opp=me==='w'?'b':'w',mv=ch.move(uciMove(m.best));if(!mv)return '';
  const name=PIECE[mv.piece].toLowerCase(),parts=[];let swing=0;
  {const c2=new Chess(fen),s0=material(c2,me);for(const x of (m.line||'').split(' ').filter(Boolean)){if(!c2.move(x,{sloppy:true}))break}swing=material(c2,me)-s0}
  if(ch.in_checkmate())parts.push('It is checkmate.');
  else if(m.motif==='Missed a forced mate')parts.push('It starts a forced checkmate: every reply loses to another check.');
  else if(mv.captured){
    const victim=PIECE[mv.captured].toLowerCase(),def=attackedBy(ch.fen(),mv.to,opp);
    parts.push(`It takes the ${victim} on ${mv.to}`+(!def?', which was not defended':VAL[mv.captured]>VAL[mv.piece]?`, which is worth more than your ${name}`:swing>=2?' and you come out ahead in the exchange':'')+'.');
    if(ch.in_check())parts.push('It also gives check.');
  }else if(/[kq]/.test(mv.flags))parts.push('It castles: your king gets safe and your rook joins the game.');
  else if(mv.promotion)parts.push('It promotes the pawn.');
  else{
    const was=attackedBy(fen,mv.from,opp),now=attackedBy(ch.fen(),mv.to,opp);
    if(was&&!now&&mv.piece!=='p'&&mv.piece!=='k')parts.push(`Your ${name} on ${mv.from} was under attack; this moves it to a safe square.`);
    else if(ch.in_check())parts.push('It gives check and forces your opponent to react.');
    else if(swing>=2)parts.push(`It sets up a win of material${m.line?' ('+m.line+')':''}.`);
    else if(m.ply<20&&/[nb]/.test(mv.piece)&&/[18]/.test(mv.from[1]))parts.push(`It develops your ${name} to an active square.`);
    else parts.push(mv.piece==='p'?'A solid pawn move that leaves nothing loose.':mv.piece==='k'?'It puts your king on a safer, more useful square.':`It improves your ${name} without leaving anything loose.`);
  }
  if(HANG.includes(m.motif)&&m.reply)parts.push(`Your move ${m.san} allowed ${m.reply}; this one does not.`);
  else if(m.motif==='Walked into mate')parts.push(`Your move ${m.san} let your opponent start a mating attack.`);
  else if(m.leak)parts.push(`You have played ${m.san} here ${m.leak} times.`);
  return parts.join(' ');
}
function ruleOf(m){
  let r;
  if(m.leak)r='Fix a repeated opening move once and it pays off in every future game.';
  else if(m.motif==='Missed a forced mate')r='When the enemy king is exposed, look at every check before anything else.';
  else if(m.motif==='Walked into mate')r='Before every move, ask what your opponent\'s checks are.';
  else if(m.motif==='Missed a winning tactic')r='Checks, captures, threats: look at yours first on every move.';
  else if(HANG.includes(m.motif))r='Before you let go of a piece, check what your opponent can capture afterwards.';
  else if(m.winning)r='When you are ahead, simplify and remove counterplay first.';
  else if(m.phase==='Opening')r='In the opening: develop a new piece each move, castle early, do not move the same piece twice.';
  else if(m.phase==='Endgame')r='In the endgame: activate your king and push your passed pawns.';
  else r='No tactic on the board? Find your worst-placed piece and improve it.';
  if(m.fast)r+=' You played this move instantly: take three seconds first.';else if(m.low)r+=' You were low on time here: keep a reserve for moments like this.';
  return r;
}
function hintText(m){
  if(m.leak)return 'A natural developing move. Think about what your usual move allows.';
  if(m.motif==='Missed a forced mate')return 'There is a forced checkmate.';
  if(m.motif==='Walked into mate')return 'Your king is in danger. Deal with the threat first.';
  if(m.motif==='Missed a winning tactic')return 'You can win material here.';
  if(HANG.includes(m.motif))return 'One of your pieces is (or is about to be) loose. Keep everything protected.';
  return 'No fireworks. Look for the safest, most useful move.';
}
function onSquare(sq){
  if(!T||T.state!=='ask'||T.ply!==T.m.ply||T.tryFen)return;
  const ch=new Chess(T.fens[T.ply]);
  if(T.sel&&T.targets.includes(sq))return attempt(T.sel,sq);
  const p=ch.get(sq);
  if(p&&p.color===T.m.g.me){T.sel=sq;T.targets=ch.moves({square:sq,verbose:true}).map(x=>x.to)}else{T.sel=null;T.targets=[]}
  paint();
}
async function attempt(from,to){
  const m=T.m,ch=new Chess(T.fens[T.ply]),p=ch.get(from);
  let promo='';if(p.type==='p'&&/[18]/.test(to[1]))promo=(m.best.slice(0,4)===from+to&&m.best[4])||'q';
  const uci=from+to+promo,mv=ch.move(uciMove(uci));if(!mv)return;
  T.sel=null;T.targets=[];T.tryFen=ch.fen();T.tryUci=uci;
  if(uci===m.best)return finish('best');
  T.checking=true;T.verdict='<p class="dim">Checking your move…</p>';paint();
  let loss=null;const card=m;
  try{if(!trainEngine)trainEngine=await Engine.create();
    const ev=await trainEngine.analyse(ch.fen(),Math.max(11,m.g.d||11));loss=m.wb-winPct((m.g.me==='w'?1:-1)*ev.cp)}catch(e){}
  if(!T||T.m!==card)return;
  T.checking=false;
  if(loss!=null&&loss<=GOOD_ENOUGH)return finish('good',mv.san);
  if(T.firstTry)grade(false);
  T.verdict=`<div class="verdict" style="color:var(--crit)">✕ Not quite${uci===T.ucis[m.ply]?' — that is what you played in the game':''}.</div>
    <p class="dim">${esc(mv.san)}${loss!=null?' gives up about '+Math.round(loss)+' points of win chance':' is not the engine’s move'}. Try again or see the answer.</p>`;
  paint();
}
function grade(ok){
  const m=T.m;T.firstTry=false;if(T.review)return;
  T.first++;if(ok)T.right++;
  const c=S.cards[m.id]||(S.cards[m.id]={box:0,n:0,ok:0});c.n++;
  if(ok){c.ok++;c.box=T.hints?Math.max(1,c.box):Math.min(6,c.box+1)}else c.box=1;
  c.due=today()+INTERVALS[c.box]*DAY;const k=dayKey(Date.now());S.log[k]=(S.log[k]||0)+1;save();
  if(!ok){T.retry=T.retry||{};if(!T.retry[m.id]){T.retry[m.id]=1;T.q.push(m)}}
}
function finish(kind,san){
  if(T.firstTry)grade(kind!=='giveup');
  T.verdict=kind==='best'?'<div class="verdict" style="color:var(--good)">✓ Correct — the best move.</div>'
    :kind==='good'?`<div class="verdict" style="color:var(--good)">✓ Good — ${esc(san)} works too.</div>`:'<div class="verdict">Here is the answer.</div>';
  T.state='done';T.tryFen=null;T.ply=T.m.ply;paint();badge();
}
function badge(){const due=dueCards().length,b=$('dueBadge');b.textContent=due;b.classList.toggle('hide',!due)}

/* ================= browse ================= */
function renderBrowse(){
  const sel=$('browseFilter'),curv=sel.value||'all';
  sel.innerHTML='<option value="all">All types</option>'+tally(CARDS,'motif').map(([k,c])=>`<option value="${esc(k)}">${esc(k)} (${c})</option>`).join('');
  sel.value=[...sel.options].some(o=>o.value===curv)?curv:'all';
  const list=CARDS.filter(m=>sel.value==='all'||m.motif===sel.value).sort((a,b)=>b.g.t-a.g.t||a.ply-b.ply);
  $('browseTitle').textContent=list.length+' position'+(list.length===1?'':'s');
  $('list').innerHTML=list.map(m=>{const g=m.g,c=S.cards[m.id],no=Math.floor(m.ply/2)+1,st=!c?'new':c.box>=4?'mastered':c.due<=Date.now()?'due':'learning';
    return `<div class="item" data-id="${esc(m.id)}"><div><b>${no}${g.me==='w'?'.':'…'} ${esc(m.san)}</b> <span class="pill" style="margin-left:6px">${m.sev}</span>
      <small>${esc(m.motif)} · ${m.phase} · −${m.drop}% · vs ${esc(g.m.opp)} · ${fmtD(g.t)}</small></div><span class="pill" style="align-self:center">${st}</span></div>`}).join('')
    ||`<p class="dim">${busy?'The engine is still working. Mistakes appear here as each game is finished.':'Nothing here.'}</p>`;
  document.querySelectorAll('.item').forEach(el=>el.onclick=()=>{
    const m=CARDS.find(x=>x.id===el.dataset.id),r=replay(m.g);
    T={q:[m],i:0,review:true,label:'',m,fens:r.fens,ucis:r.ucis,ply:m.ply,state:'done',verdict:'',hints:0,firstTry:false};
    show('train',true);$('trainEmpty').classList.add('hide');$('trainer').classList.remove('hide');paint()});
}
$('browseFilter').onchange=renderBrowse;

/* ================= navigation ================= */
let cur='over';
function render(){if(cur==='over')renderOver();else if(cur==='coach')renderCoach();else if(cur==='prog2')renderProgress();else if(cur==='browse')renderBrowse();badge()}
function show(tab,keep){
  cur=tab;['over','coach','train','prog2','browse'].forEach(t=>$(t).classList.toggle('hide',t!==tab));
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.tab===tab));
  if(tab==='train'){if(!keep&&(!T||T.review)){derive();startSession()}}else{derive();render()}
  window.scrollTo(0,0);
}
function showApp(){$('setup').classList.add('hide');$('tabs').classList.remove('hide');show('over')}
document.querySelectorAll('#tabs button').forEach(b=>b.onclick=()=>show(b.dataset.tab));
$('go').onclick=()=>{
  const u=$('user').value.trim();if(!u){$('user').focus();return}
  if(typeof Chess==='undefined'){$('error').textContent='Could not load the chess library. Check your internet connection and reload.';$('error').classList.remove('hide');return}
  S.user=u;S.opts={n:+$('count').value,tc:$('tc').value,mode:$('mode').value};F.tc='all';save();$('setup').classList.add('hide');update();
};
$('user').onkeydown=e=>{if(e.key==='Enter')$('go').click()};
document.addEventListener('keydown',e=>{
  if(!T||T.state!=='done'||cur!=='train')return;
  if(e.key==='ArrowLeft'&&T.ply>0){T.ply--;paint()}else if(e.key==='ArrowRight'&&T.ply<T.fens.length-1){T.ply++;paint()}
  else if(e.key==='Enter'&&!T.review)nextCard(1);
});

/* ================= boot ================= */
$('user').value=S.user||'';$('count').value=S.opts.n;$('tc').value=S.opts.tc;$('mode').value=S.opts.mode;
if(S.user&&typeof Chess!=='undefined'&&Object.values(S.meta).some(m=>m.usr===S.user.toLowerCase())){showApp();if(dueCards().length)show('train')}
