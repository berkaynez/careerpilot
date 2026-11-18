const byId = id => document.getElementById(id);
const form = byId('search');
const flags = ['office','hybrid','remote','junior'];
const storageKey = 'careerpilot.quick.preferences.v1';
function roleInputs() { return Array.from(byId('roles').querySelectorAll('input')); }
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
  const {defaults,roleNames}=await (await fetch('/quick-config')).json();
  let prefs=defaults;
  try {
    const old=JSON.parse(localStorage.getItem(storageKey));
    if (old && typeof old.city==='string' && old.city.trim() && Array.isArray(old.roles) && old.roles.some(role=>Object.hasOwn(roleNames,role))
      && flags.every(key=>typeof old[key]==='boolean') && (old.office||old.hybrid||old.remote)) prefs=old;
  } catch {}
  for (const [key,name] of Object.entries(roleNames)) {
    const label=document.createElement('label'), box=document.createElement('input');
    box.type='checkbox'; box.value=key; box.checked=prefs.roles.includes(key);
    label.append(box,' '+name); byId('roles').append(label);
  }
  byId('city').value=prefs.city;
  for(const key of flags) byId(key).checked=prefs[key];
  byId('go').disabled=false;
}
form.addEventListener('input',save);
form.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!save()) return;
  byId('go').disabled=true; byId('summary').textContent='FreeHire aranıyor…'; byId('jobs').replaceChildren();
  try {
    const response=await fetch('/quick-search',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(selection())});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error || 'Arama tamamlanamadı.');
    byId('summary').textContent=data.examined+' kayıt incelendi · '+data.jobs.length+' sonuç'+(data.cached?' (önbellek)':'');
    for (const row of data.jobs) {
      const li=document.createElement('li'), link=document.createElement('a'), detail=document.createElement('p');
      link.href=row.url;link.target='_blank';link.rel='noopener noreferrer';link.textContent=row.title;
      detail.textContent=[row.company,row.location,row.mode,row.level==='unclear'?'Deneyim şartını kontrol et':''].filter(Boolean).join(' · ');
      li.append(link,detail);byId('jobs').append(li);
    }
  } catch(error) { byId('summary').textContent=error.message; }
  finally {byId('go').disabled=false;}
});
init().catch(()=>{byId('summary').textContent='Tercihler yüklenemedi. Sayfayı yenile.';});
