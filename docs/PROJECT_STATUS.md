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


## Tek aktif iş: seviyeye uygun keşif ve kaynak aramasını tamamlama

PR #11 yerel main üzerinde e0dd601 ile doğrulandı; keşif ve Peak düzeltmeleri
birleşmiş durumda. Yeni çalışma feature/early-career-discovery dalındadır.

- Başlangıç seviyesi kuralları, başlık etiketi ve inceleme listesinde yeni mezun
  önceliği eklendi. Eski ilan ve başvurular korunuyor.
- İş analizi/BT denetimi ve Türkçe rol karşılıkları varsayılanlara eklendi.
- Kaydedilmiş kriterlerden sorgu taslağı ve toplu kariyer URL'sinden kaynak adayı
  çıkarma eklendi. Bunlar ağ/LLM çağrısı yapmaz.
- SerpAPI kaynak arama bağlantısı uygulandı; varsayılan kapalıdır ve canlı
  kaynak arama ve ilan tarama akışı canlı doğrulandı; bu denemede yeni eşleşme yok. Ayrı ücretsiz hesap/anahtar gerekir;
  OpenAI anahtarı/bütçesi arama servisini kapsamaz.
- Telefon düzeltmesinin gerçek site doğrulaması hâlâ açık; sohbet tarayıcısıyla
  tamamlanan başvurular native program doldurma testi diye raporlanmaz.
- Bu işte ücretli çağrı, hesap oluşturma veya yeni başvuru gönderimi yapılmadı.

Önceki hazırlık doğrulaması: TypeScript ve 132 çevrimdışı test geçti. Ayrı kurgusal panelde
başlangıç seviyesi seçeneği, arama taslağı ve tekrarlı URL’lerden iki şirket
kaynağı çıkarılması doğrulandı. Gerçek panelde açık form oturumu olduğundan
o süreç yeniden başlatılmadı; yeni sürüm henüz gerçek panele yüklenmedi.


### Kaynak arama bağlantısı — SerpAPI

- Resmî belgelerde Serper 2.500 ücretsiz başlangıç sorgusu, SerpAPI ayda 250
  ücretsiz sorgu sunuyor. Serper şartları B2B kullanım diyor; kişisel iş arama
  kullanımımız ve aylık yenilenme için SerpAPI seçildi. Gemini arama kotası modele
  bağlı; bu adımda ikinci LLM eklenmedi. Tüm internetteki ilanları bulma garantisi yok.
- Panelde SerpAPI ile kaynak bulma eklendi. Kaydedilmiş rol/konum sorguları açık
  onayla gider; aday profili/CV/iletişim gitmez. Kaynak adayları taslak listeye
  eklenir; kullanıcı kontrol edip kaydeder ve mevcut resmî ilan taramasını başlatır.
  Arama sonucu tek başına geçerli şirket, açık ilan veya aday uygunluğu kanıtı değildir.
- Her canlı aramadan önce ücretsiz Account API ile etkin 0 USD plan ve kalan kota
  kontrol edilir. Bilinmeyen/ücretli plan engellenir. En çok 4 sorgu/işlem,
  8/gün, 200/UTC takvim ayı; 15 dakika bekleme ve 24 saat aynı sorgu önbelleği var.
  Arama öncesi kalıcı rezervasyon, süreçler arası kilit ve sınırlı yanıt okuma var.
  Belirsiz/başarısız çağrılar geri verilmez; otomatik tekrar/yükseltme/satın alma yok.
- Bu sınırlar bu yerel durum klasörüne aittir. Başka araçların aynı hesabı
  kullanması sağlayıcı kotasını azaltabilir. Sağlayıcı planı/kotası her koşuda
  yeniden okunur; yerel UTC ayı sağlayıcının fatura yenileme tarihi sayılmaz.
- Kayıtlı adaylar en fazla 20 kaynak; arama ilk sonuçlarla sınırlı. SerpAPI veya
  arama motoru tamlık/güncellik garantisi vermez. LinkedIn/Indeed hesabı kullanılmaz;
  başvuru sitelerinde login/CAPTCHA ihtiyacı devam edebilir. Periyodik tarama yoktur.
- TypeScript ve 137 çevrimdışı test geçti; kota, başarısız rezervasyon, önbellek,
  özel hostlar, ücretli plan engeli ve panel izinleri sahte servislerle doğrulandı.
  Ayrı kurgusal panelde onaysız aramanın engellenmesi ve bir kaynak adayı çıkarma
  doğrulandı. Gerçek SerpAPI çağrısı, ödeme veya yeni başvuru yapılmadı.
- Gerçek panelde açık form oturumuna dokunulmadı. Canlı deneme sonucu ve sıradaki
  iş aşağıdadır.


### İlk SerpAPI canlı denemesi ve süre düzeltmesi

- Kullanıcı ücretsiz hesabı/anahtarı hazırladığını bildirdi. Anahtar özel `.env`
  içinde mevcut ve dosya izinleri 0600 olarak kontrol edildi; anahtar gösterilmedi.
- Account API canlı doğrulaması: etkin plan 0 USD, aylık 250 sorgu. Denemeden
  sonra 248 kalan / 2 kullanılan sorgu bildirildi. OpenAI çağrısı yapılmadı.
- İkinci arama isteği 15 saniyelik istemci sınırında bağlantı/süre hatası verdi.
  Otomatik tekrar yapılmadı, iki rezervasyon korundu. Eski akış yalnızca bütün
  sorgular bitince sakladığı için tamamlanan ilk yanıt korunamadı; panele yeni
  kaynak veya ilan aktarılmadı. Arşiv listeleme uç noktası JSON vermediğinden bu
  yöntemle sonuç kurtarma yapılamadı; desteklenmeyen entegrasyon eklenmedi.
- Arama isteği sınırı 60 saniyeye çıkarıldı; hesap kontrolü 15 saniye kaldı.
  Her tamamlanan sorgunun kaynakları artık ayrı ayrı kalıcı saklanır. Sonraki
  sorgu başarısız olursa kısmi sonuç ve hata görünür; yeniden başlatmada korunur,
  eksik sorgular otomatik tekrar edilmez. Eski önbellek dosyaları uyumludur.
- TypeScript ve 138 çevrimdışı test geçti. Kısmi sonuç/süre aşımı düzeltmesi
  sahte servisle doğrulandı; düzeltilmiş süreyle yeni canlı arama yapılmadı.
- Sonraki kullanıcı onayıyla panel güncellendi ve bekleme dolunca aşağıdaki canlı
  deneme tamamlandı. Bekleme ve ücretsiz kota korumaları korundu.


### Panelden canlı keşif doğrulaması

- Kullanıcı eski açık form oturumunu kapatıp devam etmeyi onayladı. Güncel panel
  3211 portunda, kaynak araması açık ve ücretli model kapalı çalışıyor.
- Panel rol/konum paylaşımı onayı → kaynak arama → kaynakları kaydetme → resmî
  ilanları okuma akışı gerçek SerpAPI/Greenhouse/Lever uç noktalarıyla tamamlandı.
  İlanlar sohbetin web aramasıyla elle bulunup program bulmuş gibi gösterilmedi.
- Dört arama isteği iki yeni kaynak adayı çıkardı: dominodatalab ve idme.
  Mevcut Peak/GitLab dahil dört kaynak yapılandırıldı. Bu kaynak listesi,
  şirketin aday seviyesine veya Türkiye'ye uygunluğunun kanıtı değildir.
- Tarama: 5 mevcut kayıt, 290 filtre dışı, 21 desteklenmeyen bağlantı, 0 yeni ilan.
  Domino'nun 21 absolute_url alanı app.careerpuck.com kullanıyor; bu hedef mevcut
  izin verilen platformlarda yok. Resmî API'nin public metadata kontrolü bunu
  doğruladı; rastgele host/redirect izni veya yeni site adaptörü eklenmedi.
- Önceki 8 ilan dosyası tarama öncesi/sonrası hash ile aynı; 5 submitted durum
  kaydı ve eski analizler korunuyor. Yeni başvuru gönderilmedi, profil/CV buluta
  gönderilmedi, OpenAI/model çağrısı yapılmadı.
- SerpAPI Account API son kontrolü: 0 USD plan, 246 kalan / toplam 4 tüketilmiş
  sorgu. Yerel sayaç 6 başlatılmış isteği tutuyor (önceki hatalı deneme dahil);
  sağlayıcı önbelleği ve belirsiz faturalama nedeniyle gerçek tüketimle aynı
  olduğu varsayılmıyor. Yerel kalan 2/gün ve 194/ay, gerçek SerpAPI bakiyesi değil.
- Panelde yerel kalan sorgu sayısı, geri sayım, önbellek hazır bilgisi ve hazır
  olmayan arama düğmesinin pasif durumu eklendi. Gösterge dış servisi çağırmaz;
  arama sürerken düğme açılmaz. TypeScript ve 138 çevrimdışı test geçti; gerçek
  panelde geri sayım, otomatik açılan düğme ve kalıcı dört kaynak doğrulandı.

Sıradaki tek iş: kaynak aramasının kapsamasını ve teşhisini iyileştirmek.
Türkiye odaklı aramayı küresel remote aramadan ayırmayı ve sorgu başına bağlantı/
elendi sayısını görünür kılmayı değerlendir. İlk sonuçların azlığı tüm internette
uygun ilan olmadığı anlamına gelmez. Yeni ücretli sağlayıcı, site adaptörü,
başvuru otomasyonu veya zamanlanmış tarama ekleme; önce mevcut aramanın sonuç
kalitesini artır. Yeni canlı aramalar için mevcut kullanıcı onayı ve kota kuralları sürer.
