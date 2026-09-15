import { inflateRawSync } from 'node:zlib';

export function clean(v){ return String(v ?? '').trim(); }
export function headerKey(v){ return clean(v).toLowerCase().replace(/[^a-z0-9]+/g,''); }
export function num(v){ const n=Number(clean(v).replace(/,/g,'')); return Number.isFinite(n)?n:null; }
export function parseCsv(text){
  const rows=[]; let row=[], cell='', q=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){ if(q && text[i+1]==='"'){cell+='"';i++;} else q=!q; }
    else if(c===',' && !q){ row.push(cell); cell=''; }
    else if((c==='\n'||c==='\r') && !q){ if(c==='\r'&&text[i+1]==='\n') i++; row.push(cell); if(row.some(x=>x!=='')) rows.push(row); row=[]; cell=''; }
    else cell+=c;
  }
  if(cell || row.length){row.push(cell); rows.push(row);} return rows;
}
export function rowsToObjects(rows){ if(rows.length<2) throw new Error('CSV contains no data rows'); const h=rows[0].map(clean); return rows.slice(1).map(r=>Object.fromEntries(h.map((k,i)=>[k,clean(r[i])]))); }
export function pick(obj, aliases){ const m=new Map(Object.keys(obj).map(k=>[headerKey(k),k])); for(const a of aliases){const k=m.get(headerKey(a)); if(k) return obj[k];} return ''; }
export function requireAnyHeaders(headers, groups, label){ const set=new Set(headers.map(headerKey)); for(const group of groups){ if(!group.some(h=>set.has(headerKey(h)))) throw new Error(`${label} missing required header: ${group.join(' | ')}; got ${headers.join(', ')}`); } }

export function parseDbf(buf){
  if(!Buffer.isBuffer(buf)) buf=Buffer.from(buf);
  if(buf.length<32) throw new Error('DBF too short');
  const records=buf.readUInt32LE(4), headerLen=buf.readUInt16LE(8), recordLen=buf.readUInt16LE(10);
  if(headerLen<33 || recordLen<2 || headerLen>buf.length) throw new Error('Invalid DBF header');
  const fields=[];
  for(let o=32;o+32<=headerLen && buf[o]!==0x0d;o+=32){
    const zero=buf.indexOf(0,o); const end=(zero>=o && zero<o+11)?zero:o+11;
    const name=buf.toString('latin1',o,end).trim(); const type=String.fromCharCode(buf[o+11]); const len=buf[o+16]; const dec=buf[o+17];
    if(name) fields.push({name,type,len,dec});
  }
  const out=[];
  for(let i=0;i<records;i++){
    const base=headerLen+i*recordLen; if(base+recordLen>buf.length) break; if(buf[base]===0x2a) continue;
    let p=base+1; const row={};
    for(const f of fields){ const raw=buf.toString('latin1',p,p+f.len).trim(); p+=f.len; row[f.name]=raw; }
    out.push(row);
  }
  return {fields,records:out};
}

export function ddmmssToDecimal(v, west=false){
  const raw=clean(v); if(!raw) return null; const sign=raw.startsWith('-')?-1:1; const digits=raw.replace(/[^0-9.]/g,''); const n=Number(digits); if(!Number.isFinite(n)) return null;
  const d=Math.floor(n/10000), m=Math.floor((n-d*10000)/100), s=n-d*10000-m*100; if(m>=60||s>=60) return null;
  let out=d+m/60+s/3600; if(west) out=-out; else out*=sign; return out;
}

function xmlDecode(s=''){return s.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&apos;/g,"'");}
export function unzipEntries(buf){
  if(!Buffer.isBuffer(buf)) buf=Buffer.from(buf); const out=new Map(); let eocd=-1;
  for(let i=buf.length-22;i>=Math.max(0,buf.length-65557);i--){if(buf.readUInt32LE(i)===0x06054b50){eocd=i;break;}}
  if(eocd<0) throw new Error('ZIP EOCD not found'); const count=buf.readUInt16LE(eocd+10); let p=buf.readUInt32LE(eocd+16);
  for(let i=0;i<count;i++){
    if(buf.readUInt32LE(p)!==0x02014b50) throw new Error('ZIP central directory corrupt');
    const method=buf.readUInt16LE(p+10), comp=buf.readUInt32LE(p+20), nameLen=buf.readUInt16LE(p+28), extraLen=buf.readUInt16LE(p+30), commentLen=buf.readUInt16LE(p+32), local=buf.readUInt32LE(p+42);
    const name=buf.toString('utf8',p+46,p+46+nameLen); if(buf.readUInt32LE(local)!==0x04034b50) throw new Error('ZIP local header corrupt');
    const ln=buf.readUInt16LE(local+26), le=buf.readUInt16LE(local+28), start=local+30+ln+le, data=buf.subarray(start,start+comp);
    if(!name.endsWith('/')) out.set(name, method===0?Buffer.from(data):method===8?inflateRawSync(data):(()=>{throw new Error(`Unsupported ZIP method ${method}`)})());
    p+=46+nameLen+extraLen+commentLen;
  }
  return out;
}
export function findZipEntry(entries, suffix){ const needle=suffix.toLowerCase(); for(const [n,b] of entries){if(n.toLowerCase().endsWith(needle)) return b;} return null; }

export function osGridToWgs84(ngr){
  const s=clean(ngr).toUpperCase().replace(/\s+/g,''); const m=s.match(/^([A-Z]{2})(\d{2,10})$/); if(!m||m[2].length%2) throw new Error(`Invalid OS grid reference: ${ngr}`);
  const l1=m[1].charCodeAt(0)-65-(m[1]>='I'?1:0), l2=m[1].charCodeAt(1)-65-(m[1][1]>='I'?1:0);
  const e100=((l1-2)%5)*5+(l2%5), n100=19-Math.floor(l1/5)*5-Math.floor(l2/5); if(e100<0||n100<0) throw new Error(`Invalid OS grid letters: ${ngr}`);
  const half=m[2].length/2, scale=10**(5-half); const E=e100*100000+Number(m[2].slice(0,half))*scale+scale/2, N=n100*100000+Number(m[2].slice(half))*scale+scale/2;
  const a=6377563.396,b=6356256.909,F0=0.9996012717,lat0=49*Math.PI/180,lon0=-2*Math.PI/180,N0=-100000,E0=400000,e2=1-(b*b)/(a*a),n=(a-b)/(a+b);
  let lat=lat0,M=0; do{lat=(N-N0-M)/(a*F0)+lat; const Ma=(1+n+5/4*n*n+5/4*n**3)*(lat-lat0), Mb=(3*n+3*n*n+21/8*n**3)*Math.sin(lat-lat0)*Math.cos(lat+lat0), Mc=(15/8*n*n+15/8*n**3)*Math.sin(2*(lat-lat0))*Math.cos(2*(lat+lat0)), Md=35/24*n**3*Math.sin(3*(lat-lat0))*Math.cos(3*(lat+lat0)); M=b*F0*(Ma-Mb+Mc-Md);}while(N-N0-M>=0.00001);
  const sin=Math.sin(lat),cos=Math.cos(lat),tan=Math.tan(lat),nu=a*F0/Math.sqrt(1-e2*sin*sin),rho=a*F0*(1-e2)/(1-e2*sin*sin)**1.5,eta2=nu/rho-1,dE=E-E0;
  const VII=tan/(2*rho*nu),VIII=tan/(24*rho*nu**3)*(5+3*tan*tan+eta2-9*tan*tan*eta2),IX=tan/(720*rho*nu**5)*(61+90*tan*tan+45*tan**4),X=1/(cos*nu),XI=1/(cos*6*nu**3)*(nu/rho+2*tan*tan),XII=1/(cos*120*nu**5)*(5+28*tan*tan+24*tan**4),XIIA=1/(cos*5040*nu**7)*(61+662*tan*tan+1320*tan**4+720*tan**6);
  const phi=lat-VII*dE*dE+VIII*dE**4-IX*dE**6, lam=lon0+X*dE-XI*dE**3+XII*dE**5-XIIA*dE**7;
  const H=0, sinP=Math.sin(phi),cosP=Math.cos(phi),sinL=Math.sin(lam),cosL=Math.cos(lam), v=a/Math.sqrt(1-e2*sinP*sinP);
  let x=(v+H)*cosP*cosL,y=(v+H)*cosP*sinL,z=((1-e2)*v+H)*sinP;
  const tx=446.448,ty=-125.157,tz=542.06,helmertScale=20.4894e-6,rx=0.1502*Math.PI/(180*3600),ry=0.2470*Math.PI/(180*3600),rz=0.8421*Math.PI/(180*3600);
  const x2=tx+(1+helmertScale)*x-rz*y+ry*z,y2=ty+rz*x+(1+helmertScale)*y-rx*z,z2=tz-ry*x+rx*y+(1+helmertScale)*z;
  const a2=6378137,b2=6356752.3141,e22=1-(b2*b2)/(a2*a2),p=Math.sqrt(x2*x2+y2*y2); let phi2=Math.atan2(z2,p*(1-e22)),prev;
  do{prev=phi2; const v2=a2/Math.sqrt(1-e22*Math.sin(phi2)**2); phi2=Math.atan2(z2+e22*v2*Math.sin(phi2),p);}while(Math.abs(phi2-prev)>1e-12);
  return {lat:phi2*180/Math.PI,lon:Math.atan2(y2,x2)*180/Math.PI};
}

function colIndex(ref){let n=0; for(const c of ref.match(/[A-Z]+/i)?.[0]||'') n=n*26+c.toUpperCase().charCodeAt(0)-64; return n-1;}
export function parseXlsxSheets(zipBuf){
  const z=unzipEntries(zipBuf), wb=findZipEntry(z,'xl/workbook.xml'), rel=findZipEntry(z,'xl/_rels/workbook.xml.rels'); if(!wb||!rel) throw new Error('XLSX workbook metadata missing');
  const sharedBuf=findZipEntry(z,'xl/sharedStrings.xml'); const shared=[]; if(sharedBuf){for(const m of sharedBuf.toString('utf8').matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)){shared.push(xmlDecode([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x=>x[1]).join('')));}}
  const relMap=new Map([...rel.toString('utf8').matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m=>[m[1],m[2]])); const sheets=[];
  for(const m of wb.toString('utf8').matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)){
    const target=relMap.get(m[2]); if(!target) continue; const key=target.startsWith('/')?target.slice(1):`xl/${target.replace(/^\.\//,'')}`; const xml=z.get(key); if(!xml) continue; const rows=[];
    for(const rm of xml.toString('utf8').matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)){const arr=[]; for(const cm of rm[1].matchAll(/<c[^>]*r="([A-Z]+\d+)"[^>]*?(?:t="([^"]+)")?[^>]*>([\s\S]*?)<\/c>/g)){const idx=colIndex(cm[1]),t=cm[2]||'',body=cm[3]; let val=''; const vm=body.match(/<v>([\s\S]*?)<\/v>/); const im=body.match(/<t[^>]*>([\s\S]*?)<\/t>/); if(t==='s'&&vm) val=shared[Number(vm[1])]??''; else if(im) val=xmlDecode(im[1]); else if(vm) val=xmlDecode(vm[1]); arr[idx]=val;} if(arr.some(v=>v!==undefined&&v!=='')) rows.push(arr.map(v=>v??''));}
    sheets.push({name:xmlDecode(m[1]),rows});
  } return sheets;
}
