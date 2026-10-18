'use strict';
const $ = selector => document.querySelector(selector);
const states = { saved: 'Kaydedildi', ready: 'Analizi hazır', review: 'İnceleme gerekiyor', submitted: 'Başvuruldu', archived: 'Vazgeçildi' };
const levels = { documented: 'Doğrudan dayanak', related: 'Kısmi dayanak', not_documented: 'Profilde belgelenmiyor' };
const priorities = { essential: 'Temel şart', preferred: 'Tercih edilen', responsibility: 'Görev' };
const errors = {
  HUB_INPUT_INVALID: 'Bilgileri kontrol et. Bağlantı https ile başlamalı; ilan metni en az 20 karakter olmalı.',
  HUB_SESSION_REQUIRED: 'Oturum yenilenmeli. Sayfayı yeniden açıp tekrar dene.',
  HUB_ANALYSIS_REQUIRED: 'Bu ilan için önce bir analiz oluştur veya hazır analizi içe aktar.',
  HUB_ANALYSIS_BUSY: 'Bir analiz zaten çalışıyor. Tamamlandığında yeniden deneyebilirsin.',
  HUB_MODEL_NOT_ENABLED: 'Model bu oturumda etkin değil. Hazır bir analizi içe aktarabilirsin.',
  HUB_ANALYSIS_CONSENT_REQUIRED: 'Analiz için ücret ve mesleki profil paylaşımı onayları gerekiyor.',
  PREP_PLAN_INVALID: 'Analizdeki gereksinimler veya bilgi referansları mevcut profilinle eşleşmiyor.',
  PREP_POSTING_QUOTE_INVALID: 'Model ilan metninde bulunmayan bir şart üretti. Analiz kabul edilmedi.',
  BUDGET_RUN_STOP: 'Bu analizin koşu bütçesi sınırına ulaşıldı.',
  BUDGET_MONTHLY_STOP: 'Aylık analiz bütçesi sınırına ulaşıldı.',
};
let session, records = [], selectedId = null, poll, detailSequence = 0;
function node(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function friendly(code) { return errors[code] || 'İşlem tamamlanamadı. Kaydın korunuyor; bilgileri ve bağlantını kontrol edip tekrar deneyebilirsin.'; }
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(session ? { 'X-Hub-Token': session.token } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json(); if (!response.ok) throw new Error(friendly(result.code)); return result;
}
function notify(text, error = false) { const box = $('#notice'); box.textContent = text; box.className = text ? 'notice ' + (error ? 'error' : 'success') : ''; }
function badge(state) { return node('span', 'badge ' + state, states[state]); }
function openDialog(id) { const dialog = $(id); dialog.querySelector('.form-error').textContent = ''; dialog.showModal(); }
async function refresh(preferred) {
  records = await api('/api/jobs');
  $('#stat-all').textContent = records.length;
  $('#stat-ready').textContent = records.filter(item => item.analysisOrigin).length;
  $('#stat-review').textContent = records.filter(item => item.state === 'review').length;
  $('#stat-submitted').textContent = records.filter(item => item.state === 'submitted').length;
  $('#nav-count').textContent = records.length;
  renderList();
  const visible = visibleRecords();
  const wanted = visible.find(item => item.id === (preferred || selectedId)) || visible[0];
  if (wanted) await showDetail(wanted.id); else clearDetail();
  clearTimeout(poll);
  if (records.some(item => item.analyzing)) poll = setTimeout(() => refresh().catch(error => notify(error.message, true)), 2000);
}
function visibleRecords() {
  const query = $('#search').value.toLocaleLowerCase('tr'), state = $('#filter').value;
  return records.filter(item => (state === 'all' || item.state === state) && (item.company + ' ' + item.title).toLocaleLowerCase('tr').includes(query));
}
function clearDetail() { selectedId = null; detailSequence++; const empty = node('div', 'empty'); empty.append(node('h2', '', 'Görüntülenecek ilan seçilmedi.'), node('p', '', 'Aramayı veya filtreyi değiştirerek bir ilan seçebilirsin.')); $('#detail').replaceChildren(empty); }
async function applyFilters() {
  const visible = visibleRecords();
  $('#nav-all').classList.toggle('active', $('#filter').value === 'all');
  $('#nav-review').classList.toggle('active', $('#filter').value === 'review');
  if (!visible.some(item => item.id === selectedId)) {
    if (visible[0]) await showDetail(visible[0].id); else clearDetail();
  }
  renderList();
}
function resetFilters() { $('#search').value = ''; $('#filter').value = 'all'; $('#nav-all').classList.add('active'); $('#nav-review').classList.remove('active'); }
function renderList() {
  const filtered = visibleRecords();
  $('#list-count').textContent = filtered.length + ' ilan'; $('#jobs').replaceChildren();
  if (!filtered.length) {
    const empty = node('div', 'empty'); empty.append(node('h3', '', records.length ? 'Bu filtrede ilan yok.' : 'İlk fırsatını ekle.'), node('p', '', records.length ? 'Aramayı veya durum filtresini değiştirebilirsin.' : 'İlan metnini kaydet; başvurunun bütün adımlarını buradan takip et.'));
    $('#jobs').append(empty); return;
  }
  for (const item of filtered) {
    const card = node('button', 'job-card' + (selectedId === item.id ? ' selected' : '')); card.type = 'button';
    card.setAttribute('aria-pressed', String(selectedId === item.id));
    const top = node('div', 'job-top'); top.append(node('span', 'company-mark', item.company.slice(0, 1).toUpperCase()), node('span', 'company-name', item.company));
    const title = node('h3', '', item.title), bottom = node('div', 'job-bottom');
    bottom.append(badge(item.state), node('span', 'country', item.country + ' · ' + new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(item.updatedAt))));
    const score = node('span', item.score === null ? 'card-score muted' : 'card-score', item.analyzing ? 'Analiz sürüyor…' : item.score === null ? (item.analysisOrigin ? 'Puan hesaplanamadı' : 'Henüz analiz yok') : item.score + '/100 uyum');
    card.append(top, title, bottom, score); card.addEventListener('click', () => showDetail(item.id).catch(error => notify(error.message, true))); $('#jobs').append(card);
  }
}
async function showDetail(id) {
  const sequence = ++detailSequence;
  const record = await api('/api/jobs/' + id); if (sequence !== detailSequence) return; selectedId = id; renderList();
  const pane = $('#detail'); pane.replaceChildren();
  const head = node('div', 'detail-head'); head.append(node('div', 'eyebrow', record.posting.company), node('h2', '', record.posting.title));
  const meta = node('div', 'detail-meta'); meta.append(badge(record.state), node('span', 'muted', record.posting.country + ' · ' + (record.posting.language === 'en' ? 'İngilizce ilan' : 'Türkçe ilan'))); head.append(meta); pane.append(head);
  const actions = node('div', 'detail-actions'), link = node('a', 'secondary', 'İlanı aç ↗'); link.href = record.posting.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
  const analyze = node('button', 'primary', record.analyzing ? 'Analiz sürüyor…' : record.analysis ? 'Yeniden analiz et' : 'Uyumunu analiz et');
  analyze.disabled = !session.modelEnabled || record.analyzing; analyze.addEventListener('click', () => { $('#analyze-form').reset(); $('#model-details').textContent = session.model ? 'Model: ' + session.model.name + ' · Sağlayıcı: ' + session.model.destination + ' · Analiz sınırı: $' + session.model.perRunLimitUsd.toFixed(4) + ' · Aylık sınır: $' + session.model.monthlyLimitUsd.toFixed(2) : ''; openDialog('#analyze-dialog'); }); actions.append(analyze); pane.append(actions);
  if (!session.modelEnabled) pane.append(node('p', 'small muted', 'Model bu oturumda kapalı. Mevcut analizini “Analiz içe aktar” ile ücretsiz görüntüleyebilirsin.'));
  if (record.lastError) pane.append(node('p', 'notice error', 'Son analiz tamamlanamadı: ' + friendly(record.lastError) + (record.analysis ? ' Önceki analiz aşağıda korunuyor.' : '')));
  if (record.analysis) renderAnalysis(pane, record);
  else { const box = node('div', 'analysis-empty'); box.append(node('span', 'eyebrow', 'SIRADAKİ ADIM'), node('h3', '', 'Bu fırsat sana ne kadar yakın?'), node('p', 'muted', 'Analiz eklendiğinde güçlü yönlerin, belgelenmeyen şartlar ve puanın dayanakları burada görünecek.')); pane.append(box); }
  const cvBox = node('section', 'cv-box'); cvBox.append(node('h3', '', 'Başvuru belgeleri'), node('p', '', record.cv ? (record.cv.language === 'en' ? 'İngilizce' : 'Türkçe') + ' CV · ' + (record.cv.photo ? 'Fotoğraflı' : 'Fotoğrafsız') : record.cvError), node('p', 'small muted', 'CV otomatik yüklenmedi. İlanın belge talimatlarını kontrol ederek başvuru sitesinde seç.')); pane.append(cvBox);
  const tracking = node('section', 'tracking'); tracking.append(node('h3', '', 'Başvuru durumun'));
  const select = node('select'); select.setAttribute('aria-label', 'Başvuru durumunu değiştir');
  for (const [value, label] of Object.entries(states)) { const option = node('option', '', label); option.value = value; select.append(option); } select.value = record.state;
  select.addEventListener('change', async () => { select.disabled = true; try { await api('/api/jobs/' + id + '/status', { state: select.value }); notify('Başvuru durumu kaydedildi.'); await refresh(id); } catch (error) { select.value = record.state; select.disabled = false; notify(error.message, true); } });
  tracking.append(select, node('p', 'small muted', '“Başvuruldu” senin kaydındır; işverenden doğrulama alındığı anlamına gelmez.')); pane.append(tracking);
  const source = node('details', 'source'); source.append(node('summary', '', record.analysis?.origin === 'imported_review' ? 'İçe aktarılan gereksinimleri göster' : 'İlan metnini göster'), node('pre', '', record.posting.text)); pane.append(source);
}
function renderAnalysis(pane, record) {
  const analysis = record.analysis, match = analysis.match;
  const summary = node('section', 'score-section'), number = node('div', 'score-number', match.score === null ? '—' : String(match.score));
  const description = node('div'); description.append(node('h3', '', 'Profil dayanaklarına göre uyum'), node('p', 'muted', match.score === null ? 'Puanlanabilir gereksinim bulunmuyor.' : '100 üzerinden · işe alınma olasılığı değildir.'));
  description.append(node('p', 'small muted', analysis.origin === 'demo' ? 'Kurgusal örnek değerlendirmesi' : analysis.origin === 'model' ? 'AI analizi · incelemen gerekiyor' : 'İçe aktarılan değerlendirme · puan yeniden hesaplandı'));
  if (analysis.costMicroUsd !== null) description.append(node('p', 'small muted', 'Analiz maliyeti: $' + (analysis.costMicroUsd / 1000000).toFixed(6)));
  else description.append(node('p', 'small muted', 'Bu kayıtta model maliyeti belirtilmemiştir.'));
  summary.append(number, description); pane.append(summary);
  const authorization = match.workAuthorization;
  if (authorization.status !== 'authorized') pane.append(node('p', 'authorization', authorization.sponsorshipConflict ? 'Çalışma hakkı: sponsor gerekiyor; ilan sponsorluk sunmadığını belirtiyor. Puan bu engeli ortadan kaldırmaz.' : authorization.status === 'sponsorship_required' ? 'Bu ülkede çalışmak için işveren sponsorluğu gerekiyor. İlandaki sponsorluk koşullarını kontrol et.' : 'Bu ülkedeki çalışma hakkın henüz doğrulanmadı.'));
  else pane.append(node('p', 'small muted', 'Profilindeki beyana göre bu ülkede çalışma hakkın var.'));
  const breakdown = node('div', 'breakdown'); breakdown.append(node('span', '', match.strengths.length + ' doğrudan dayanak'), node('span', '', match.partialEvidence.length + ' kısmi dayanak'), node('span', '', match.notDocumented.length + ' belgelenmeyen şart')); pane.append(breakdown);
  const heading = node('div', 'section-heading'); heading.append(node('h3', '', 'Gereksinimler ve dayanakların')); pane.append(heading);
  const facts = new Map(analysis.facts.map(fact => [fact.id, fact.text]));
  for (const row of match.requirements) {
    const requirement = analysis.job.requirements.find(item => item.id === row.requirementId);
    const section = node('section', 'requirement ' + row.evidenceLevel), top = node('div', 'requirement-top');
    top.append(node('span', 'small muted', priorities[row.priority]), node('span', 'evidence-label', levels[row.evidenceLevel])); section.append(top, node('h4', '', requirement.text));
    for (const factId of row.factIds) section.append(node('p', 'evidence-text', facts.get(factId)));
    if (!row.factIds.length) section.append(node('p', 'small muted', 'Profilinde dayanak bulunmuyor; bu, becerinin sende olmadığını kanıtlamaz.'));
    section.append(node('span', 'points', row.weight ? 'Puan katkısı ' + row.earned + ' / ' + row.weight : 'Görev tanımı · puanlamanın dışında')); pane.append(section);
  }
  const formula = node('details', 'source'); formula.append(node('summary', '', 'Puan nasıl hesaplandı?'), node('p', 'small muted', 'Temel şartlar 3, tercihler 1 ağırlığında. Doğrudan dayanak tam, kısmi dayanak yarım değerli. ' + match.totals.earned + ' / ' + match.totals.possible + ' × 100, tam sayıya yuvarlanır. Görevler puana katılmaz. İlandan çıkarılan şartları ve eşleştirmeleri kontrol et.')); pane.append(formula);
}
$('#new-open').addEventListener('click', () => openDialog('#new-dialog'));
$('#import-open').addEventListener('click', () => openDialog('#import-dialog'));
for (const button of document.querySelectorAll('.close-dialog')) button.addEventListener('click', () => button.closest('dialog').close());
$('#search').addEventListener('input', () => applyFilters().catch(error => notify(error.message, true))); $('#filter').addEventListener('change', () => applyFilters().catch(error => notify(error.message, true)));
$('#nav-all').addEventListener('click', () => { $('#filter').value = 'all'; void applyFilters().catch(error => notify(error.message, true)); });
$('#nav-review').addEventListener('click', () => { $('#filter').value = 'review'; void applyFilters().catch(error => notify(error.message, true)); });
function formHandler(selector, action) {
  const form = $(selector); form.addEventListener('submit', async event => { event.preventDefault(); const button = form.querySelector('[type="submit"]'), original = button.textContent; button.disabled = true; button.textContent = 'İşleniyor…'; form.querySelector('.form-error').textContent = '';
    try { await action(form); } catch (error) { form.querySelector('.form-error').textContent = error.message; } finally { button.disabled = false; button.textContent = original; }
  });
}
formHandler('#new-form', async form => { const data = Object.fromEntries(new FormData(form)); const result = await api('/api/jobs', data); form.closest('dialog').close(); form.reset(); resetFilters(); await refresh(result.id); notify('İlan kaydedildi. Henüz model çağrısı yapılmadı.'); });
formHandler('#import-form', async form => {
  const jobFile = $('#import-job').files[0], planFile = $('#import-plan').files[0]; if (!jobFile || !planFile || jobFile.size > 200000 || planFile.size > 200000) throw new Error('İki JSON dosyasını da seç; dosyalar 200 KB altında olmalı.');
  let job, plan; try { job = JSON.parse(await jobFile.text()); plan = JSON.parse(await planFile.text()).plan; } catch { throw new Error('JSON dosyaları okunamadı. Paketteki job.json ve preparation.json dosyalarını seç.'); }
  const result = await api('/api/import', { job, plan }); form.closest('dialog').close(); form.reset(); resetFilters(); await refresh(result.id); notify('Analiz içe aktarıldı, puan mevcut profilinle yeniden hesaplandı. Ücretli çağrı yapılmadı.');
});
formHandler('#analyze-form', async form => {
  const id = selectedId; if (!id) return;
  const result = await api('/api/jobs/' + id + '/analyze', { paidCallApproved: $('#paid-consent').checked, cloudProfileApproved: $('#profile-consent').checked });
  form.closest('dialog').close(); form.reset(); await refresh(result.id); notify('Analiz hazır. İlan şartlarını ve dayanakları gözden geçir.');
});
(async () => { try { session = await api('/api/session'); $('#mode').textContent = session.demo ? 'ÖRNEK MOD · Kurgusal aday ve ilanlar. Gerçek başvuru veya ücretli model çağrısı yok.' : 'YEREL ÇALIŞMA ALANI · ' + session.profile.facts + ' mesleki bilgi, ' + session.profile.cvs + ' CV kayıtlı. Model ' + (session.modelEnabled ? 'onayla kullanılabilir.' : 'kapalı.'); await refresh(); } catch (error) { notify(error.message, true); $('#jobs').replaceChildren(node('p', 'empty', 'Kayıtlar yüklenemedi. Panel bağlantısını kontrol edip sayfayı yenile.')); } })();
