# CareerPilot — güncel durum ve devam planı

Son düzenleme: 20 Ekim 2026. Bu dosya güncel kapsamın ve sıradaki işin tek kaynağıdır.
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

Kullanıcı bu yaklaşımın hâlâ şirket kataloğuna bağlı olduğunu belirtti ve
rol bazlı sonuçlardaki tekil ilanların doğrudan panele eklenmesini onayladı.
Aşağıdaki teslim bu yön değişikliğini uygular.


### Rol bazlı doğrudan ilan keşfi

- Şirket listesine gerek olmadan SerpAPI organik sonuçlarından tekil ilanlar
  alınır. LinkedIn/Indeed/Kariyer.net/Lever/Greenhouse adresleri mevcut URL
  doğrulayıcısıyla kontrol edilir; liste sayfaları, özel/kimlik bilgili URL'ler ve
  desteklenmeyen siteler taranmaz. Kişisel hesap, cookie veya CAPTCHA kullanılmaz.
- Rol grupları iki sorguya dağıtılır; roller kesilip atılmaz. Türkiye ve Global
  remote ayrı seçeneklerdir. Başlangıç seviyesi kutusu arama sorgusunda da etkilidir.
  Arama sonucundaki rol/başlık ve isteğe bağlı kelime filtresi ücretsiz uygulanır.
  Arama indeksi gerçek konum, açık ilan veya aday uygunluğu kanıtı sayılmaz.
- Sonuçlar doğrudan review kaydı olur; şirket kaynağı ekleme veya bütün şirketin
  iş listesini tarama ön koşulu yoktur. Eski şirket takibi Gelişmiş bölümünde kaldı.
- Arama başlığı/özeti ve sorgu özel kayıtta kaynak bilgisiyle saklanır. Şirket,
  ülke/dil ve tam metin başlangıçta doğrulanmamıştır. Ayrı doğrulama ekranı bu
  bilgileri ister. Sadece ülke/dil seçmek kısa özeti analiz için yeterli hâle getirmez;
  tam metin doğrulanana kadar CV seçimi, form başlatma ve model analizi engellenir.
- Tam metin otomatik alınmıyor; doğrulama insanın ilanı açıp metni getirmesidir.
  Arama motorundaki özetler başka ilanlardan metin içerebilir veya eski olabilir.
  Tüm ilanları kapsama, açık olduklarını kanıtlama veya %80 tasarruf iddiası yoktur.
- LinkedIn'in ülke alt alanları ve başlıklı/numerik iş bağlantıları aynı iş ID'sine
  normalize edilir; takip parametreleri atılır. Tüm durumlar tekrar kontrolüne
  dahildir. Aynı rolün farklı yayın ID'leri kesin aynı ilan diye otomatik silinmez.
- Kaynak ve ilan araması aynı kalıcı günlük/aylık sayaç ve 15 dakika beklemeyi
  kullanır; önbellek anahtarı arama türlerini ayırır. Eski cache/ilan dosyaları
  varsayılan alanlarla okunur. Kısmi sonuçların kalıcı korunması devam eder.
- TypeScript, 142 çevrimdışı test ve whitespace kontrolü geçti. Kurgusal testte
  şirket kataloğu boşken üç farklı şirketten ilan eklendi; gerçek iş sitelerine
  istek yapılmadı. Tam metin doğrulanmadan analizin engellendiği test edildi.
- Gerçek panelde Türkiye rol araması: iki SerpAPI isteği, 20 sonuç, 18 desteklenmeyen/
  geçersiz bağlantı ve 2 review adayı. İkisi de Dream Games Software Engineer
  (New Grad) başlığında, farklı LinkedIn yayın ID'leridir. Açıklık, ayrı ilan mı
  yeniden yayın mı olduğu ve uygunluk henüz doğrulanmadı. Şirket kataloğu aynı
  dört kaynakta kaldı; hiçbir şirket iş listesi bu yeni arama adımında okunmadı.
- Önceki 8 ilan dosyasının hash'i aynı; toplam 10 kayıt, 2 review, 5 submitted.
  SerpAPI canlı bakiye kontrolü: 0 USD plan, 244 kalan / 6 tüketilmiş sorgu.
  Yerel başlatılmış istek sayısı 8 (sağlayıcı önbelleği nedeniyle tüketimle aynı
  değildir); günlük yeni sorgu sınırı doldu. Aynı Türkiye sonuçları cache'den
  tekrar alınabilir. Yeni global remote araması yapılmadı; bütçe aşılmadı.
- OpenAI/model çağrısı, profil/CV paylaşımı, yeni başvuru gönderimi yapılmadı.

## Rol aramasının kalitesi — tamamlanan artım

- Panelde Yazılım geliştirme, Veri ve iş analizi ve BT denetimi hazır grupları
  var. Türkçe/İngilizce unvanlar düzenlenebilir pozisyon alanına alınır; mevcut
  kişisel roller kendiliğinden değiştirilmez. Bu gruplar aday yetkinliği iddiası
  değildir. Kendi rollerini yazma seçeneği devam eder.
- Ücretsiz başlık filtresi bilinen karşılıkları eşleştirir: örneğin kayıtlı
  software engineer hedefi, Yazılım Mühendisi başlığını kabul eder. Veri analisti
  gibi başka bir rol bu eşleştirmeyle yazılım hedefine eklenmez.
- Yeni aramalarda liste/şirket sayfası, desteklenmeyen site, güvensiz/hatalı adres,
  eksik başlık ve tanınmayan ilan bağlantısı sayıları ayrılır. Rol, hariç unvan,
  ek kelime ve deneyim filtreleri ayrı nedenler gösterir; ilk eşleşen eleme nedeni
  sayılır. Eski cache'deki toplam reddetme sayısına neden uydurulmaz.
- SerpAPI ayrı date alanı verirse düz metin olarak özel kayda alınır. Bu,
  doğrulanmamış arama indeksi tarih ifadesidir; keşfedilme/yayın tarihi veya açık
  ilan kanıtına dönüştürülmez. Tarihi belirsiz/eski adaylar otomatik silinmez.
- Kaydetmeden rol grubu önizlemesi, seçili kriterlerin sorgu/kota/önbellek durumunu
  yerel hesaplar. Yeni arama başlatmaz, kullanıcı ayarlarını veya sayacı değiştirmez.
- Yeni sağlayıcı/runtime veya bağımsız ajan katmanı eklenmedi. Fikir kaynağı:
  [ai-job-search rol bazlı arama yaklaşımı](https://github.com/MadsLorentzen/ai-job-search/blob/0f6480d32e59d7651d920a5ec6d78ede2f4113bf/.claude/skills/job-scraper/search-queries.md)
  ve aynı revizyondaki job-scraper akışının kaynak/güncellik ayrımı. Kod özgün
  TypeScript uygulamasıdır; dış projenin scriptleri çalıştırılmadı veya kopyalanmadı.
- TypeScript ve 147 çevrimdışı test geçti; önceki 142 test korundu. Yeni arama
  kalitesi canlı sağlayıcı sorgusuyla ölçülmedi. Ücretli model çağrısı veya başvuru
  gönderimi yok; dolu günlük kota ve mevcut özel kayıtlar korunuyor.

## Son arama özeti — tamamlandı

- İlan keşfet ekranı, mevcut source-search.json önbelleğindeki son eşleşen
  kriterlerin özetini gösterir. Yeni dosya, rapor geçmişi veya sağlayıcı eklenmedi.
- İncelenen bağlantı, benzersiz desteklenen ilan adresi, arama içi tekrar ve
  reddedilen adres sayıları ayrıdır. Benzersiz bağlantı sayısı yeni eklenen/açık
  ilan sayısı olarak sunulmaz; panele alınırken uygulanan rol/deneyim filtresi
  ve önceden başvurulmuş ilan kontrolü ayrıca çalışır.
- Pencereyi kapatma/yeniden açma ve sunucuyu yeniden başlatma raporu kaybettirmez.
  24 saatlik tekrar kullanım süresi bitse de rapor okunabilir; yeni arama hakkı
  veya kota muafiyeti sağlamaz. Başka rol/bölge kriterinde eski rapor gösterilmez.
- Gerçek panelde mevcut kayıttan 20 bağlantı / 2 benzersiz / 0 arama içi tekrar /
  18 reddedilen bağlantı gösterildi. Eski 18 sonuç için ayrıntı bulunmadığı
  açıkça yazıyor. Yeni SerpAPI veya model isteği yapılmadı.
- TypeScript ve 148 çevrimdışı test geçti. Yeniden başlatma, cache süresi dolması,
  kriter değişimi ve özet okumanın disk/sayaç değiştirmemesi kurgusal transportla
  doğrulandı. Canlı sorgu kalitesi hakkında yeni bir kanıt oluşmadı.

## FreeHire keşfi — canlı panel denemesi tamamlandı

- Kullanıcı onayıyla FreeHire'ın herkese açık agent/jobs/search API'si eklendi.
  Yeni runtime/paket, kişisel hesap, scraping veya ücretli sağlayıcı yoktur.
  API sözleşmesi ve fikir kaynağı: ai-job-search revizyonu
  0f6480d32e59d7651d920a5ec6d78ede2f4113bf, freehire-search istemcisi;
  özgün TypeScript uygulaması yazıldı, dış script çalıştırılmadı/kopyalanmadı.
- Türkiye veya Global remote, isteğe bağlı junior ve son 30 gün filtreleri;
  sayfa başına 30 kayıt, en çok 10 sayfa ve yalnızca insanın sonraki sayfa isteği.
  Roller ve ek kelimeler mevcut ücretsiz yerel filtreyle uygulanır. Global remote
  sonuçları Türkiye'den çalışma/sponsorluk uygunluğu anlamına gelmez.
- Aynı sorgu/sayfa 10 dakika oturum içi cache kullanır. Yeni istekler arasında
  30 saniye, 429 sonrası 5 dakika beklenir; otomatik yeniden deneme yoktur.
  SerpAPI'nin günlük/aylık kaydı değiştirilmez. FreeHire ücretsiz/anahtarsız
  ayrı bir kaynaktır; sınırsızlık veya hizmet sürekliliği taahhüdü değildir.
- Şirket ve kaynağın sağladığı metin review kaydına alınır. Ülke/dil ve metin
  insan tarafından doğrulanmadan CV seçimi, analiz ve form yardımı açılmaz.
  Kaynağın verdiği metin doğrulama formuna hazır gelir; tekrar kopyalamak gerekmez.
  FreeHire bağlantısında otomatik form doldurma yoktur. Desteklenen işveren
  bağlantısı varsa ayrıca gösterilir; diğer işveren siteleri otomatik izlenmez.
- Bilinen aynı URL'ler başvuru durumundan bağımsız tekrar kontrolüne dahildir.
  Aynı şirket/benzer başlık kayıtları kesin tekrar diye silinmez; özellikle
  daha önce submitted işaretlenmişse karşılaştırma uyarısı gösterilir.
- İlk bağımsız canlı kontrol 10 kayıtla API'yi doğruladı; ardından gerçek panel
  tek sorguda 28 kayıt aldı: 12 yeni review adayı, 16 filtre dışı, 0 kapalı ve
  0 biçim hatası. Bunlar 12 doğrulanmış açık/ayrı/uygun iş iddiası değildir;
  örneğin Obilet eski başvurusuna benzeyen ve aynı şirketin yeniden yayınları var.
- Yerel toplam 22 kayıt: 14 review, 5 submitted, 3 archived. Önceki 10 ilan dosyası
  ve SerpAPI ledger hash'leri aynı kaldı. Mevcut dört şirket kaynağı korundu.
- TypeScript, 152 çevrimdışı test ve whitespace kontrolü geçti. Canlı başarı
  yalnızca Türkiye/junior ilk sayfa içindir; global remote ve sayfalama mocked
  transportla doğrulanır. Ücretli model, profil/CV paylaşımı veya başvuru yoktur.

## Başvuru takibi ve temizleme — tamamlandı

- Kullanıcı yeni adayların çoğuna başvurduğunu belirtti; panelde kendisinin
  işaretlediği 11 submitted / 11 archived durumu esas alındı. Durumlar tahminle
  değiştirilmedi, aynı şirketin benzer başlıkları otomatik birleştirilmedi.
- Vazgeçilenleri kaldır işlemi archived kayıtlarına yerel trashedAt işareti koyar.
  Dosyalar kalıcı silinmez; Kaldırılanları geri getir düğmesiyle geri alınır.
  Ana liste, sayaçlar ve doğrudan ilan ayrıntısı gizlenen kayıtları göstermez.
  Kaynak/SerpAPI/FreeHire tekrar kontrolü gizlenen kayıtları da kapsar; bilinen
  aynı URL yeniden eklenmez. Farklı yayın ID'lerinin aynı iş olduğu varsayılmaz.
- Kullanıcı isteği gerçek panelde uygulandı: 11 archived kayıt kaldırıldı,
  11 submitted kaydın dosya içeriği aynen korundu. Kaldırılanların eski alanları
  aynı; yalnızca silme işareti ve eksik şema varsayılanları eklendi. SerpAPI
  ledger değişmedi; hiçbir arama/model/başvuru çağrısı yapılmadı.
- Başvurulanlar'da süreç aşaması (yanıt bekleme, İK, mülakat, test, teklif,
  olumsuz, kapanış), başvuru tarihi, sonraki takip tarihi ve yerel not var.
  Eski tarihler/aşamalar uydurulmaz; boş kayıtlar açıkça belirtilir.
  Takip tarihi başvuru tarihinden önce olamaz. Bilgiler yalnızca submitted
  kayıtlarında düzenlenir; başka duruma geçince korunur.
- Süreç aşaması ve bugün/geciken takip filtreleri eklendi. Takip zamanı gelen
  başvurular öne çıkar; olumsuz/kapanmış süreçler gecikmiş takip sayılmaz.
  Tarihler yerel takvime göre değerlendirilir. Tarih alanı otomatik e-posta,
  arka plan takibi veya bildirim üretmez; notlar modele/işverene gönderilmez.
- TypeScript, 155 çevrimdışı test ve whitespace kontrolü geçti. Geri alma ve
  yeniden başlatma, kaldırılan ilanların yeniden keşifle dönmemesi, tarih/not
  doğrulaması ve origin/session koruması kurgusal veriyle test edildi.
  Gerçek panelde 11 kayıt kaldırma, Başvurulanlar takibi ve aşama filtresi görüldü;
  gerçek başvurulara deneme notu veya tahmini tarih yazılmadı.

## Tekil ilan kaldırma — tamamlandı

- Her ilanın ayrıntısında, başlığın altındaki eylem satırında Listeden kaldır
  düğmesi var. Başvuru yapılmış ilanlar da tek tek kaldırılabilir; durum ve
  takip notları korunur. Kaldırma sonrası Geri al yalnızca o ilanı geri getirir.
  Önceki toplu kaldırma/geri getirme seçenekleri devam eder.
- Devam eden analiz veya form oturumu varken kaldırma/geri alma engellenir.
  Origin/session koruması ve kalıcı yeniden keşif tekrar kontrolü korunur.
- TypeScript ve 157 çevrimdışı test geçti. Tekil kaldırma/geri alma, yeniden
  başlatma ve başvuru notlarının korunması kurgusal veriyle doğrulandı.
  Gerçek başvuru kayıtları bu artımda değiştirilmedi.

## Geniş arama, olası tekrar grupları ve panelden belge hazırlığı — tamamlandı

- Yazılım + analiz + BT denetimi ortak rol grubu eklendi. BT denetimi için
  technology risk/assurance ve Türkçe karşılıkları yerel sözlüğe dahil edildi.
  Kullanıcının product/frontend/backend gibi özel rolleri korunur; bunlar da
  uygun kaynak kategori filtrelerine bağlanır. Bu, aday becerisi/uygunluğu iddiası değildir.
- FreeHire'da junior etiketi olmayan kayıtlar da ayrıca incelenebilir. Bu seçenek
  sağlayıcıdaki junior filtresini kaldırır; mevcut earlyCareer ve unvan/kelime/
  açık minimum deneyim filtreleri yerelde çalışır. Belirsiz seviye junior diye
  etiketlenmez. Kategori filtreleri sağlayıcının canlı facets yanıtıyla doğrulandı.
- FreeHire/SerpAPI/manuel kaynaklar için aynı bilinen şirket ve benzer unvanlı
  kayıtlar karşılaştırılabilir. İncelenecek kayıtlar isteğe bağlı açılır gruplarda
  görünür; hiçbir kayıt veya başvuru durumu birleştirilmez/silinmez. Bilinmeyen
  şirketler sadece aynı unvan nedeniyle gruplanmaz. Doğrulanmış farklı ülke
  eşleşmeleri aday ilişkisine alınmaz. Başvurulanlar takip kayıtları ayrı kalır.
- Doğrulanmış ilanlarda CV indir ve yerel ön yazı taslağını aç/indir düğmeleri var.
  Mevcut selectCV/renderCoverLetter ve PDF okuma denetimi kullanılır; yeni model,
  doküman üretim motoru veya paket eklenmedi. Taslak, şirket/pozisyon, kayıtlı
  onaylı aday anlatımı ve varsa analizde seçili dayanaklardan oluşur; yeni bir
  modelin ilan şartlarına göre yeniden yazdığı metin olarak sunulmaz.
- Belgeler sadece loopback + token/origin kontrollü uç noktadan alınır. Keyfi dosya
  yolu istemciden kabul edilmez; CV PDF/5 MB/O_NOFOLLOW kontrolünden geçer.
  Kaynaktan gelen ülke/dil/tam metin doğrulanmadan CV/ön yazı uçları da engellenir.
- Gerçek Türkiye geniş araması: kaynak toplam 501 bildirdi; ilk 30 kayıttan
  9 yeni review adayı, 2 bilinen, 19 filtre dışı. Toplam 501, uygun/açık iş sayısı
  değildir ve bütün sayfalar taranmadı. İlk 9 adayda yazılım ve iş analizi var;
  panel 7 olası grup gösterdi. Gruplar açılıp iki farklı kayıt görüldü.
- BT denetimi odaklı arama: 55 kayıt iki sayfada incelendi; 0 yeni, 1 bilinen,
  54 filtre dışı. Bu kaynak/filtre denemesi Türkiye'de uygun BT denetimi işi
  olmadığını kanıtlamaz. Ayrı kaynaklarda canlı arama henüz tamamlanmadı.
- SerpAPI yerel günlük sınırı UTC gününde dolu olduğundan yeni sorgu yapılmadı;
  ledger ve sınırlar değiştirilmedi. Bütçe/sağlayıcı kontrolü korunur.
- Gerçek panelde yerel ön yazı önizlemesi açıldı. Seçilmiş gerçek EN/fotoğraflı
  PDF, içerik değiştirilmeden yerelde okunabildi. İşverene yükleme/gönderim yok.
- TypeScript, 162 çevrimdışı test ve whitespace kontrolü geçti. Yeni testler
  etiketsiz seviyede yerel deneyim elemesini, kategori/rol kapsamını, şirket/ülke
  eşleştirmesini ve belge uçlarının kaynak doğrulama/erişim sınırlarını kapsar.
- Önceden var olan ilan dosyaları ve arama ledger hash'leri aynı. Kullanıcının
  son durumuyla 11 submitted, 9 review, 13 gizlenen kayıt var. Eski rol tercihleri
  korunup BT denetim/technology risk ifadeleri eklendi. Ücretli model/profil
  paylaşımı/gerçek başvuru gönderimi bu artımda yapılmadı.

## Kalite ve ürün tamamlama — önceki artım

Kullanıcı eski/boş ilanlar ve tamamlanmayan akış nedeniyle özellik genişletmek yerine
ürünün kullanılabilirliğini önceliklendirdi. Bundan sonraki kabul ölçütü test sayısı
veya toplayıcının toplam kayıt sayısı değil, gerçek kaynaktan doğrulanmış ilan ve
panel üzerinden tamamlanan hazırlık akışıdır.

20 Ekim düzeltmesi:
- FreeHire source/created_at/reality bilgileri artık atılmaz. İlk görülmesi/yayını
  30 günden eski, gelecekte tarihli veya fake_freshness işaretli yeni kayıtlar elenir.
  Şirketi/açıklaması eksik ve WhatJobs üzerinden dolaylı yeniden yazılmış kayıtlar
  ayrıca sayılır; yeni ana liste kaydı yapılmaz. Bu işaretler sağlayıcı beyanıdır,
  ilanın dolandırıcılık veya kesin kapalı olduğu kararı değildir.
- Bilgisi eksik eski kayıtlar silinmez. Kaynak kontrolü görünümü, doğrulanmamış ve
  kalite elemesine takılmış aktif kayıtları incelenebilir ilanlardan ayırır.
  İnsan doğrulaması, resmî API kontrolü ve yayın tarihi birbirinden ayrılır.
- Greenhouse/Lever için mevcut sabit resmî API okuyucusuyla tekil ilan varlığı
  kontrol edilir. Yeni FreeHire kayıtlarında en çok beş kontrol yapılır. Diğer
  sitelerde kontrol desteklenmiyorsa açık olduğu varsayılmaz. Sonuç 24 saat sonra
  yeniden kontrol ister; kısa önbellek/hata beklemesi var. Ağ hatası veya eksik
  parse kapandı diye yorumlanmaz; liste yokluğu kesin kapanış sayılmaz.
- Resmî içerik bulunursa yalnızca analizi/insan doğrulaması olmayan review kaydının
  metni ve başlığı güncellenebilir. Başvurular, analizler, takip notları ve gizleme
  durumları korunur. Kalite elemesini geçemeyen keşif kaydında ücretli analiz engellenir.
- Deneyim elemesi 3+ yıl ve 4–6 yıl gibi ifadeleri yakalar; tercih edilen şartları
  ve şirketin kendi geçmişini adaydan istenen deneyim diye değerlendirmez.
- Gerçek panelde FreeHire iki sayfa/60 kayıt incelendi: 14 bilinen, 36 filtre dışı,
  9 kalite nedeniyle alınmayan (1 eski/tarih çelişkisi, 8 dolaylı toplayıcı), 1 kaynak
  kontrolü gereken yeni kayıt. Sıfır yeni doğrulanmış fırsat çıktı. Kaynak toplamı
  500 idi; tümü taranmadı, uygun ilan sayısı değildir.
- Aynı üretim kaynak kontrolü koduyla Peak Backend New Grad ilanı resmî Lever
  akışında bulundu, 1866 karakter metin alındı; başvurulan kayıt değiştirilmedi.
  Bu kontrol sohbetin tarayıcı form doldurma başarısı değildir.
- Yerel ücretli çağrı ayarı kapalı olduğundan model etkin başlatma reddedildi;
  ayar aşılmadı. Panel 3211'de arama açık, model kapalı çalışır. Ücretli analiz,
  profil/CV paylaşımı veya başvuru gönderimi yapılmadı; SerpAPI sınırı değiştirilmedi.

Doğrulama: TypeScript ve 166 çevrimdışı test, tarayıcı JavaScript sözdizimi ve
whitespace kontrolü geçti. Yeni kontroller eski/tarih çelişkili içerik, eksik metin,
dolaylı kaynak, zorunlu/tercih deneyim ayrımı, sabit ATS adresleri, kaynak arızası,
resmî unvanın rol filtresine yeniden girmesi ve ücretli kalite kapısını sınar.
Canlı sonuçlar yukarıda ayrıca belirtilmiştir; test sayısı ürün tamamlandı kanıtı değildir.
Önceden var olan 33 ilan dosyasından yalnızca bir doğrulanmamış review kaydının
kaynak metadatası güncellendi. 11 başvurulan, 21 gizlenen kayıt ve SerpAPI ledger
byte olarak korundu. Yeni tek adayla toplam 34, görünür 13 kayıt vardır.

Açık kalan ürün engelleri:
1. Bu kaynaklarla henüz başvurulmamış, gerçekten güncel/uygun fırsat üretimi düşük.
   Kaliteyi düşürerek sayı artırmak veya eski kayıtları yeni diye sunmak çözüm değil.
2. Model analizi kapalı yapılandırmada kullanılamaz. Etkinleştirme ve her gerçek
   ücretli analiz ayrı kullanıcı kararıdır; çevrimdışı test canlı model kanıtı değildir.
3. Native Workday/LinkedIn Easy Apply/CV yükleme ve gerçek telefon doldurma doğrulaması
   tamamlanmadı. Genel yardımcı için gözetimli, bilinen alan sınırı korunur.
4. Hazırlık süresindeki kazanç henüz ölçülmedi; %80 hedefi başarı diye sunulmaz.

Yeni sağlayıcı, büyük UI değişikliği veya yeni otomasyon eklemeden bu engelleri
kapat; bir gerçek adayın kaynak → analiz → belge → desteklenen form devri → takip
akışını native panelde doğrulamadan ürünü tamamlandı olarak etiketleme.


## Finans araması ve birleşik hazırlık — aktif durum (20 Ekim 2026)

- Mevcut FreeHire, SerpAPI ve kayıtlı Greenhouse/Lever kaynakları tek kullanıcı
  tetiklemeli, durdurulabilir, 180 saniye sınırlı akışta birleştirildi. İlk FreeHire
  sayfası ve iki web sorgusu kullanılır; bütün internet/tüm şirketler taranmaz.
  Kaynak bazında sonuç/hata raporu kalıcıdır; kısmi başarı korunur. Yeni tarayıcı
  kazıyıcı, hesap bağlantısı, model arama çağrısı veya zamanlayıcı eklenmedi.
- Finans/muhasebe, bağımsız denetim ve pazarlama grupları, çift dilli rol eşleştirme
  ve finans belge odağı eklendi. Eski özel roller korunur. Her kayıt kendi keşif
  kriterini taşır; aktif grubun değişmesi geçmiş kaydın kriterini değiştirmez.
- Web aramasında son ay indeks filtresi var; gerçek yayın tarihi sayılmaz.
  Supervisor/head/chief kıdemli sayılır; tek başına associate junior kanıtı değil.
  Şirket yerine URL döndüren FreeHire kayıtları yeni alımda engellenir, eskiler
  silinmeden kalite bölümünde kalır. Bu son düzeltmelerden sonra yeni canlı arama
  yapılmadı; aşağıdaki rapor önceki aramanın tarihsel sonucudur.
- Gerçek yerel profilde altı CV (üç genel, üç finans) ve kaynaklı finans eğitim,
  Excel/SAP/Power BI beyanları bağlandı. Genel belgeler değiştirilmedi. Akademik
  SAP eğitimi profesyonel FI/CO deneyimi diye gösterilmez. Finans ön yazısı seçili
  gerçek profil dayanaklarından yerelde oluşur; insan tarafından onaylı sayılmaz.
- Native panelde finans/Türkiye araması: FreeHire 30 kayıt → 10 yeni / 18 filtre
  dışı / 2 kalite reddi; web 20 sonuç → 7 yeni / 13 filtre dışı; kayıtlı resmî
  kaynaklar 314 kayıt → 0 yeni / 292 filtre dışı / 22 desteklenmeyen-geçersiz.
  Toplam 17 yeni aday: 1 kaynakta doğrulanmış, 16 ek kaynak kontrolü gereken kayıt.
  Bunlar 17 uygun veya junior ilan değildir. Yerel SerpAPI kullanımı 6/8 günlük,
  190/200 aylık oldu; kota/ledger sıfırlanmadı.
- Trendyol Tax & Accounting Professionals - Fintech resmî Lever sayfası açıldı ve
  karşılaştırıldı. Başlık vergi/muhasebe, gövde Treasury Professional diyor;
  içerik farkı gizlenmedi. TR/İngilizce içerik yerelde doğrulandı. İngilizce
  fotoğraflı finans PDF native panelden indirildi ve kaynakla hash eşitliği
  doğrulandı. Yerel ön yazı görüntülendi. İşverene belge/iletişim aktarılmadı.
- Kullanıcı bu tek ilan için mesleki profil paylaşımı ve en çok 0,05 USD gerçek
  analiz izni verdi. Yapılandırılmış modelin fiyatı ve Responses/token-count
  desteği resmî OpenAI belgelerinden kontrol edildi. Model yalnızca süreç ortamında
  açıldı; .env değiştirilmedi. Native panel analizi başarıyla kaydetti: 54/100,
  2 doğrudan / 6 kısmi / 2 belgelenmeyen şart; gerçek hesaplanan maliyet
  0,006794 USD. POS/ödeme sistemi deneyimi belgelenmiyor. Puan işe alınma veya
  haricî ATS olasılığı değildir. Analizden sonra panel arama açık, model kapalı
  yeniden başlatıldı. Başka ücretli koşu yapılmadı.
- Doğrulanmış asıl işveren adresi mevcut form yardımcısına devredilebilir;
  paylaşım izni ayrı kalır. Trendyol'a gerçek form devri/alan doldurma/yükleme
  denenmedi; Workday/Easy Apply ve önceki canlı form engelleri sürer.

Doğrulama: TypeScript ve 170 çevrimdışı test, tarayıcı JavaScript sözdizimi ve
whitespace kontrolü geçti. Yeni senaryolar finans belge/dil/fotoğraf seçimi,
kısmi kaynak başarısı, iptal/çakışma, raporun yeniden açılışı, geçmiş kriterlerin
korunması ve doğrulanmış işverene devir için paylaşım kapısını kapsar.
Ürün tüm portallarda tamamlandı değildir; kaynak kalitesi ve junior fırsat üretimi
halen sınırdır. Sonraki kabul adımı uygun bir finans ilanının doğrulanması ve
ayrı hedef izniyle desteklenen form devrinin native panelden sınanmasıdır.


### İlk test sürümünün paketlenmesi (20 Ekim 2026)

Kullanıcı kullanım kılavuzu, GitHub'a test sürümü gönderimi ve analiz özelliğinin
hazır kalmasını istedi. `npm start` artık 3211 portunda arama ve model seçenekleriyle
başlatır; `npm run start:offline` aynı kayıtları bağlantısız açar. Yerel .env ücretli
özellik izni bu talep üzerine etkinleştirildi; Git'e girmez. Panel her analizde
iki açık izin ister; aylık 5 USD / analiz 0,05 USD sınırları korunur. Yeni ücretli
çağrı yapılmadı. Native panelde model hazır durumu ve iki kutusu boş analiz izin
ekranı doğrulandı. Bu servis terminal kapanınca durur; otomatik başlangıç eklenmedi.

`docs/KULLANIM_KILAVUZU.md` günlük başlangıç, ilk kurulum, kaynak kontrolü, arama,
analiz, belge ve başvuru takibi, özel yedekleme ve sorun gidermeyi anlatır.
README bu kılavuza ve günlük başlangıca yönlendirir. TypeScript ve 170 çevrimdışı
test yeniden geçti; JavaScript sözdizimi ve whitespace temiz. Kişisel profil/CV,
.env, harcama/arama ledger'ları ve kullanıcı .vscode ayarları gönderime dahil değil.
Test sürümü feature/broader-discovery dalında tutulur; main birleştirmesi ayrı.


### Portföy beta sunumu — aktif çalışma (20 Ekim 2026)

Son geliştirme PR #12 ile main'e birleştirildi; docs/public-beta-showcase dalı
bu main üzerinden açıldı. Ana README İngilizce, README.tr.md Türkçe olarak
bağlandı. Günlük kullanım kılavuzu ve arayüz Türkçe kalır; İngilizce arayüz varmış
gibi gösterilmez. Kurgusal demo kayıtlarıyla gerçek panel ekran görüntüsü alındı;
kişisel kayıtlar veya gerçek başvurular görüntüye girmez. Anahtar gerektirmeyen
demo kurulumu, özel profil başlangıcı, maliyet/gizlilik sınırları ve native
başvuru desteğindeki eksikler ana README'de açıkça belirtildi.

Fetch sonrasında yerelde erişilebilir tüm ref'lerin 349 benzersiz Git blob'u;
yerel OpenAI/SerpAPI anahtarları, adayın tam ad/e-posta/telefon eşleşmeleri ve
bazı yaygın credential kalıpları için tarandı; eşleşme çıkmadı. Bu sınırlı içerik
kontrolü tam sır/PII tarayıcısı değildir; commit yazar metadatası, uzak PR yorumları,
Actions log/artifact'ları, silinmiş-erişilemeyen ref'ler ve dönüştürülmüş bilgiler
kapsanmaz. Özel tarama çıktısı /tmp altında tutuldu, repoya eklenmedi.

Repo görünürlüğü değiştirilmedi; lisans/yeniden kullanım tercihi henüz yapılmadı.
Mevcut kodda üçüncü taraf proje atfı bulunmaması, köken/lisans incelemesinin
kanıtı değildir. Dışarıdan modül eklenmedi, eski Türkçe commit geçmişi yeniden
yazılmadı. Bu artım ürün mantığını veya özel .env/profil/ledger'ları değiştirmez.


### Beta yayın notları ve kullanım izni (20 Ekim 2026)

PR #13 main'e birleşti. Kullanıcı portföy sunumu istedi ve açık kaynak lisansı
vermemeyi açıkça seçti. docs/beta-publication-notes dalında package.json ve lock
kök metadatası UNLICENSED oldu; MIT/özel lisans eklenmedi. İngilizce/Türkçe README
aynı karara bağlandı. SECURITY.md gizli veri içermeyen hata bildirimi ve yerel
kullanım sınırlarını; docs/PUBLICATION.md görünürlük öncesi kontrol kapsamını
anlatır. Uygulama kodu, .env, özel kayıtlar ve eski commit'ler değiştirilmedi.

GitHub API'den salt okunur kontrol: private repo; 13 issue/PR gövdesi, 0 issue
comment, 0 review comment, 0 commit comment ve 0 review. Yerel API anahtarları,
iletişim e-posta/telefon değerleri ve seçili credential kalıplarında eşleşme yok.
Actions koşusu/artifact, release/asset ve tanınan gövde ek bağlantısı bulunmadı.
Bu anlık ve sınırlı taramadır; tam PII/credential güvenlik garantisi değildir.
Commit metadata kontrolünde 3 benzersiz e-posta: 1 GitHub noreply, 2 noreply
olmayan adres var. Aday profil e-postası bunlardan biri değil. Adresler rapora
kopyalanmadı; public olursa commit metadatası da görünür. Geçmiş yeniden yazılmadı.
Gelecek commit'lerde noreply tercihi kullanıcı kararıdır.

Doküman bağlantıları, paket/lock lisans tutarlılığı ve whitespace kontrolü geçti.
Ürün mantığı değişmediği için 170 test tabanı yeniden koşturulmadı. Görünürlük
private kaldı. Repo public yapma kararı ve commit e-posta görünürlüğünün kabulü
ayrı kullanıcı adımıdır; açık kaynak lisansı vermemek kopyaları teknik olarak
engellemez. Üçüncü taraf köken/lisansları için tam denetim iddiası yoktur.


## Beta v0.1.0-beta.1 — sürüm kapanışı (20 Ekim 2026)

Önceki portföy/gizlilik kontrol notları tarihsel kayıttır. Son durum: kişisel Git
yazar/committer e-postası temizlendi; 56 eski commit'in dosya ağaçları birebir aynı
kaldı. 15 uzak dal ve 34 yerel/uzak izleme ref'i temiz geçmişe geçirildi; 104 özel
dosyanın hash'i korundu. Yeni commit'ler GitHub noreply kullanır. Özel geri dönüş
yedeği .careerpilot/backups altındadır; Git'e/yayın eklerine girmez. GitHub'ın 13
eski PR referansı önceki commit'leri tutmaya devam ediyor; kullanıcı destek
başvurusunu gönderdiğini bildirdi. Repo private kalır, tam silinme iddiası yoktur.

Kullanıcı beta PR/merge işlerinin tamamlanıp sürümün kapatılmasını istedi.
Kontrolde açık PR yoktu; henüz main'e girmemiş yayın notları ile sürüm metadatası
tek release PR'ında birleştirilmek üzere hazırlandı. Paket/lock sürümü
0.1.0-beta.1; CHANGELOG beta kapsamını ve eksikleri sabitler. Uygulama mantığı
bu kapanışta değiştirilmedi. README İngilizce, Türkçe karşılığı ve kullanım
kılavuzu korunur; açık kaynak lisansı eklenmedi.

Bu baseline özellik geliştirmeye devam etme taahhüdü değildir. Kullanıcı gerçek
ilanlarla mevcut sürümü kullanır; sonraki çalışma somut kullanım hatalarına
odaklanır. Yeni sağlayıcı, tarayıcı kazıyıcı veya ücretli koşu eklenmedi.

Kapanış doğrulaması: TypeScript ve 170 çevrimdışı test yeniden geçti; whitespace
kontrolü temiz. Ücretli model/arama veya gerçek başvuru gönderimi yapılmadı.

### Tek tıkla arama — 1. adım
Mac başlatıcısı ve yerel panelde hızlı arama ekranı eklendi. Dört rol, şehir,
çalışma biçimi ve başlangıç seviyesi tercihleri düzenlenebilir. Anahtarsız
FreeHire Türkiye sorgusu mevcut okuyucuyu kullanır. Sonraki keşif genişlemesi
kullanıcı bu sürümü deneyene kadar bekler.

Kullanıcı denemesi sonrası hızlı aramada altı açık işveren listesi, FreeHire devam
sayfaları, kaynak raporu ve junior/deneyimi belirsiz sonuç grupları eklendi.

### İlan kartından başvuru taslağı
Hızlı aramadan tam panele ilan metni aktarımı, mevcut profil dayanaklarından
düzenlenebilir CV ve ön yazı taslakları, ayrı alıcı onayı ile form yardımına
geçiş ve Lever başvuru formunu doğrudan açma eklendi. Mac Panel başlatıcısı
kullanıcının seçtiği proje klasöründen mevcut paneli çalıştırır.
