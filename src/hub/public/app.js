'use strict';
const $ = selector => document.querySelector(selector);
const states = { saved: 'Kaydedildi', ready: 'Analizi hazır', review: 'İnceleme gerekiyor', submitted: 'Başvuruldu', archived: 'Vazgeçildi' };
const levels = { documented: 'Doğrudan dayanak', related: 'Kısmi dayanak', not_documented: 'Profilde belgelenmiyor' };
const priorities = { essential: 'Temel şart', preferred: 'Tercih edilen', responsibility: 'Görev' };
const errors = {
  DISCOVERY_SEARCH_NOT_ENABLED: 'Kaynak araması kapalı. SerpAPI anahtarını özel ayar dosyana ekleyip paneli --enable-search ile aç.',
  DISCOVERY_SEARCH_APPROVAL_REQUIRED: 'Rol ve konum paylaşımı ile ücretsiz kota kullanımı onayı gerekiyor.',
  DISCOVERY_SEARCH_FREE_PLAN_REQUIRED: 'Ücretsiz ve etkin SerpAPI planı doğrulanamadı. Arama yapılmadı; hesabındaki planı kontrol et.',
  DISCOVERY_SEARCH_QUOTA_STOP: 'Ücretsiz kota veya yerel sınır doldu. Arama durduruldu; ücretli plana geçilmedi.',
  DISCOVERY_SEARCH_COOLDOWN: 'Yeni sorgular için en az 15 dakika bekle. Aynı başarılı arama 24 saat kayıtlı sonuçları kullanır.',
  DISCOVERY_SEARCH_BUSY: 'Bir arama devam ediyor veya önceki işlem yarıda kaldı. Yeniden başlatmadan önce çalışan paneli kontrol et.',
  DISCOVERY_SEARCH_TIMEOUT: 'Arama servisi süre sınırında yanıt vermedi. Otomatik tekrar yapılmadı.',
  DISCOVERY_SEARCH_NETWORK: 'Arama bağlantısı tamamlanamadı. Tekrar denenmedi; başlamış sorgu kota kaydında tutulur.',
  DISCOVERY_SEARCH_HTTP: 'SerpAPI isteği reddetti. Anahtarı ve hesabını kontrol et; tekrar denenmedi.',
  DISCOVERY_SEARCH_RATE_LIMITED: 'SerpAPI hız sınırına ulaşıldı. Arama durduruldu.',
  DISCOVERY_SEARCH_FORMAT: 'Arama sonucu doğrulanamadı. Aday kaynak eklenmedi.',
  DISCOVERY_SEARCH_RESPONSE_TOO_LARGE: 'Arama yanıtı boyut sınırını aştı. İşlem durduruldu.',

  DISCOVERY_SEARCH_QUERY_TOO_LONG: 'Arama sorgusu çok uzun. Rol veya konum ifadelerini kısaltıp ayarları kaydet.',
  DISCOVERY_BUSY: 'Bir keşif işlemi devam ediyor. Bitmesini bekle.',
  DISCOVERY_SOURCES_REQUIRED: 'En az bir şirket kaynağı ekle.',
  DISCOVERY_DEMO_OFFLINE: 'Örnek modda dış kaynak taraması kapalıdır.',
  HUB_ROUTING_REQUIRED: 'Önce tam ilan metnini, şirketi, çalışma ülkesini ve dili doğrula.',

  ASSIST_CONTACT_CONSENT_REQUIRED: 'Form bilgilerini bu siteye yazmak için paylaşım onayı gerekiyor.',
  ASSIST_SESSION_BUSY: 'Bir form işlemi veya açık oturum var. Önce onu tamamla ya da kapat.',
  ASSIST_SESSION_CLOSED: 'Form penceresi kapalı. Yeni bir oturum açabilirsin.',
  ASSIST_CONTROL_TRANSFERRED: 'Kontrol tamamen sende; bu oturumda yeniden otomatik doldurma yapılmaz.',
  ASSIST_ORIGIN_NOT_APPROVED: 'Bu adreste doldurma izni yok veya site henüz desteklenmiyor.',
  ASSIST_CONTINUE_REQUIRED: 'Önce “Tarayıcıda devam et” ile mevcut kontrol adımını bitir.',
  ASSIST_TAB_CLOSED: 'Seçili sekme kapandı. Panelden açık bir sekme seç.',
  ASSIST_NAME_PARTS_NOT_VERIFIED: 'Ad ve soyad profilindeki tam adla eşleşmiyor. Yazımı kontrol et.',
  JOB_PLATFORM_UNSUPPORTED: 'Bu sitede otomatik doldurma henüz hazır değil. İlanı açıp elle devam edebilirsin.',
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
let session, records = [], selectedId = null, poll, detailSequence = 0, assistantRequestPending = false, assistantIntent = null, detailSignature = '';
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
  if (!assistantRequestPending && records.some(item => item.analyzing || item.assistantActive)) poll = setTimeout(() => refresh().catch(error => notify(error.message, true)), 2000);
}
function visibleRecords() {
  const query = $('#search').value.toLocaleLowerCase('tr'), state = $('#filter').value;
  const visible = records.filter(item => (state === 'all' || item.state === state) && (item.company + ' ' + item.title).toLocaleLowerCase('tr').includes(query));
  return state === 'review' ? visible.sort((a, b) => Number(b.discovery?.careerLevel === 'entry') - Number(a.discovery?.careerLevel === 'entry')) : visible;
}
function clearDetail() { selectedId = null; detailSignature = '';  detailSequence++; const empty = node('div', 'empty'); empty.append(node('h2', '', 'Görüntülenecek ilan seçilmedi.'), node('p', '', 'Aramayı veya filtreyi değiştirerek bir ilan seçebilirsin.')); $('#detail').replaceChildren(empty); }
async function applyFilters() {
  const visible = visibleRecords();
  if (!visible.some(item => item.id === selectedId)) {
    if (visible[0]) await showDetail(visible[0].id); else clearDetail();
  }
  renderList();
}
function resetFilters() { $('#search').value = ''; $('#filter').value = 'all'; }
function renderList() {
  const view = $('#filter').value;
  for (const button of document.querySelectorAll('[data-view]')) {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
  }
  $('#nav-submitted-count').textContent = records.filter(item => item.state === 'submitted').length;
  $('#list-title').textContent = view === 'submitted' ? 'Başvurulanlar' : view === 'review' ? 'İnceleme bekleyenler' : 'İlanların';
  const filtered = visibleRecords();
  $('#list-count').textContent = filtered.length + ' ilan'; $('#jobs').replaceChildren();
  if (!filtered.length) {
    const empty = node('div', 'empty'); empty.append(node('h3', '', view === 'submitted' ? 'Henüz başvurulan ilan yok.' : records.length ? 'Bu filtrede ilan yok.' : 'İlk fırsatını ekle.'), node('p', '', view === 'submitted' ? 'Tamamladığın ilanın durumunu “Başvuruldu” olarak değiştir; burada takip edebilirsin. Arama yaptıysan aramayı da kontrol et.' : records.length ? 'Aramayı veya durum filtresini değiştirebilirsin.' : 'İlan metnini kaydet; başvurunun bütün adımlarını buradan takip et.'));
    $('#jobs').append(empty); return;
  }
  for (const item of filtered) {
    const card = node('button', 'job-card' + (selectedId === item.id ? ' selected' : '')); card.type = 'button';
    card.setAttribute('aria-pressed', String(selectedId === item.id));
    const top = node('div', 'job-top'); top.append(node('span', 'company-mark', item.company.slice(0, 1).toUpperCase()), node('span', 'company-name', item.company));
    const title = node('h3', '', item.title), bottom = node('div', 'job-bottom');
    bottom.append(badge(item.state), node('span', 'country', (item.discovery && !item.discovery.routingConfirmed ? 'Ülke doğrulanmalı' : item.country) + ' · ' + new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short' }).format(new Date(item.updatedAt))));
    const score = node('span', item.score === null ? 'card-score muted' : 'card-score', item.analyzing ? 'Analiz sürüyor…' : item.score === null ? (item.analysisOrigin ? 'Puan hesaplanamadı' : 'Henüz analiz yok') : item.score + '/100 uyum');
    if (item.discovery) bottom.append(node('span', 'small muted', item.discovery.careerLevel === 'entry' ? 'Yeni mezun / başlangıç' : item.discovery.careerLevel === 'experienced' ? 'Deneyimli rol' : 'Seviye kontrol edilmeli'));
    card.append(top, title, bottom, score); card.addEventListener('click', () => showDetail(item.id).catch(error => notify(error.message, true))); $('#jobs').append(card);
  }
}
async function showDetail(id) {
  const sequence = ++detailSequence;
  const record = await api('/api/jobs/' + id); if (sequence !== detailSequence) return;
  const signature = JSON.stringify(record);
  if (selectedId === id && signature === detailSignature) return;
  detailSignature = signature; selectedId = id; renderList();
  const pane = $('#detail'); pane.replaceChildren();
  const head = node('div', 'detail-head'); head.append(node('div', 'eyebrow', record.posting.company), node('h2', '', record.posting.title));
  const meta = node('div', 'detail-meta'); meta.append(badge(record.state), node('span', 'muted', record.discovery && !record.discovery.routingConfirmed ? 'Ülke ve dil doğrulanmalı' : record.posting.country + ' · ' + (record.posting.language === 'en' ? 'İngilizce ilan' : 'Türkçe ilan'))); head.append(meta); pane.append(head);
  const actions = node('div', 'detail-actions'), link = node('a', 'secondary', 'İlanı aç ↗'); link.href = record.posting.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.append(link);
  const analyze = node('button', 'primary', record.analyzing ? 'Analiz sürüyor…' : record.analysis ? 'Yeniden analiz et' : 'Uyumunu analiz et');
  analyze.disabled = !session.modelEnabled || record.analyzing || Boolean(record.discovery && !record.discovery.routingConfirmed); analyze.addEventListener('click', () => { $('#analyze-form').reset(); $('#model-details').textContent = session.model ? 'Model: ' + session.model.name + ' · Sağlayıcı: ' + session.model.destination + ' · Analiz sınırı: $' + session.model.perRunLimitUsd.toFixed(4) + ' · Aylık sınır: $' + session.model.monthlyLimitUsd.toFixed(2) : ''; openDialog('#analyze-dialog'); }); actions.append(analyze); pane.append(actions);
  if (!session.modelEnabled) pane.append(node('p', 'small muted', 'Model bu oturumda kapalı. Mevcut analizini “Analiz içe aktar” ile ücretsiz görüntüleyebilirsin.'));
  renderDiscovery(record, pane);
  renderAssistant(pane, record);
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
function assistantConsent(record, action = 'start') {
  assistantIntent = { jobId: record.id, action, origin: action === 'approve' ? record.assistant.session.currentOrigin : record.assistant.recipientOrigin };
  $('#assistant-form').reset();
  $('#assistant-first').value = session.assistantDefaults.firstName;
  $('#assistant-last').value = session.assistantDefaults.lastName;
  $('#assistant-names').hidden = action === 'approve';
  $('#assistant-recipient').textContent = (record.assistant.demo ? 'Kurgusal yerel deneme · ' : 'Bilgilerin yazılabileceği site: ') + assistantIntent.origin;
  $('#assistant-form [type="submit"]').textContent = action === 'approve' ? 'Bu adrese izin ver' : 'Onayla ve aç';
  openDialog('#assistant-dialog');
}
async function assistantRequest(id, command) {
  if (assistantRequestPending) throw new Error('Bir form işlemi sürüyor; tamamlanmasını bekle.');
  assistantRequestPending = true; clearTimeout(poll);
  try { return await api('/api/jobs/' + id + '/assistant', command); }
  finally { assistantRequestPending = false; }
}
async function assistantAction(id, command) {
  try { await assistantRequest(id, command); notify(command.action === 'handoff' ? 'Kontrol sende. Program artık bu oturuma müdahale etmeyecek.' : command.action === 'close' ? 'Form oturumu kapatıldı. Başvuru sonucu otomatik olarak işaretlenmedi.' : 'Form oturumu güncellendi.'); }
  catch (error) { notify(error.message, true); }
  try { await refresh(id); } catch (error) { notify(error.message, true); }
}
function renderAssistant(pane, record) {
  const info = record.assistant, current = info.session;
  const box = node('section', 'assistant-box'); box.append(node('h3', '', 'Form yardımcısı'));
  if (!current || current.status === 'closed') {
    box.append(node('p', 'small muted', record.discovery && !record.discovery.routingConfirmed ? 'Form yardımını açmadan önce yukarıdaki ilan bilgilerini doğrula.' : info.available ? 'Tarayıcıda girişini yap, formu aç; bilinen boş alanları panelden doldur. Ücretli model çağrısı yapılmaz.' : 'Bu sitede otomatik doldurma henüz hazır değil. “İlanı aç” ile kendin devam edebilirsin.'));
    const start = node('button', 'secondary', info.demo ? 'Örnek formu aç' : 'Form yardımcısını aç');
    start.disabled = !info.available || info.occupiedByOther || info.opening || assistantRequestPending;
    start.addEventListener('click', () => assistantConsent(record)); box.append(start);
    if (info.opening) box.append(node('p', 'small muted', 'Form penceresi açılıyor…'));
    if (info.occupiedByOther) box.append(node('p', 'small muted', 'Başka bir ilanın form oturumu açık. Yeni pencere için önce onu kapat.'));
    pane.append(box); return;
  }
  const labels = { manual: 'Tarayıcı sende · formu açıp doldurabilirsin', guarded: 'Alanlar kontrol için hazır · site bağlantıları bekletiliyor', released: 'Kontrol tamamen sende', closed: 'Oturum kapalı' };
  box.append(node('p', 'assistant-state', labels[current.status]));
  if (current.lastError) box.append(node('p', 'notice error', 'Son doldurma doğrulanamadı. ' + friendly(current.lastError)));
  if (current.lastResult) {
    box.append(node('p', 'small', 'Son doldurma: ' + current.lastResult.filled + ' alan dolduruldu, ' + current.lastResult.alreadyCorrect + ' alan zaten doğruydu.'));
    if (current.lastResult.status === 'login_required') box.append(node('p', 'small', 'Giriş ekranı var. “Tarayıcıda devam et” ile girişini kendin tamamla.'));
    if (current.lastResult.remaining.length) {
      const details = node('details', 'remaining-fields'); details.open = true;
      details.append(node('summary', '', 'Sana kalan alanlar · ' + current.lastResult.remaining.length));
      const list = node('ul');
      const reasons = { phone_country_requires_human: 'önce ülke telefon kodunu doğrula; numarayı kendin gir', human_decision_required: 'kararı/onayı sen ver', manual_answer_required: 'cevabı sen doldur', ambiguous_field: 'eşleşme belirsiz', interactive_widget_requires_human: 'listeden kendin seç', option_not_unique: 'uygun seçenek kesinleşmedi', existing_value_preserved: 'mevcut cevap korundu', site_validation_requires_human: 'site doğrulamasını kontrol et', manual_file_selection_required: 'CV/dosyayı kendin seç', no_matching_fields: 'önce formu aç' };
      for (const field of current.lastResult.remaining.slice(0, 20)) list.append(node('li', '', (field.label || 'İsimsiz alan') + ' · ' + (reasons[field.reason] || 'kendin kontrol et')));
      details.append(list); box.append(details);
    }
  }
  if (current.status !== 'released') {
    const tabs = node('select'); tabs.setAttribute('aria-label', 'Form sekmesini seç');
    current.tabs.forEach((tab, index) => { const option = node('option', '', 'Sekme ' + (index + 1) + ' · ' + tab.origin); option.value = tab.id; option.selected = tab.selected; tabs.append(option); });
    tabs.disabled = current.status === 'guarded' || current.busy || assistantRequestPending;
    tabs.addEventListener('change', () => { void assistantAction(record.id, { action: 'select', tabId: tabs.value }); }); box.append(tabs);
    if (!current.approved && current.supported) {
      const approve = node('button', 'secondary', 'Bu adreste doldurmaya izin ver'); approve.disabled = current.status === 'guarded';
      approve.addEventListener('click', () => assistantConsent(record, 'approve')); box.append(approve);
    }
    if (!current.supported) box.append(node('p', 'small muted', 'Seçili adres için otomatik doldurma desteklenmiyor. Kontrolü devralarak elle devam edebilirsin.'));
    const controls = node('div', 'assistant-controls');
    for (const [action, label] of [['fill', 'Boş alanları doldur'], ['continue', 'Tarayıcıda devam et'], ['handoff', 'Kontrolü devral']]) {
      const button = node('button', action === 'fill' ? 'primary' : 'secondary', label);
      button.disabled = current.busy || assistantRequestPending || action === 'fill' && (current.status === 'guarded' || !current.supported || !current.approved);
      button.addEventListener('click', () => { button.disabled = true; void assistantAction(record.id, { action }); }); controls.append(button);
    }
    box.append(controls);
    if (current.status === 'guarded') box.append(node('p', 'small muted', 'CV seçmek, formda ilerlemek veya onay vermek için önce “Tarayıcıda devam et”e bas. Doldurma sırasında ağ istekleri durduruldu; alanların siteye kaydedildiğini ayrıca kontrol et.'));
  }
  const close = node('button', 'text-button', 'Oturumu kapat'); close.disabled = current.busy || assistantRequestPending;
  close.addEventListener('click', () => { close.disabled = true; void assistantAction(record.id, { action: 'close' }); }); box.append(close);
  box.append(node('p', 'small muted', 'CV yükleme, giriş/CAPTCHA, hukuki onaylar ve son gönderim sende. Program başvuru sonucunu otomatik işaretlemez.'));
  pane.append(box);
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
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => {
  $('#search').value = ''; $('#filter').value = button.dataset.view;
  void applyFilters().catch(error => notify(error.message, true));
});
function formHandler(selector, action) {
  const form = $(selector); form.addEventListener('submit', async event => { event.preventDefault(); const button = event.submitter || form.querySelector('[type="submit"]'), original = button.textContent; const submits = Array.from(form.querySelectorAll('[type="submit"]')); submits.forEach(item => item.disabled = true); button.textContent = 'İşleniyor…'; form.querySelector('.form-error').textContent = '';
    try { await action(form, event); } catch (error) { form.querySelector('.form-error').textContent = error.message; } finally { submits.forEach(item => item.disabled = false); button.textContent = original; }
  });
}
formHandler('#assistant-form', async form => {
  const intent = assistantIntent; if (!intent) return;
  const firstName = $('#assistant-first').value.trim(), lastName = $('#assistant-last').value.trim();
  if (intent.action === 'start' && Boolean(firstName) !== Boolean(lastName)) throw new Error('Ad ve soyadın ikisini de yaz veya ikisini de boş bırak.');
  const command = intent.action === 'approve' ? { action: 'approve', origin: intent.origin, contactApproved: $('#assistant-consent').checked }
    : { action: 'start', contactApproved: $('#assistant-consent').checked, ...(firstName ? { firstName, lastName } : {}) };
  const result = await assistantRequest(intent.jobId, command);
  form.closest('dialog').close(); await refresh(result.id);
  notify(intent.action === 'start' ? 'Form penceresi açıldı. Girişini tamamlayıp panelden doldurabilirsin.' : 'Bu adres için paylaşım izni verildi.');
});
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

function renderDiscovery(record, pane) {
  if (!record.discovery) return;
  const item = record.discovery, box = node('section', 'assistant-box');
  box.append(node('h3', '', 'Keşif kaynağı: ' + item.sourceKey), node('p', 'small muted', 'Keşfedildi: ' + new Date(item.discoveredAt).toLocaleString('tr-TR') + ' · Yayın tarihi değildir.'), node('p', '', 'Konum: ' + (item.location || 'Belirtilmedi')));
  if (item.levelReason) box.append(node('p', 'small', item.levelReason));
  if (item.search) {
    box.append(node('p', 'small', 'Arama sorgusu: ' + item.search.query));
    box.append(node('p', 'small muted', item.search.dateHint ? 'Arama indeksinin tarih ifadesi: ' + item.search.dateHint + ' · Yayın tarihi ve ilanın açık olduğu doğrulanmadı.' : 'Arama indeksinde ayrı tarih bilgisi yok; ilanın güncelliğini kontrol et.'));
    if (!item.search.verified) {
      box.append(node('h3', '', 'Tam ilan metnini doğrula'), node('p', '', 'Bu kayıt arama motorunun kısa özetinden geldi. İlanı aç; açık olduğunu kontrol edip şirketi, tam metni, ülkeyi ve dili gir. Arama özeti uygunluk analizi için kullanılmaz.'), node('p', 'small muted', item.search.snippet));
      const form = node('form'), company = node('input'), title = node('input'), text = node('textarea'), country = node('select'), language = node('select'), message = node('p', 'form-error');
      company.required = true; company.maxLength = 1200; title.required = true; title.maxLength = 1200; title.value = record.posting.title;
      text.required = true; text.minLength = 20; text.maxLength = 24000; text.rows = 8;
      country.required = true; country.append(new Option('Ülke seç', '')); for (const option of document.querySelector('[name="country"]').options) country.append(new Option(option.text, option.value));
      language.required = true; language.append(new Option('Dil seç', ''), new Option('Türkçe', 'tr'), new Option('İngilizce', 'en'));
      for (const [caption, input] of [['Doğrulanan şirket',company],['Doğrulanan ilan başlığı',title],['Tam ilan metni',text],['Doğrulanan çalışma ülkesi',country],['Doğrulanan ilan dili',language]]) { const label = node('label','',caption); label.append(input); form.append(label); }
      const submit = node('button', 'secondary', 'İlan bilgilerini doğrula'); submit.type = 'submit'; form.append(message, submit);
      form.addEventListener('submit', async event => { event.preventDefault(); if (!form.reportValidity()) return; submit.disabled = true;
        try { await api('/api/jobs/' + record.id + '/verify-posting', { company: company.value, title: title.value, text: text.value, country: country.value, language: language.value }); await refresh(record.id); notify('Tam ilan bilgileri doğrulandı.'); }
        catch (error) { message.textContent = error.message; submit.disabled = false; }
      });
      box.append(form); pane.append(box); return;
    }
    box.append(node('p', 'small', 'Tam ilan bilgileri kullanıcı tarafından doğrulandı.'));
  }
  const list = node('ul', 'small'); for (const reason of item.reasons) list.append(node('li', '', reason)); box.append(list);
  if (!item.routingConfirmed) {
    box.append(node('p', '', 'Başvurmadan önce ilanı açıp çalışma ülkesini ve ilan dilini doğrula. Remote ilanlarda çalışma bölgesi ayrıca sınırlı olabilir.'));
    const country = node('select'); country.setAttribute('aria-label', 'İlanın çalışma ülkesi');
    country.append(new Option('Ülke seç', '')); for (const option of document.querySelector('[name="country"]').options) country.append(new Option(option.text, option.value));
    const language = node('select'); language.setAttribute('aria-label', 'Keşfedilen ilanın dili');
    language.append(new Option('Dil seç', ''), new Option('Türkçe', 'tr'), new Option('İngilizce', 'en'));
    const confirm = node('button', 'secondary', 'Ülke ve dili doğruladım'); confirm.type = 'button';
    confirm.addEventListener('click', async () => { if (!country.value || !language.value) { notify('Ülke ve dili ilan metninden doğrulayarak seç.', true); return; }
      confirm.disabled = true; try { await api('/api/jobs/' + record.id + '/routing', { country: country.value, language: language.value }); await refresh(record.id); notify('Ülke ve dil doğrulandı.'); } catch (error) { confirm.disabled = false; notify(error.message, true); } });
    box.append(country, language, confirm);
  }
  pane.append(box);
}
const discoveryMessages = { DISCOVERY_IMPORT_LIMIT: '100 yeni ilan sınırına ulaşıldı; kalan kayıtlar aktarılmadı', DISCOVERY_COOLDOWN: '15 dakikalık bekleme süresi dolmadı', DISCOVERY_RATE_LIMITED: 'kaynak hız sınırı; tekrar denenmedi', DISCOVERY_SOURCE_HTTP: 'kaynak yanıt vermedi / bulunamadı', DISCOVERY_SOURCE_FORMAT: 'beklenen veri biçimi gelmedi', DISCOVERY_SOURCE_FAILED: 'kaynak okunamadı', DISCOVERY_RESPONSE_TOO_LARGE: 'yanıt boyutu sınırı', DISCOVERY_PAGE_LIMIT: 'sayfa sınırı aşıldı; kaynak aktarılmadı' };
function sourceRow(source = { provider: 'lever', board: '', company: '', locationFallback: '' }) {
  const row = node('div', 'discovery-source');
  const provider = node('select'); provider.setAttribute('aria-label', 'Kaynak sağlayıcı'); provider.append(new Option('Lever', 'lever'), new Option('Greenhouse', 'greenhouse')); provider.value = source.provider;
  const board = node('input'); board.setAttribute('aria-label', 'Şirket kaynak kodu'); board.placeholder = 'Kaynak kodu'; board.value = source.board; board.required = true; board.maxLength = 80;
  const company = node('input'); company.setAttribute('aria-label', 'Kaynak şirket adı'); company.placeholder = 'Şirket adı'; company.value = source.company; company.required = true; company.maxLength = 120;
  const fallback = node('input'); fallback.setAttribute('aria-label', 'Eksik konum için şirket varsayılanı'); fallback.placeholder = 'Varsayılan konum (isteğe bağlı)'; fallback.value = source.locationFallback || ''; fallback.maxLength = 120;
  const remove = node('button', 'secondary', 'Kaldır'); remove.type = 'button'; remove.addEventListener('click', () => row.remove());
  row.append(provider, board, company, fallback, remove); $('#discovery-sources').append(row);
}
function discoveryReport(report) {
  const box = $('#discovery-result'); box.replaceChildren(); if (!report) return;
  box.append(node('p', '', report.added + ' yeni ilan · ücretli model çağrısı yok'), node('p', 'small muted', 'Son tarama: ' + new Date(report.at).toLocaleString('tr-TR')));
  for (const item of report.sources) box.append(node('p', 'small', item.source + ': ' + item.added + ' eklendi · ' + item.duplicates + ' zaten kayıtlı · ' + item.filtered + ' filtre dışı · ' + item.rejected + ' geçersiz kayıt' + (item.code ? ' · ' + (discoveryMessages[item.code] || 'kaynak kontrolü gerekiyor') : '')));
}
function renderSearchSummary(report) {
  const box = $('#discovery-job-summary'); box.replaceChildren(); box.hidden = !report;
  if (!report) return;
  box.append(node('h3', '', 'Son arama özeti'), node('p', 'small muted', new Date(report.at).toLocaleString('tr-TR') + ' · Bu rol ve bölge kriterleri için kayıtlı sonuçlar'));
  box.append(node('p', '', report.examined + ' bağlantı incelendi · ' + report.uniqueLinks + ' benzersiz ilan bağlantısı · ' + report.repeatedLinks + ' arama içi tekrar · ' + report.rejected + ' elenen bağlantı'));
  box.append(node('p', 'small muted', 'Benzersiz bağlantı sayısı yeni eklenen veya hâlâ açık ilan sayısı değildir. Panele ekleme sırasında rol/deneyim filtreleri ve önceki başvurular ayrıca kontrol edilir.'));
  const reasons = report.rejectionReasons, labels = {listingPage: 'Liste/şirket sayfası', unsupportedSite: 'Desteklenmeyen site', unsafeURL: 'Güvensiz/hatalı bağlantı', missingTitle: 'Başlık eksik', invalidPosting: 'Tekil ilan adresi tanınmadı'};
  const details = node('details'), heading = node('summary', '', 'Bağlantılar neden elendi?'); details.append(heading);
  for (const [key, label] of Object.entries(labels)) if (reasons[key]) details.append(node('p', 'small', label + ': ' + reasons[key]));
  const unknown = Math.max(0, report.rejected - Object.values(reasons).reduce((sum, count) => sum + count, 0));
  if (unknown) details.append(node('p', 'small', 'Eski kayıtta nedeni ayrılmamış sonuç: ' + unknown));
  if (!report.rejected) details.append(node('p', 'small', 'Bu aramada bağlantı doğrulamasında elenen sonuç yok.'));
  box.append(details);
  if (report.partial) box.append(node('p', 'small', 'Kısmi sonuç: arama tamamlanmadı.' + (report.failureCode ? ' ' + friendly(report.failureCode) : '')));
}
let discoveryStatusTimer, discoverySearchPending = false, discoveryRoleProfiles = [];
$('#discovery-role-profile').addEventListener('change', () => {
  const profile = discoveryRoleProfiles.find(item => item.id === $('#discovery-role-profile').value);
  if (profile) $('#discovery-roles').value = profile.roles.join(', ');
  $('#discovery-job-queries').hidden = true;
  void refreshDiscoveryStatus();
});
$('#discovery-roles').addEventListener('input', () => { $('#discovery-role-profile').value = ''; });
$('#discovery-roles').addEventListener('change', refreshDiscoveryStatus);
$('#discovery-early-career').addEventListener('change', refreshDiscoveryStatus);
function jobSearchPlanURL() {
  return '/api/discovery/job-search-plan?' + new URLSearchParams({scope: $('#discovery-job-scope').value, roles: $('#discovery-roles').value, earlyCareer: String($('#discovery-early-career').checked)});
}
async function refreshDiscoveryStatus() {
  clearInterval(discoveryStatusTimer);
  const button = $('#discovery-job-search'), label = $('#discovery-search-status'); button.disabled = true;
  try {
    const planURL = jobSearchPlanURL(), data = await api(planURL), status = data.availability;
    if (planURL !== jobSearchPlanURL()) return;
    renderSearchSummary(status?.lastResult || null);
    discoveryRoleProfiles = data.roleProfiles || [];
    const profiles = $('#discovery-role-profile');
    if (profiles.options.length === 1) for (const item of discoveryRoleProfiles) {
      const option = node('option', '', item.label); option.value = item.id; profiles.append(option);
    }
    $('#discovery-auto-search').disabled = !data.automaticSearchEnabled || discoverySearchPending;
    if (!data.automaticSearchEnabled || !status) { label.textContent = 'Kaynak araması bu panel oturumunda kapalı.'; return; }
    const readyAt = Date.now() + status.waitSeconds * 1000;
    const paint = () => {
      const wait = Math.max(0, Math.ceil((readyAt - Date.now()) / 1000));
      const enough = status.remainingToday >= status.requestsPerRun && status.remainingMonth >= status.requestsPerRun;
      button.disabled = discoverySearchPending || (!status.cached && (wait > 0 || !enough || !status.clockValid));
      label.textContent = 'Yerel sorgu hakkı: bugün ' + status.remainingToday + '/8, bu ay ' + status.remainingMonth + '/200. ' +
        (status.cached ? (status.partial ? 'Kayıtlı kısmi sonuçlar hazır; yeni sorgu tüketilmez.' : 'Kayıtlı sonuçlar hazır; yeni sorgu tüketilmez.') :
          !status.clockValid ? 'Bilgisayarın saatini kontrol et.' : !enough ? 'Yerel sorgu sınırına ulaşıldı.' : wait > 0 ? 'Yeni arama: ' + Math.floor(wait/60) + ':' + String(wait%60).padStart(2,'0') + ' sonra.' : 'Arama hazır; en çok ' + status.requestsPerRun + ' sorgu başlatılır.') +
        ' Sağlayıcının gerçek kotası arama başında ayrıca kontrol edilir.';
    };
    paint(); if ($('#discovery-dialog').open) discoveryStatusTimer = setInterval(paint, 1000);
  } catch (error) { label.textContent = error.message; }
}
$('#discovery-dialog').addEventListener('close', () => clearInterval(discoveryStatusTimer));
$('#discovery-add-source').addEventListener('click', () => { if ($('#discovery-sources').children.length < 20) sourceRow(); });
$('#discovery-open').addEventListener('click', async () => {
  try { const data = await api('/api/discovery'); $('#discovery-sources').replaceChildren(); for (const source of data.config.sources) sourceRow(source);
    for (const [id, key] of [['roles','roles'], ['locations','locations'], ['keywords','keywords'], ['excluded','excludedTitles']]) $('#discovery-' + id).value = data.config[key].join(', ');
    $('#discovery-early-career').checked = data.config.earlyCareer;
    $('#discovery-role-profile').value = '';
    $('#discovery-job-queries').hidden = true;
    $('#discovery-job-approval').checked = false; $('#discovery-search-approval').checked = false; $('#discovery-auto-result').textContent = '';
    $('#discovery-job-result').textContent = ''; renderSearchSummary(null);
    discoveryReport(data.lastReport); openDialog('#discovery-dialog'); await refreshDiscoveryStatus();
  } catch (error) { notify(error.message, true); }
});
async function saveDiscoverySettings() {
  const terms = id => $('#discovery-' + id).value.split(',').map(value => value.trim()).filter(Boolean);
  const sources = Array.from($('#discovery-sources').children).map(row => ({ provider: row.children[0].value, board: row.children[1].value.trim(), company: row.children[2].value.trim(), locationFallback: row.children[3].value.trim() }));
  await api('/api/discovery/config', { version: 1, sources, earlyCareer: $('#discovery-early-career').checked, roles: terms('roles'), locations: terms('locations'), keywords: terms('keywords'), excludedTitles: terms('excluded') });
}
formHandler('#discovery-form', async (form, event) => {
  await saveDiscoverySettings();
  if (event.submitter?.value === 'run') { const report = await api('/api/discovery/run', {}); discoveryReport(report); $('#filter').value = 'review'; $('#search').value = ''; await refresh(); notify(report.added + ' yeni ilan inceleme listesine eklendi.'); }
  else notify('Keşif ayarları kaydedildi.');
  await refreshDiscoveryStatus();
});

$('#discovery-search-plan').addEventListener('click', async () => {
  try { const data = await api('/api/discovery/search-plan'); $('#discovery-search-note').textContent = data.note; $('#discovery-search-queries').hidden = false;
    $('#discovery-search-queries').textContent = data.queries.join('\n\n');
  } catch (error) { notify(error.message, true); }
});
$('#discovery-extract').addEventListener('click', async () => {
  try { const urls = $('#discovery-links').value.split(/\s+/).filter(Boolean); const data = await api('/api/discovery/source-candidates', { urls });
    const known = new Set(Array.from($('#discovery-sources').children).map(row => row.children[0].value + ':' + row.children[1].value.trim().toLowerCase())); let added = 0;
    for (const source of data.sources) { const key = source.provider + ':' + source.board.toLowerCase();
      if (known.has(key) || $('#discovery-sources').children.length >= 20) continue; sourceRow(source); known.add(key); added++;
    }
    $('#discovery-search-note').textContent = added + ' kaynak adayı eklendi. Şirket adlarını/kodlarını kontrol et ve kaydet. Ağ isteği yapılmadı; uygunluk henüz doğrulanmadı.';
  } catch (error) { $('#discovery-form .form-error').textContent = error.message; }
});

$('#discovery-auto-search').addEventListener('click', async event => {
  const button = event.currentTarget, output = $('#discovery-auto-result');
  if (!$('#discovery-search-approval').checked) { output.textContent = errors.DISCOVERY_SEARCH_APPROVAL_REQUIRED; return; }
  discoverySearchPending = true; button.disabled = true; output.textContent = 'Kaydedilmiş kriterlerle şirket kaynakları aranıyor…';
  try {
    const data = await api('/api/discovery/source-search', { approved: true });
    const known = new Set(Array.from($('#discovery-sources').children).map(row => row.children[0].value + ':' + row.children[1].value.trim().toLowerCase()));
    let added = 0, skipped = 0, duplicates = 0;
    for (const source of data.sources) { const key = source.provider + ':' + source.board.toLowerCase();
      if (known.has(key)) { duplicates++; continue; }
      if ($('#discovery-sources').children.length >= 20) { skipped++; continue; }
      sourceRow(source); known.add(key); added++;
    }
    output.textContent = (data.partial ? 'Kısmi sonuç: aramanın tamamı bitmedi. ' : '') + added + ' yeni kaynak adayı · ' + duplicates + ' zaten listede · ' + skipped + ' kaynak sınırı nedeniyle eklenmedi. ' + (data.cached ? 'Kayıtlı sonuçlar; yeni sorgu tüketilmedi.' : data.requests + ' arama isteği başlatıldı (başarısız istekler dahil).') + ' Kaynakları kontrol edip kaydet; resmî ilanları toplama adımı henüz çalıştırılmadı.' + (data.failureCode ? ' ' + friendly(data.failureCode) : '');

  } catch (error) { output.textContent = error.message; }
  finally { discoverySearchPending = false; $('#discovery-search-approval').checked = false; await refreshDiscoveryStatus(); }
});

$('#discovery-job-scope').addEventListener('change', refreshDiscoveryStatus);
$('#discovery-job-plan').addEventListener('click', async () => {
  try { await saveDiscoverySettings(); const data = await api(jobSearchPlanURL());
    $('#discovery-job-queries').hidden = false; $('#discovery-job-queries').textContent = data.queries.join('\n\n'); await refreshDiscoveryStatus();
  } catch (error) { $('#discovery-job-result').textContent = error.message; }
});
$('#discovery-job-search').addEventListener('click', async () => {
  const output = $('#discovery-job-result');
  if (!$('#discovery-job-approval').checked) { output.textContent = errors.DISCOVERY_SEARCH_APPROVAL_REQUIRED; return; }
  discoverySearchPending = true; $('#discovery-job-search').disabled = true; $('#discovery-auto-search').disabled = true;
  output.textContent = 'Rollerine göre tekil ilanlar aranıyor…';
  try {
    await saveDiscoverySettings();
    const data = await api('/api/discovery/job-search', { approved: true, scope: $('#discovery-job-scope').value });
    output.textContent = (data.partial ? 'Kısmi arama sonucu. ' : '') + data.examined + ' bağlantı incelendi · ' + data.added + ' yeni ilan adayı · ' + data.duplicates + ' zaten kayıtlı · ' + data.filtered + ' filtre dışı · ' + (data.searchRejected + data.rejected) + ' desteklenmeyen/geçersiz sonuç. ' + (data.cached ? 'Önbellek kullanıldı; yeni sorgu tüketilmedi.' : data.requests + ' arama isteği başlatıldı.') + (data.failureCode ? ' ' + friendly(data.failureCode) : '');
    const reasons = data.rejectionReasons || {}, filters = data.filterReasons || {};
    const labels = { listingPage: 'İlan yerine liste/şirket sayfası', unsupportedSite: 'Desteklenmeyen site', unsafeURL: 'Güvensiz veya hatalı bağlantı', missingTitle: 'Başlık eksik', invalidPosting: 'Tekil ilan adresi tanınmadı' };
    const filterLabels = { role: 'Rol eşleşmedi', excludedTitle: 'Hariç tutulan unvan', keyword: 'Ek kelime eşleşmedi', experience: 'Deneyim şartı yüksek' };
    const details = [...Object.entries(labels).filter(([key]) => reasons[key]).map(([key,label]) => label + ': ' + reasons[key]),
      ...Object.entries(filterLabels).filter(([key]) => filters[key]).map(([key,label]) => label + ': ' + filters[key])];
    const unexplained = data.searchRejected - Object.values(reasons).reduce((sum, count) => sum + count, 0);
    if (unexplained > 0) details.push('Eski kayıtta nedeni ayrılmamış sonuç: ' + unexplained);
    if (details.length) output.textContent += ' Nedenler — ' + details.join(' · ') + '.';
    if (!data.added && !data.duplicates) output.textContent += ' Bu aramada aday çıkmadı; bu, uygun ilan bulunmadığı anlamına gelmez. Rol grubunu veya ek kelimeleri kontrol edebilirsin.';

    $('#filter').value = 'review'; $('#search').value = ''; await refresh(); notify(data.added + ' ilan adayı inceleme listesine eklendi; tam metin ve uygunluk henüz doğrulanmadı.');
  } catch (error) { output.textContent = error.message; }
  finally { discoverySearchPending = false; $('#discovery-job-approval').checked = false; await refreshDiscoveryStatus(); }
});
