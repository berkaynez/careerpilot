# CareerPilot — güncel durum ve devam planı

Son düzenleme: 18 Ekim 2026. Bu dosya güncel kapsamın ve sıradaki işin tek kaynağıdır.
Bir iş tamamlandığında buradaki durum değiştirilir; yeni bir paralel plan eklenmez.

## Ürün hedefi

**Yarı-Otonom İş Başvuru Komuta Merkezi (Hybrid Job Application Hub).** Kullanıcı
ilanı ekler, profil dayanaklarıyla AI analizini ve açıklanabilir uyum puanını inceler,
yerel panelden form yardımcısını açar ve karmaşık adımlarda kontrolü devralır.
Hedef başvuru hazırlama süresini %80 azaltmaktır; henüz ölçülmüş bir sonuç değildir.

Onaylanan teslim sırası ve teknik kararlar [hibrit mimari](HYBRID_ARCHITECTURE.md)
belgesindedir. Aşağıdaki aktif iş listesi uygulamanın tek güncel devam kaydıdır.
Yerel panel, 0–100 puan ve panelden asistan başlatma henüz uygulanmadı.

## Mevcut parçalar ve kanıtları

- **Yerel AI döngüsü:** `src/agent`, `src/browser`, `src/providers`.
  Model kararı, referans tabanlı cevaplar, gizlilik ve kalıcı bütçe altyapısı var.
  `agent` komutu yerel kurgusal sunucuyu kullanır; gerçek site akışına bağlı değildir.
  Çevrimdışı testler model yanıtlarını taklit eder.
- **Belge hazırlığı:** `src/preparation`. Özel profilden mevcut CV seçimi,
  genel aday anlatımlı ön yazı ve yerel paket oluşturma var. Bu, CV üretimi veya
  her ilanın gereksinimlerine otomatik uyum değerlendirmesi değildir.
- **İlan bağlantısı:** `src/jobs`. LinkedIn, Indeed, Kariyer.net, Lever ve
  Greenhouse bağlantıları tanınır. Açık sayfadan sınırlı okuma yapılır; erişim
  koruması aşılmaz. İşveren bağlantısı keşfi Lever/Greenhouse ile sınırlıdır.
- **Lever:** `src/lever`. Form inceleme, onaylı alan hazırlığı/CV yüklemesi ve
  insan devri var. Önceki geliştirme kaydında gerçek bir Lever CV yükleme denemesi
  bildirilmiştir; bu, diğer sitelere veya gözetimsiz gönderime kanıt değildir.
- **Ortak form yardımcısı:** `src/applications`. Bilinen görünür boş alanlar,
  isim parçaları, iletişim/link bilgileri, tekil üniversite seçimi ve ilana özel
  maaş/ihbar cevapları desteklenir. Mevcut değerler korunur; belirsiz alanlar
  kullanıcıya kalır. Gerçek hesap uyumluluğu CLI üzerinden doğrulanmış değildir.
- **Workday:** ortak yardımcının izin verilen adres listesinde yoktur; doğrudan
  ilan bağlantısı ve özel liste/tarih/geçmiş alanları için tamamlanmış adaptör yoktur.
  18 Ekim'deki Infobip formunu sohbetin tarayıcı aracı hazırladı, kullanıcı gönderdi;
  başarı ekranı gözlendi. Bu, CareerPilot CLI testi değildir.

## Tek aktif iş: ortak yardımcı dalını kapatmak

Yerel çalışma dalı: `feature/multi-platform-assist`.
Yerel `main` kaydı: PR #7 birleşimi. Bu kayıt uzaktan güncellenmeden GitHub'daki
son durum veya açık PR durumu hakkında kesin hüküm verilmez.

Dalın mevcut kapsamı:

- Ortak gözetimli form yardımı ve Indeed/Kariyer.net bağlantı tanıma.
- E-posta ile başlayan giriş ekranında durma.
- Tek alanlı erişilebilir soru grupları ve metin alanlarını tanıma.
- Kullanıcının sağladığı maaş/ihbar cevabını yalnızca aynı tam sayfa adresinde kullanma.
- Mevcut cevapları koruma ve sayfa/ilan değişince eski cevabı yazmadan durma.
- Kapsamı ve kullanım bilgisini tek yerde toplama.

Bu dal mevcut form desteği, doküman toparlaması ve onaylanan hibrit yönün planıyla kapanır.
Panel veya yeni adaptör uygulaması bu dala eklenmez.
Önceden yapılmış değişiklikler korunur. Kullanıcıya ait `.vscode/` dosyaları
bu çalışmanın parçası değildir. Kullanıcı 18 Ekim 2026 tarihinde bu dal için
commit/PR/birleşim işlemlerini onayladı. Gerçekleşmeyen push/merge tamamlandı diye yazılmaz.

Dalın kapanış ölçütleri:

- [x] Yeni özelliklerin kapsamı ve gerçek-site sınırları belgeli.
- [x] TypeScript ve 106 çevrimdışı test, önceki işlevsel değişikliklerden sonra geçti.
- [x] Kurgusal testler: eksik cevap, farklı ilan, çok alanlı grup ve değişen soru/adres.
- [x] Son doküman düzenlemesinden sonra TypeScript, 106 çevrimdışı test ve whitespace kontrolü geçti.
- [x] Yeni ürün yönü, teslim sırası ve güvenlik sınırları mimari belgede toplandı.
- [x] Kapanış kodu TypeScript ve 106 çevrimdışı testten geçti; `4cc9a37` ile commit edildi.
- [x] Mimari plan ve güncel kullanım belgeleri ayrı doküman commit paketine hazırlandı.
- [ ] GitHub erişimi sağlanınca mevcut PR varsa güncelle ve birleştir; yoksa tek PR aç.

GitHub erişim durumu (18 Ekim 2026): `git fetch origin` kimlik doğrulaması
olmadığı için başarısız. Sohbet tarayıcısında GitHub oturumu açık değil ve özel
repo görünmüyor. Güncel uzak dal/PR durumu doğrulanamadı; uzakta birleşim yapılmadı.

Test sayısı başarı ölçütü değildir. Kontroller alanların doğru doldurulduğunu,
yanlış cevabın taşınmadığını ve gizlilik/onay sınırlarının korunduğunu göstermelidir.

## Dal kapandıktan sonraki işler

1. **Analiz ve açıklanabilir puan:** mevcut `preparePostingWithModel` ve doğrulanmış
   `Plan` yapısını kullan. Skor formülü kodda hesaplanır, gereksinim/faktör katkıları
   görünürdür. Belgesiz bilgi, eksik analiz ve çalışma hakkı puandan ayrı gösterilir.
2. **Yerel panel:** hafif HTML/CSS/JavaScript + mevcut Node/TypeScript. İlan ekle,
   analiz görüntüle, başvuru durumunu takip et. Kayıtlar özel yerel dizinde kalır.
3. **Form asistanı bağlantısı:** mevcut doldur/devam/devral akışını panelden erişilir
   yap; onaylı CV yüklemesini desteklenen yerde kullan, diğer yerde kullanıcıya bırak.
4. **Gerçek pilot ve ölçüm:** programın hibrit akışıyla bir hazırlığı doğrula;
   gerçek/manuel/taklit işlemleri ayır, toplam süreyi ve kalan manuel adımları kaydet.

Ayrıntılı kabul ölçütleri mimari belgede. Yeni UI yönü açıkça onaylandığı için
önceki “CLI pilotu bitmeden UI ekleme” kuralı yürürlükten kaldırıldı.
Her siteye ayrı robot kurma, toplu/gözetimsiz gönderim, yeni provider ve e-posta
entegrasyonu MVP kapsamına alınmadı.

## Harcama ve veri sınırları

Bu dal kapanışı ve mimari planlama çalışmasında ücretli API çağrısı veya gerçek başvuru yapılmaz.
`job`, yerel `prepare` ve `assist` ücretli model kullanmaz. `agent` ve açıkça
onaylanan model incelemeleri farklıdır. Kod varsayılanları aylık 5 USD ve koşu
başına 0,10 USD'dir; özel `.env` farklı olabilir. Bu limitler ödeme hesabının
otomatik yükleme ayarını değiştirmez. Bütçe korumaları korunur.
