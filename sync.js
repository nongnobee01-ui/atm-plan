/* atm-plan cross-device sync (Supabase RPC, no login, secret sync code) */
(function(){
  "use strict";
  if(/view\.html/.test(location.pathname)) return;
  var CFG=window.ATM_SYNC||{}; var MINE=!!window.__MINE, P=MINE?'mine_':'';
  var ACT=P+'atm_actuals_v1', TOMB=P+'atm_tomb_v1', TS=P+'atm_sync_ts_v1', CODEK='atm_sync_code_v1', LASTK='atm_sync_last_v1';
  var KEYS=[P+'atm_profile_v1',P+'atm_moves_v1',P+'atm_ready_v1',P+'atm_ready_log_v1'];
  if(MINE) KEYS.push('atm_custom_plan_v1','atm_plan_history_v1');
  var LS=window.localStorage, osSet=Storage.prototype.setItem, osRem=Storage.prototype.removeItem, applying=false, timer=null, busy=false;
  function J(k){ try{ return JSON.parse(LS.getItem(k)||'null'); }catch(e){ return null; } }
  function rawSet(k,v){ applying=true; try{ osSet.call(LS,k,v); }catch(e){} applying=false; }
  function rawRem(k){ applying=true; try{ osRem.call(LS,k); }catch(e){} applying=false; }
  function watched(k){ return k===ACT||k===TOMB||KEYS.indexOf(k)>-1; }
  function code(){ try{ return LS.getItem(CODEK)||''; }catch(e){ return ''; } }
  function ready(){ return !!(CFG.url&&CFG.key&&code()); }
  function now(){ return Date.now(); }
  // enrol from link  #sync=CODE
  (function(){ var m=(location.hash||'').match(/^#sync=([A-Za-z0-9]{20,64})$/); if(m){ try{ osSet.call(LS,CODEK,m[1]); }catch(e){} try{ history.replaceState(null,'',location.pathname+location.search); }catch(e){} } })();
  function mark(k){ var t=J(TS)||{}; t[k]=now(); rawSet(TS,JSON.stringify(t)); }
  Storage.prototype.setItem=function(k,v){
    if(this===LS&&!applying&&watched(k)){
      var old=(k===ACT)?J(ACT):null; osSet.apply(this,arguments);
      if(k===ACT){ var nw=J(ACT)||{}, tb=J(TOMB)||{}, ch=false; Object.keys(old||{}).forEach(function(d){ if(!(d in nw)){ tb[d]=now(); ch=true; } }); Object.keys(nw).forEach(function(d){ if(tb[d]&&(Date.parse(nw[d].updatedAt)||0)>tb[d]){ delete tb[d]; ch=true; } }); if(ch) rawSet(TOMB,JSON.stringify(tb)); }
      else if(k!==TOMB) mark(k);
      schedule(); return;
    }
    return osSet.apply(this,arguments);
  };
  Storage.prototype.removeItem=function(k){ var w=(this===LS&&!applying&&watched(k)); osRem.apply(this,arguments); if(w){ if(k!==ACT&&k!==TOMB) mark(k); schedule(); } };
  function schedule(){ if(!ready()) return; clearTimeout(timer); timer=setTimeout(sync,1500); }
  function hdr(){ var h={'Content-Type':'application/json',apikey:CFG.key}; if(/^eyJ/.test(CFG.key)) h.Authorization='Bearer '+CFG.key; return h; }
  function rpc(fn,body){
    return fetch(CFG.url.replace(/\/$/,'')+'/rest/v1/rpc/'+fn,{method:'POST',headers:hdr(),body:JSON.stringify(body)}).then(function(r){ if(!r.ok) throw new Error('http '+r.status); return r.text(); }).then(function(t){ return t?JSON.parse(t):null; });
  }
  function ts(b){ return (b&&Date.parse(b.updatedAt))||0; }
  function snapshot(){
    var a={}, acts=J(ACT)||{}, tomb=J(TOMB)||{}, k={}, t=J(TS)||{};
    Object.keys(acts).forEach(function(d){ a[d]=acts[d]; });
    Object.keys(tomb).forEach(function(d){ if(!a[d]||tomb[d]>ts(a[d])) a[d]={del:1,ts:tomb[d]}; });
    KEYS.forEach(function(key){ var raw=LS.getItem(key); if(raw!==null) k[key]={v:raw,ts:t[key]||0}; else if(t[key]) k[key]={v:null,ts:t[key]}; });
    return {a:a,k:k};
  }
  function merge(L,R){
    var out={a:{},k:{}}; R=R||{}; var ra=R.a||{}, rk=R.k||{};
    var ds={}; Object.keys(L.a).concat(Object.keys(ra)).forEach(function(d){ ds[d]=1; });
    Object.keys(ds).forEach(function(d){
      var x=L.a[d], y=ra[d]; if(!x){ out.a[d]=y; return; } if(!y){ out.a[d]=x; return; }
      var tx=x.del?x.ts:ts(x), ty=y.del?y.ts:ts(y); out.a[d]=(ty>tx)?y:x;
    });
    var ks={}; Object.keys(L.k).concat(Object.keys(rk)).forEach(function(d){ ks[d]=1; });
    Object.keys(ks).forEach(function(key){ var x=L.k[key], y=rk[key]; out.k[key]=!x?y:(!y?x:(y.ts>x.ts?y:x)); });
    return out;
  }
  function apply(M){
    var changed=false, acts={}, tomb={};
    Object.keys(M.a).forEach(function(d){ var v=M.a[d]; if(v.del) tomb[d]=v.ts; else acts[d]=v; });
    var cur=JSON.stringify(J(ACT)||{}), nw=JSON.stringify(acts); if(cur!==nw){ rawSet(ACT,nw); changed=true; }
    rawSet(TOMB,JSON.stringify(tomb));
    var t=J(TS)||{};
    Object.keys(M.k).forEach(function(key){ var e=M.k[key]; if(!e||KEYS.indexOf(key)<0) return; var raw=LS.getItem(key); if(e.v===null){ if(raw!==null){ rawRem(key); changed=true; } } else if(raw!==e.v){ rawSet(key,e.v); changed=true; } t[key]=e.ts; });
    rawSet(TS,JSON.stringify(t)); return changed;
  }
  function sync(){
    if(!ready()||busy) return Promise.resolve(); busy=true; setStatus('กำลังซิงก์…');
    return rpc('atm_get',{p_code:code()}).then(function(R){
      var L=snapshot(), M=merge(L,R), changed=apply(M);
      var same=JSON.stringify(M)===JSON.stringify(R||{});
      return (same?Promise.resolve():rpc('atm_put',{p_code:code(),p_data:M})).then(function(){
        rawSet(LASTK,String(now())); busy=false; setStatus('ซิงก์ล่าสุด '+new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'}));
        if(changed){ var last=+(sessionStorage.getItem('atm_sync_rl')||0); if(now()-last>15000){ try{ sessionStorage.setItem('atm_sync_rl',String(now())); }catch(e){} location.reload(); } }
      });
    }).catch(function(e){ busy=false; setStatus('ซิงก์ไม่สำเร็จ ('+(e&&e.message||'error')+') — ลองใหม่ภายหลัง'); });
  }
  var statusEl=null; function setStatus(t){ statusEl=document.getElementById('sy-status')||statusEl; if(statusEl) statusEl.textContent=t; }
  function genCode(){ var a=new Uint8Array(24); crypto.getRandomValues(a); var s='abcdefghijkmnpqrstuvwxyz23456789', o=''; for(var i=0;i<a.length;i++) o+=s[a[i]%s.length]; return o; }
  function openDlg(){
    var old=document.getElementById('sy-dlg'); if(old) old.remove();
    var d=document.createElement('div'); d.id='sy-dlg'; d.className='shdlg';
    var c=code(), link=c?(location.origin+location.pathname+'#sync='+c):'';
    d.innerHTML='<div class="shbox"><button class="shx" type="button" aria-label="ปิด">✕</button><h3>ซิงก์ข้ามเครื่อง</h3>'+
      (!CFG.url?'<p class="shp">ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์ซิงก์</p>':
      '<p class="shp">ผลวิ่ง โปรไฟล์ เช็กก่อนวิ่ง และการสลับวัน จะตามไปทุกเครื่องที่ใช้รหัสซิงก์เดียวกัน ไม่ต้องล็อกอิน รหัสคือกุญแจ อย่าส่งให้คนอื่น</p>'+
      (c?'<label class="shl">ลิงก์เชื่อมอีกเครื่อง (เปิดบนมือถือ)</label><textarea id="sy-link" class="shi" rows="3" readonly>'+link+'</textarea><button class="btn btn-ghost" id="sy-copy" type="button">คัดลอกลิงก์</button><div class="shp" id="sy-status"></div><button class="btn btn-primary" id="sy-now" type="button">ซิงก์ตอนนี้</button> <button class="btn btn-danger" id="sy-off" type="button">ปิดซิงก์เครื่องนี้</button>':
      '<button class="btn btn-primary" id="sy-new" type="button">เปิดซิงก์ (สร้างรหัสใหม่)</button><label class="shl">หรือใส่รหัสที่มีอยู่แล้ว</label><input id="sy-code" class="shi" placeholder="รหัสซิงก์" autocomplete="off"><button class="btn btn-ghost" id="sy-join" type="button">เชื่อมด้วยรหัสนี้</button>'))+'</div>';
    document.body.appendChild(d);
    d.addEventListener('click',function(e){ if(e.target===d||e.target.closest('.shx')) d.remove(); });
    function q(i){ return document.getElementById(i); }
    if(q('sy-new')) q('sy-new').addEventListener('click',function(){ rawSet(CODEK,genCode()); sync().then(function(){ openDlg(); }); });
    if(q('sy-join')) q('sy-join').addEventListener('click',function(){ var v=q('sy-code').value.trim(); if(!/^[A-Za-z0-9]{20,64}$/.test(v)){ return; } rawSet(CODEK,v); sync().then(function(){ openDlg(); }); });
    if(q('sy-copy')) q('sy-copy').addEventListener('click',function(){ var t=q('sy-link'); t.select(); var ok=function(){ q('sy-copy').textContent='คัดลอกแล้ว ✓'; }; try{ navigator.clipboard.writeText(t.value).then(ok,function(){ document.execCommand('copy'); ok(); }); }catch(e){ try{ document.execCommand('copy'); ok(); }catch(x){} } });
    if(q('sy-now')) q('sy-now').addEventListener('click',sync);
    if(q('sy-off')) q('sy-off').addEventListener('click',function(){ rawRem(CODEK); openDlg(); });
    if(c){ var l=+(LS.getItem(LASTK)||0); setStatus(l?('ซิงก์ล่าสุด '+new Date(l).toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'})):''); }
  }
  function init(){
    var nav=document.getElementById('navtabs'); if(nav&&!document.getElementById('sy-btn')){ var b=document.createElement('button'); b.className='navtab'; b.id='sy-btn'; b.type='button'; b.textContent='ซิงก์'; nav.appendChild(b); b.addEventListener('click',openDlg); }
    if(ready()){ sync(); document.addEventListener('visibilitychange',function(){ if(!document.hidden) sync(); }); }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
})();
