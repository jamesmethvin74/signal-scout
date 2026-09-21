// FREQBEACON Zero — strong-signal seek preview.
// Observes real Kiwi W/F frames; tuning stays owned by the qualified Zero dial.
const canvas=document.querySelector('#rfCanvas');
const leftEl=document.querySelector('#leftEdge');
const rightEl=document.querySelector('#rightEdge');
const freqEl=document.querySelector('#frequencyValue');
const host=document.querySelector('.tuning-caption');
if(!canvas||!leftEl||!rightEl||!freqEl||!host) throw new Error('Zero signal seek could not attach');

host.classList.add('zero-signal-seek');
host.innerHTML='<span class="zero-signal-seek-label">SIGNAL</span><div class="zero-signal-seek-buttons" role="group" aria-label="Strong signal seek"><button type="button" data-zero-signal-seek="-1" aria-label="Previous strong signal" title="Previous strong signal">◀</button><button type="button" data-zero-signal-seek="1" aria-label="Next strong signal" title="Next strong signal">▶</button></div><small data-zero-signal-seek-status aria-live="polite">WAIT</small>';

const buttons=[...host.querySelectorAll('[data-zero-signal-seek]')];
const status=host.querySelector('[data-zero-signal-seek-status]');
const seen=new WeakSet();
const frames=[];
let currentViewKey='';
let busyUntil=0;

function num(el){const m=String(el?.textContent||'').match(/-?\d+(?:\.\d+)?/);return m?Number(m[0]):NaN}
function view(){const l=num(leftEl)*1000,r=num(rightEl)*1000;return Number.isFinite(l)&&Number.isFinite(r)&&r>l?{left:l,right:r,span:r-l}:null}
function key(){const v=view();return v?v.left.toFixed(3)+'|'+v.right.toFixed(3):''}
function tuned(){const mhz=Number(freqEl.textContent);return Number.isFinite(mhz)?mhz*1000:NaN}
function mode(){return document.querySelector('[data-shell-mode].active')?.dataset.shellMode||'am'}
function median(a){const s=Array.from(a).sort((x,y)=>x-y),m=Math.floor(s.length/2);return s.length%2?s[m]:(s[m-1]+s[m])/2}
function pct(a,p){const s=Array.from(a).sort((x,y)=>x-y);return s[Math.max(0,Math.min(s.length-1,Math.floor((s.length-1)*p)))]}
function refresh(){const ok=frames.length>=3;buttons.forEach(b=>b.disabled=!ok);if(performance.now()>=busyUntil)status.textContent=ok?'SEEK':frames.length?'LOCK':'WAIT'}
function clearFrames(){frames.length=0;currentViewKey=key();refresh()}
function flash(text,ms=900){busyUntil=performance.now()+ms;status.textContent=text;setTimeout(()=>{if(performance.now()>=busyUntil){busyUntil=0;refresh()}},ms+40)}

function spectrum(){
  if(frames.length<3)return null;
  const out=new Float32Array(1024),sample=new Array(frames.length);
  for(let i=0;i<1024;i++){for(let f=0;f<frames.length;f++)sample[f]=frames[f][i];out[i]=median(sample)}
  const smooth=new Float32Array(1024);
  for(let i=0;i<1024;i++){let sum=0,n=0;for(let j=Math.max(0,i-2);j<=Math.min(1023,i+2);j++){sum+=out[j];n++}smooth[i]=sum/n}
  return smooth;
}
function baseline(a,i){const s=[];for(let d=10;d<=28;d++){if(i-d>=0)s.push(a[i-d]);if(i+d<a.length)s.push(a[i+d])}return median(s)}
function localPeak(a,i){for(let j=i-4;j<=i+4;j++)if(j>=0&&j<a.length&&j!==i&&a[j]>a[i])return false;return true}
function candidates(){
  const v=view(),a=spectrum();if(!v||!a)return[];
  const floor=pct(a,.52),top=pct(a,.995);
  const threshold=floor+Math.max(8.5,Math.min(14,(top-floor)*.34));
  const m=mode(),sepKHz=(m==='am'||m==='sam')?3.2:m==='nbfm'?4.5:m==='cw' ? 0.25 : 0.7;
  const sep=Math.max(8,Math.round(sepKHz/(v.span/1024)));
  const raw=[];
  for(let i=28;i<996;i++){
    if(a[i]<threshold||!localPeak(a,i))continue;
    const b=baseline(a,i);if(a[i]-b<4.5)continue;
    raw.push({bin:i,db:a[i],prom:a[i]-b,freq:v.left+((i+.5)/1024)*v.span});
  }
  const merged=[];
  for(const c of raw){const p=merged[merged.length-1];if(p&&c.bin-p.bin<sep){if(c.db>p.db)merged[merged.length-1]=c}else merged.push(c)}
  return merged;
}
function tap(freq){
  const v=view(),r=canvas.getBoundingClientRect();if(!v||!r.width||freq<v.left||freq>v.right)return false;
  const x=r.left+Math.max(.002,Math.min(.998,(freq-v.left)/v.span))*r.width;
  const y=r.top+Math.max(8,Math.min(r.height-8,r.height*.18));
  const make=(type,buttons)=>new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:9207,pointerType:'mouse',isPrimary:true,clientX:x,clientY:y,buttons});
  canvas.dispatchEvent(make('pointerdown',1));canvas.dispatchEvent(make('pointerup',0));return true;
}
function seek(dir){
  if(frames.length<3){flash('WAIT',650);return}
  const now=tuned();if(!Number.isFinite(now))return;
  const m=mode(),guard=(m==='am'||m==='sam')?2.4:m==='nbfm'?3.5:m==='cw' ? 0.18 : 0.4;
  let list=candidates().filter(c=>dir>0?c.freq>now+guard:c.freq<now-guard);
  if(dir<0)list=list.reverse();
  const target=list[0];if(!target){flash('NONE');return}
  const freq=Math.round(target.freq);
  if(tap(freq)){flash(freq+'k',1100);window.dispatchEvent(new CustomEvent('freqbeacon:zero-signal-seek',{detail:{direction:dir,frequencyKHz:freq,detectedFrequencyKHz:target.freq,db:target.db,prominenceDb:target.prom}}))}
}
buttons.forEach(b=>{b.disabled=true;b.addEventListener('click',()=>seek(Number(b.dataset.zeroSignalSeek)))});

function ingest(bytes){
  const k=key();if(!k)return;if(currentViewKey&&currentViewKey!==k)frames.length=0;currentViewKey=k;
  const frame=new Float32Array(1024);for(let i=0;i<1024;i++)frame[i]=bytes[i]-255;
  frames.push(frame);if(frames.length>5)frames.shift();refresh();
}
function onMessage(event){
  if(!(event.data instanceof ArrayBuffer))return;
  const b=new Uint8Array(event.data);if(b.length<1040||b[0]!==87||b[1]!==47||b[2]!==70)return;
  ingest(b.subarray(16,1040));
}
const previousSend=WebSocket.prototype.send;
WebSocket.prototype.send=function zeroSignalSeekSend(data){
  if(typeof data==='string'&&data.includes('SERVER DE CLIENT FREQBEACON-ZERO W/F')&&!seen.has(this)){seen.add(this);this.addEventListener('message',onMessage)}
  return previousSend.call(this,data);
};

const observer=new MutationObserver(()=>{const k=key();if(k&&k!==currentViewKey)clearFrames()});
observer.observe(leftEl,{childList:true,characterData:true,subtree:true});
observer.observe(rightEl,{childList:true,characterData:true,subtree:true});
window.addEventListener('freqbeacon:zero-zoom',clearFrames);
window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
refresh();
