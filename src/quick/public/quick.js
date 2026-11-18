const byId = id => document.getElementById(id);
const form = byId('search');
const flags = ['office','hybrid','remote','junior','includeUnclear'];
let panelUrl='/';
const storageKey = 'careerpilot.quick.preferences.v1';
function roleInputs() { return Array.from(form.querySelectorAll('#roles input, #extra-roles input')); }
function selection() {
  return {roles:roleInputs().filter(box=>box.checked).map(box=>box.value),city:byId('city').value.trim(),
    ...Object.fromEntries(flags.map(key=>[key,byId(key).checked]))};
}
function save() {
  const prefs = selection();
  if (!prefs.roles.length || !prefs.city || !(prefs.office || prefs.hybrid || prefs.remote)) {
    byId('save').textContent='Bir rol, şehir ve en az bir çalışma biçimi seç.'; return false;
  }
  try {localStorage.setItem(storageKey,JSON.stringify(prefs)); byId('save').textContent='Tercihlerin bu tarayıcıya kaydedildi.';}
  catch {byId('save').textContent='Tarayıcı tercihleri yalnızca bu oturumda saklıyor.';}
  return true;
}
async function init() {
  const {defaults,roleNames,panel}=await (await fetch('/quick-config')).json();
  panelUrl=panel;
  byId('panel-hint').hidden=panel==='/';
  let prefs=defaults;
  try {
    const old=JSON.parse(localStorage.getItem(storageKey));
    if (old && typeof old.city==='string' && old.city.trim() && Array.isArray(old.roles) && old.roles.some(role=>Object.hasOwn(roleNames,role))
      && flags.filter(key=>key!=='includeUnclear').every(key=>typeof old[key]==='boolean') && (old.office||old.hybrid||old.remote)) prefs={...defaults,...old};
  } catch {}
  for (const [key,name] of Object.entries(roleNames)) {
    const label=document.createElement('label'), box=document.createElement('input');
    box.type='checkbox'; box.value=key; box.checked=prefs.roles.includes(key);
    label.append(box,' '+name); byId(defaults.roles.includes(key)?'roles':'extra-roles').append(label);
  }
  byId('city').value=prefs.city;
  for(const key of flags) byId(key).checked=prefs[key];
  byId('go').disabled=false;
  if(new URLSearchParams(location.search).get('tara')==='1')form.requestSubmit();
}
form.addEventListener('input',save);
function showJobs(jobs) {
  const list=byId('jobs');
  list.replaceChildren();
  let lastGroup='';
  for (const row of jobs) {
    const group=row.level==='entry'?'Junior / yeni mezun':row.level==='unclear'?'Deneyim şartı kontrol edilecek':'Deneyimli roller';
    if(group!==lastGroup){
      const heading=document.createElement('li');heading.className='group';heading.textContent=group;
      list.append(heading);lastGroup=group;
    }
    const li=document.createElement('li'), link=document.createElement('a');
    const company=document.createElement('span'), detail=document.createElement('p'), meta=document.createElement('small');
    company.className='company';company.textContent=row.company || row.source;
    link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.title;
    detail.textContent=[row.location,({onsite:'Ofisten',hybrid:'Hibrit',remote:'Uzaktan'})[row.mode]||row.mode].filter(Boolean).join(' · ');
    meta.textContent=[row.role,row.level==='entry'?'Başlangıç seviyesi':row.level==='experienced'?'Deneyimli':'Deneyim şartını kontrol et',row.source].join(' · ');
    li.append(company,link,detail,meta);
    if (row.description.trim().length>=20) {
      const prepare=document.createElement('a');
      prepare.className='prepare';
      prepare.textContent='Başvuru taslağı hazırla';
      const posting={company:row.company,title:row.title,sourceUrl:row.url,text:row.description.slice(0,24000)};
      prepare.href=panelUrl+'#ilan='+encodeURIComponent(JSON.stringify(posting));
      prepare.target='_blank';prepare.rel='noopener noreferrer';
      li.append(prepare);
    }
    list.append(li);
  }
}
let active;
byId('stop').addEventListener('click',()=>active?.abort());
function pause(signal) {
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);signal.removeEventListener('abort',finish);resolve();};
    const timer=setTimeout(finish,31_000);
    signal.addEventListener('abort',finish,{once:true});
  });
}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(active || !save())return;
  active=new AbortController();
  const signal=active.signal, prefs=selection(), jobs=new Map(), reports=new Map();
  let page=1, examined=0;
  byId('go').disabled=true;byId('stop').hidden=false;byId('summary').textContent='Şirket ilanları ve FreeHire taranıyor…';
  byId('sources').hidden=true;byId('jobs').replaceChildren();
  try {
    while(page && !signal.aborted) {
      const response=await fetch('/quick-search?page='+page,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(prefs),signal});
      if(!response.ok)throw new Error('Arama tamamlanamadı.');
      const data=await response.json();
      examined+=data.examined;
      for(const job of data.jobs) if(!jobs.has(job.url))jobs.set(job.url,job);
      const sorted=Array.from(jobs.values()).sort((a,b)=>['entry','unclear','experienced'].indexOf(a.level)-['entry','unclear','experienced'].indexOf(b.level));
      showJobs(sorted);
      for(const item of data.reports) {
        const previous=reports.get(item.source);
        reports.set(item.source,{count:(previous?.count??0)+item.examined,ok:item.ok});
      }
      byId('report').replaceChildren(...Array.from(reports,([source,status])=>{
        const li=document.createElement('li');
        li.textContent=source+' · '+status.count+' kayıt'+(status.ok?'':' · erişilemedi');return li;
      }));
      byId('sources').hidden=false;
      byId('summary').textContent=examined+' kayıt incelendi · '+jobs.size+' sonuç';
      if(Array.from(reports.values()).some(source=>!source.ok))byId('summary').textContent+=' · Eksik kaynak var';
      page=data.nextPage;
      if(page) {byId('summary').textContent+=' · Sonraki sayfa bekleniyor';await pause(signal);}
    }
  } catch(error) {if(!signal.aborted)byId('summary').textContent=error.message;}
  finally {
    if(signal.aborted)byId('summary').textContent=examined+' kayıt incelendi · '+jobs.size+' sonuç · Tarama durduruldu';
    active=null;byId('stop').hidden=true;byId('go').disabled=false;
  }
});
init().catch(()=>{byId('summary').textContent='Tercihler yüklenemedi. Sayfayı yenile.';});
