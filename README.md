# CareerPilot

CareerPilot, **Yarı-Otonom İş Başvuru Komuta Merkezi** (Hybrid Job Application Hub)
olarak geliştiriliyor: ilanları ve AI analizini tek yerde görmek, doğru belgeleri
hazırlamak ve form doldurmayı insan gözetiminde hızlandırmak.

Bugünkü sürüm yerelde çalışan bir prototiptir. İlan–profil analizinden açıklanabilir
0–100 uyum puanı hesaplanır. Yerel panelde ilan ekleme, analiz görüntüleme ve
başvuru takibi vardır. “İlan keşfet” ile eklenen şirketlerin resmî Greenhouse/Lever
ilanları ücretsiz filtrelenip inceleme listesine aktarılır. İlk sürüm düğmeyle
çalışır; arka planda zamanlanmış tarama yoktur. Panelden form yardımı açılır, bilinen alanlar hazırlanır
ve kontrol kullanıcıya bırakılır.

## Nereden devam ediyoruz?

[Güncel durum ve yol haritası](docs/PROJECT_STATUS.md) projenin tek güncel iş listesidir.
[Teknik kullanım referansı](docs/USAGE.md) komutların ve altyapının ayrıntılarını içerir.
[Hibrit mimari](docs/HYBRID_ARCHITECTURE.md) hedeflenen kullanıcı akışını ve teknik sınırları,
[AGENTS.md](AGENTS.md) geliştirme kurallarını belirler.

Hedef akış: **ilan ekle → dayanaklı uyum analizini incele → formu hazırla →
kendin kontrol edip gönder → durumunu takip et.** Öncelik Türkiye'deki uygun
başvurular; uluslararası başvurularda konum ve çalışma hakkı ayrıca doğrulanır.

## Yerel panel

```sh
npm run hub -- --demo
```

Kurgusal örneklerle paneli `http://127.0.0.1:3210` adresinde açar. Gerçek profil
kullanılmaz, ücretli çağrı yapılamaz. “Örnek formu aç” yalnızca bilgisayardaki
kurgusal forma gider. İlan ekleme, arama/filtreleme, analiz ayrıntıları, form yardımı
ve durum takibi çalışır; kayıtlar yeniden açıldığında korunur.

Özel profilinle kullanmak için `npm run hub` çalıştır. Panel varsayılan olarak
model çağrısı yapmaz; mevcut hazırlık paketlerinden `job.json` ve
`preparation.json` dosyalarını içe aktarabilir. Model analizini etkinleştirme,
özel profil ve kayıt dizinleri [kullanım referansında](docs/USAGE.md#local-hub-dashboard) açıklanır.

## Şu an neler var?

- `hub`: yerel ilan listesi, analiz ayrıntıları, form yardımı ve kullanıcı beyanına dayalı durum takibi.
- `job`: desteklenen bir ilan bağlantısından yerel hazırlık paketi oluşturur.
  İlan okuyamamak, giriş/CAPTCHA veya belirsiz işveren bağlantısı akışı durdurabilir.
- `assist`: kullanıcının açtığı başvuru sayfasındaki bilinen boş alanları doldurur.
  Kullanıcı giriş yapar, adımları ilerletir ve sonucu kontrol eder. Ücretli model kullanmaz.
- `lever:review`: ayrı onaylarla Lever formunu ve CV yüklemesini hazırlayıp kullanıcıya bırakır.
- `prepare`: sağlanan ilan, profil ve doğrulanmış değerlendirmeden açıklanabilir
  uyum puanı, gereksinim bazlı dayanaklar ve yerel CV/ön yazı paketi hazırlar.
- `agent`: yalnızca yerel kurgusal formlarda modelin karar verdiği deneysel akıştır.
  Etkinleştirilirse ücretli API kullanabilir; gerçek iş sitelerinin otomasyonu değildir.

LinkedIn/Indeed/Kariyer.net bağlantısını tanımak, o sitenin bütün başvuru
akışını desteklemek anlamına gelmez. **Workday ve LinkedIn Easy Apply için
program üzerinden doğrulanmış uçtan uca destek yoktur.** Sohbette tarayıcıyla
hazırlanan başvurular ayrıca değerlendirilir.

## Kurulum ve kontrol

Node.js 22 veya üzeri gerekir.

```sh
npm ci
npm run browser:install
npm run check
```

Bağımlılıklar kurulduktan sonra testler kurgusal verilerle çevrimdışı çalışır;
API anahtarı veya ücretli model çağrısı gerekmez.

## Kullanımın ana yolu

```sh
npm run job -- "<desteklenen-ilan-bağlantısı>" --country TR --language tr
npm run assist -- "<desteklenen-ilan-bağlantısı>" --approve-contact-sharing
```

Gerçek kullanım için önce özel yerel profil hazırlanmış olmalıdır. Ülke ve dil
örnektir; gerçek ilandan doğrulanır. Ortak yardımcıda `DOLDUR` alanları hazırlar,
`DEVAM` kullanıcının sitede ilerlemesini sağlar, `DEVRET` kontrolü bırakır.
Bu iki komut henüz tek bir kesintisiz uygulama değildir.

Şifre, CAPTCHA, CV yüklemesi, özel listeler, hukuki onaylar ve son gönderim
ortak yardımcıda kullanıcıya aittir. İşverenin başka bir sitesine geçildiğinde
yeni adres ayrıca desteklenmeli ve paylaşım izni verilmelidir. Ayrıntılar için
[kullanım referansına](docs/USAGE.md#indeed--kariyernet-and-the-shared-visible-form-assistant) bak.

Gerçek profiller ve belgeler `.careerpilot/` gibi Git dışında tutulan özel dizinde
kalır. `.env` ve API anahtarları paylaşılmaz. Bu proje, kullanıcı onayı olmadan
ücretli çağrı veya gerçek başvuru gönderimi yapmaz.
