export type ApplicationKind = 'single' | 'multi' | 'dynamic';
export const applicationKinds: readonly ApplicationKind[] = ['single', 'multi', 'dynamic'];
export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]!);

export function documentHtml(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title>
  <style>body{font:16px system-ui;max-width:760px;margin:40px auto;padding:0 20px;color:#17263c;background:#f5f7fa}
  main{background:white;padding:28px;border-radius:12px}label{display:block;margin:14px 0}
  input:not([type=checkbox]),select,textarea{display:block;box-sizing:border-box;width:100%;padding:9px;margin-top:5px}
  button,a{margin:12px 12px 0 0}button{padding:10px 18px;cursor:pointer}fieldset{margin:18px 0;border:1px solid #ccd4df}
  [hidden]{display:none!important}[role=alert]{color:#a61919}small{display:block;color:#536175}</style>
  </head><body><main><p>CareerPilot · fictional local applications only</p>${body}</main></body></html>`;
}

const contact = `<fieldset><legend>Contact information</legend>
  <label>Full name<input name="fullName" autocomplete="off" required maxlength="120"></label>
  <label>Email address<input name="email" type="email" autocomplete="off" required maxlength="160"></label></fieldset>`;
const education = `<fieldset><legend>Education</legend>
  <label>School or university<input name="school" required maxlength="160"></label>
  <label>Highest qualification<select name="degree" required><option value="">Choose a qualification</option>
  <option>Bachelor of Science</option><option>Master of Science</option><option>Other</option></select></label></fieldset>`;
const experience = `<fieldset><legend>Experience</legend>
  <label>Most recent job title<input name="role" required maxlength="160"></label>
  <label>Describe a relevant project<textarea name="project" required maxlength="2000" aria-describedby="project-help"></textarea></label>
  <small id="project-help">Use only truthful details from the fictional candidate profile.</small></fieldset>`;
const accuracy = `<label><input type="checkbox" name="accuracy" required> I confirm these fictional application details are accurate</label>`;

export function applicationHtml(kind: ApplicationKind, runId: string): string {
  let content: string;
  let script = '';
  if (kind === 'single') {
    content = `${contact}${education}${experience}${accuracy}<button type="submit">Submit mock application</button>`;
  } else if (kind === 'multi') {
    content = `<section data-step="0"><h2>Step 1: Contact</h2>${contact}
      <button type="button" data-next>Continue to qualifications</button></section>
      <section data-step="1" hidden><h2>Step 2: Qualifications</h2>${education}${experience}
      <button type="button" data-back>Back to contact</button><button type="button" data-next>Review application</button></section>
      <section data-step="2" hidden><h2>Step 3: Review</h2><div id="review"></div>${accuracy}
      <button type="button" data-back>Back to qualifications</button><button type="submit">Submit mock application</button></section>`;
    script = `let step=0;const sections=[...document.querySelectorAll('[data-step]')];
      function show(next){sections[step].hidden=true;step=next;sections[step].hidden=false;
      errors.textContent='';if(step===2){const data=new FormData(form);const review=document.querySelector('#review');review.replaceChildren();
      for(const key of ['fullName','email','school','degree','role','project']){const p=document.createElement('p');p.textContent=key+': '+data.get(key);review.append(p);}}}
      document.querySelectorAll('[data-next]').forEach(button=>button.onclick=()=>{
        const invalid=[...sections[step].querySelectorAll('input,select,textarea')].filter(input=>!input.checkValidity());
        if(invalid.length){errors.textContent=invalid.map(input=>(input.labels?.[0]?.textContent.trim()||input.name)+': '+input.validationMessage).join(' ');return;}
        show(step+1);});document.querySelectorAll('[data-back]').forEach(button=>button.onclick=()=>show(step-1));`;
  } else {
    content = `${contact}<label>Current employment status<select name="employmentStatus" required>
      <option value="">Choose status</option><option>Employed</option><option>Not employed</option></select></label>
      <div id="conditional" hidden><label>Current employer<input name="currentEmployer" maxlength="160"></label></div>
      <fieldset><legend>Work history</legend><div id="history">
      <fieldset><legend>Position 1</legend><label>Job title 1<input name="workRole" required maxlength="160"></label>
      <label>Employer 1<input name="workCompany" required maxlength="160"></label></fieldset></div>
      <button type="button" id="add-history">Add work history</button></fieldset>
      <button type="button" id="load-project">Show project question</button><div id="delayed"></div>
      ${accuracy}<button type="submit">Submit mock application</button>`;
    script = `const status=form.elements.namedItem('employmentStatus');status.onchange=()=>{
      const visible=status.value==='Employed';document.querySelector('#conditional').hidden=!visible;
      form.elements.namedItem('currentEmployer').required=visible;};
      let positions=1;document.querySelector('#add-history').onclick=()=>{if(positions>=5)return;positions++;
      const group=document.createElement('fieldset');group.innerHTML='<legend>Position '+positions+'</legend><label>Job title '+positions+'<input name="workRole" required maxlength="160"></label><label>Employer '+positions+'<input name="workCompany" required maxlength="160"></label>';
      document.querySelector('#history').append(group);};
      document.querySelector('#load-project').onclick=event=>{event.target.disabled=true;setTimeout(()=>{
        document.querySelector('#delayed').innerHTML='<label>Describe a relevant project<textarea name="project" required maxlength="2000"></textarea></label>';
      },300);};`;
  }
  return documentHtml(`${kind} application`, `<nav><a href="/">All mock applications</a></nav>
    <h1>${kind === 'single' ? 'Software Engineer' : kind === 'multi' ? 'Product Engineer' : 'Platform Engineer'} · Example Careers</h1>
    <p>Mock vacancy. No real employer receives this information.</p><div role="alert" id="errors"></div>
    <form method="post" action="/applications/${kind}/submit">
    <input type="hidden" name="runId" value="${escapeHtml(runId)}">${content}</form>
    <script>const form=document.querySelector('form');const errors=document.querySelector('#errors');
    form.addEventListener('invalid',event=>{errors.textContent=event.target.validationMessage;},true);${script}</script>`);
}

export function validateApplication(kind: ApplicationKind, data: URLSearchParams): string[] {
  const errors: string[] = [];
  const common = ['runId', 'fullName', 'email', 'accuracy', 'project'];
  const allowed = new Set([...common, ...(kind === 'dynamic'
    ? ['employmentStatus', 'currentEmployer', 'workRole', 'workCompany'] : ['school', 'degree', 'role'])]);
  for (const key of data.keys()) if (!allowed.has(key)) errors.push('Unexpected field');
  for (const key of allowed) {
    const values = data.getAll(key);
    if (!['workRole', 'workCompany'].includes(key) && values.length > 1) errors.push(`Duplicate ${key}`);
    if (values.some(value => value.length > (key === 'project' ? 2000 : 160))) errors.push(`Too long: ${key}`);
  }
  for (const key of ['runId', 'fullName', 'email', 'project']) if (!data.get(key)?.trim()) errors.push(`Required: ${key}`);
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(data.get('runId') ?? '')) errors.push('Invalid run ID');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.get('email') ?? '')) errors.push('Invalid email address');
  if (data.get('accuracy') !== 'on') errors.push('Accuracy confirmation required');
  if (kind === 'dynamic') {
    if (!['Employed', 'Not employed'].includes(data.get('employmentStatus') ?? '')) errors.push('Invalid employment status');
    if (data.get('employmentStatus') === 'Employed' && !data.get('currentEmployer')?.trim()) errors.push('Current employer required');
    const roles = data.getAll('workRole'), companies = data.getAll('workCompany');
    if (roles.length < 1 || roles.length > 5 || roles.length !== companies.length
      || [...roles, ...companies].some(value => !value.trim())) errors.push('Complete 1–5 work history positions');
  } else {
    for (const key of ['school', 'role']) if (!data.get(key)?.trim()) errors.push(`Required: ${key}`);
    if (!['Bachelor of Science', 'Master of Science', 'Other'].includes(data.get('degree') ?? '')) errors.push('Invalid qualification');
  }
  return errors;
}
