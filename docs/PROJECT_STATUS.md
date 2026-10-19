# CareerPilot — güncel durum ve devam planı

Son düzenleme: 19 Ekim 2026. Bu dosya güncel kapsamın ve sıradaki işin tek kaynağıdır.
Bir iş tamamlandığında buradaki durum değiştirilir; yeni bir paralel plan eklenmez.

## Ürün hedefi

**Yarı-Otonom İş Başvuru Komuta Merkezi (Hybrid Job Application Hub).** Kullanıcı
ilanı ekler, profil dayanaklarıyla AI analizini ve açıklanabilir uyum puanını inceler,
yerel panelden form yardımcısını açar ve karmaşık adımlarda kontrolü devralır.
Hedef başvuru hazırlama süresini %80 azaltmaktır; henüz ölçülmüş bir sonuç değildir.

Onaylanan teslim sırası ve teknik kararlar [hibrit mimari](HYBRID_ARCHITECTURE.md)
belgesindedir. Aşağıdaki aktif iş listesi uygulamanın tek güncel devam kaydıdır.
0–100 uyum puanı ve dayanak raporu mevcut hazırlık akışına eklendi.
Yerel panelde ilan kaydı, analiz görüntüleme ve durum takibi eklendi.
Panelden form yardımı açma, doldurma, sekme/izin seçimi ve kullanıcı devri eklendi.

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

## Önceki dal kapandı

PR #8, `f1f656e` ile main'e birleştirildi; kullanıcının switch/pull işleminden
sonra yerel main üzerinde doğrulandı. Ortak yardımcı ve hibrit mimari planı korundu.
Önceki terminal GitHub erişim sorunu bu yerel birleşim doğrulamasını değiştirmez.

## Tamamlanan analiz teslimi

`6e78f63` açıklanabilir skor ve raporu ekledi; TypeScript ve 110 çevrimdışı test geçti.
Skor, panel ve form bağlantısı PR #9 ile main'e birleşti; yerel a8aeb09 üzerinde doğrulandı.
Skor gerçek işe alınma/ATS tahmini değil, değerlendirilmiş gereksinimlerdeki dayanak kapsamıdır.

## Tamamlanan panel teslimi

31c05d5 yerel panel, kalıcı kayıtlar ve analiz ekranlarını ekledi. TypeScript ve
116 çevrimdışı test geçti. Skor + panel commit'leri feature/local-hub dalındadır;
PR #9 ile a8aeb09 üzerinde main'e birleştirildikleri doğrulandı.

## Tamamlanan form bağlantısı

Aynı feature/local-hub dalında mevcut doldurma ve trafik koruma motoru kullanılıyor.
Yeni sağlayıcı veya siteye özel adaptör yok. Dal skor + panel + form bağlantısını
tek PR'de incelemeye uygundur. Kullanıcıya ait .vscode/ dosyaları dahil edilmez.

- [x] Alıcı/veri paylaşımı onayıyla ayrı tarayıcı oturumu açma.
- [x] Panelden doldur / tarayıcıda devam et / kontrolü devral / kapat.
- [x] Kararlı sekme seçimi ve yeni adreste ayrıca paylaşım izni.
- [x] Mevcut değerleri koruma, bilinmeyen sorular ve belgeleri kullanıcıya bırakma.
- [x] Doldurmada ağ/gönderim koruması; kontrol devrinden sonra otomasyonu bitirme.
- [x] Yenilemede canlı oturumu gösterme ve aynı anda ikinci oturumu engelleme.
- [x] Gereksiz yeniden çizmeden durum izleme ve özel metadata kaydı.
- [x] Örnek modda yalnızca sahip olunan yerel formda açma/doldurma.
- [x] Kurgusal testler: onay, doldurma, yan etkiler, sekme/alıcı sınırları ve kullanıcı devri.
- [x] TypeScript, 120 çevrimdışı test ve whitespace kontrolü geçti.
- [x] Panelde doldur/devam/devral/kapat adımları yerel tarayıcıda doğrulandı.

İlk panel denemesinde program yerel mock formdaki iki alanı doldurdu ve kalan beş
alan/onayı kullanıcıya bıraktı. Bu bir gerçek site testi veya tam başvuru değildir.
Ortak panel akışında CV yükleme, giriş/CAPTCHA, hukuki onay ve son gönderim kullanıcıdadır.
Ayrı Lever yükleme akışı korunuyor; Workday otomatik doldurma desteği eklenmedi.
AGENTS.md değiştirilmedi; CLI'nın terminal akışı ve mevcut korumaları korunuyor.

## Pilotun sonucu ve kalan doğrulama

Kullanıcı iki gerçek başvuruyu tamamladı. İkinci denemede ön yazıyı sohbetin tarayıcı aracı ekledi; CareerPilot otomatik doldurma başarısı olarak sayılmaz. Telefon düzeltmesinin gerçek site doğrulaması ve zaman kazancı ölçümü açık.
Her gerçek profil paylaşımı/CV yüklemesi için o işlem ve hedefe özel kullanıcı
onayı gerekir. Programın yaptığı, elle yapılan ve taklit edilen işleri ayır;
toplam süreyi ve kalan manuel adımları kaydet. Ücretli analiz ayrıca onay gerektirir.

Ayrıntılı kabul ölçütleri mimari belgede. Yeni UI yönü açıkça onaylandığı için
önceki “CLI pilotu bitmeden UI ekleme” kuralı yürürlükten kaldırıldı.
Her siteye ayrı robot kurma, toplu/gözetimsiz gönderim, yeni provider ve e-posta
entegrasyonu MVP kapsamına alınmadı.

## Harcama ve veri sınırları

Bu form bağlantısı geliştirmesinde ücretli API çağrısı veya gerçek başvuru yapılmaz.
`job`, yerel `prepare` ve `assist` ücretli model kullanmaz. `agent` ve açıkça
onaylanan model incelemeleri farklıdır. Kod varsayılanları aylık 5 USD ve koşu
başına 0,10 USD'dir; özel `.env` farklı olabilir. Bu limitler ödeme hesabının
otomatik yükleme ayarını değiştirmez. Bütçe korumaları korunur.

## Pilot sırasında istenen takip iyileştirmesi

feature/submitted-applications dalında Başvurulanlar görünümü ve kayıt sayacı
eklendi; mevcut durum filtresi ve özel kayıtlar kullanılıyor. Dar ekranlarda da
gezinme düğmeleri görünür. Başvuruldu durumu kullanıcı beyanıdır, otomatik
şirket doğrulaması değildir. Bu değişiklik yeni site veya model desteği eklemez.

## Pilot düzeltmeleri — 19 Ekim

- Özel profilin CareerPilot proje bilgisi mevcut AI döngüsü, panel ve gözetimli
  form desteğini anlatacak şekilde güncellendi; AI desteği/prototip sınırı korundu.
  Kişisel profil ignored alanda, Git'e eklenmez.
- Değerlendirme talimatları proje düzeyinde agent deneyimi ile profesyonel Python,
  multimodal üretim ve üretim entegrasyonunu ayırıyor. Bu talimat değişikliği yeni
  ücretli model çağrısıyla doğrulanmadı; önceki skor elle değiştirilmedi.
- Mobile phone number etiketi ve doğrulanmış +90 kodu/ulusal numara ayrımı eklendi.
  Belirsiz/özel kod listeleri ve mevcut farklı kod kullanıcıya bırakılır.
- TypeScript ve 121 çevrimdışı test geçti. Telefon testleri gerçek sitenin aynası
  değildir; authored formlar kullanır. Gerçek site telefon doğrulaması hâlâ açık.

## Tamamlanan ilk keşif teslimi

Kullanıcı Greenhouse + Lever ilk sürümünü açıkça onayladı. Düzeltme dalı yerel
main üzerine fast-forward birleştirildi (d51e33d); GitHub’a push/merge yapılmadı.
İlk keşif teslimi feature/job-discovery dalında tamamlandı; henüz push/merge yapılmadı.
Kişisel hesapları riske atmama ve basit/sürdürülebilir yöntem önceliklidir;
mevcut toplu başvuru, CAPTCHA aşma ve gözetimsiz gönderim sınırları korunur.


### Keşif kabul kaydı

- Resmî Greenhouse/Lever global GET okuyucuları, ücretsiz filtre ve mevcut review
  kayıtlarına aktarım eklendi. Şirket kaynakları tek tek yapılandırılır.
- Kimlik/URL tekrarları atlanır; mevcut başvuru/analiz korunur. Kaynak hataları
  ayrı raporlanır. Kalıcı 15 dakika bekleme, yanıt/süre/sayfa/aktarım sınırları var.
- Ülke/dil belirsizliği CV, analiz ve form başlatma öncesi açıkça doğrulanır.
- TypeScript ve 128 çevrimdışı test geçti. Bunlar authored/mocked kaynaklardır.
- Gerçek uç nokta kontrolü: Peak Lever kaynağı 18 ve GitLab Greenhouse kaynağı
  232 ilan okundu. Panel taraması 1 kelime eşleşmesini review listesine ekledi;
  bu ilan ara seviyedir, aday için uygunluk veya Türkiye’den çalışma izni kanıtı değildir.
- İlk teslim kullanıcı düğmesiyle çalışır. Arka plan/periyodik tarama yoktur.
  Sonraki aday iş, kaynak/kriter iyileştirmesinden sonra açılıp kapatılabilir
  periyodik kontrolü değerlendirmektir. Henüz zamanlanmış görev oluşturulmadı.


### Peak konum düzeltmesi

Kullanıcı Peak ilanlarının Türkiye’de olduğunu doğruladı. Resmî API’nin konum
alanı `Full-time` geldiğinden ilk filtre bu kayıtları yanlışlıkla eledi.
İş türleri konumdan ayrıldı; yalnızca eksik konum için açık kaynak varsayılanı
eklendi. Özel Peak kaynağına kullanıcı beyanıyla Türkiye varsayılanı girildi.
Canlı tekrar taraması 5 yazılım ilanını (2 New Grad dahil) inceleme listesine ekledi.
129 çevrimdışı test geçti; farklı ilan konumunun üzerine yazılmadığı test edildi.
Bu taramada ücretli model çağrısı veya başvuru gönderimi yapılmadı.
