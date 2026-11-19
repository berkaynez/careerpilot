# CareerPilot — ilk test sürümü kullanım kılavuzu

## Her gün nasıl açarım?

Mac’te **CareerPilot.app** dosyasına çift tıkla. İlk açılışta kendi proje klasörünü seç. **İlan ara** ile arama yapabilir, sonucun üzerinden PDF belgelerini hazırlayabilirsin.

### Terminalden açmak isteyenler için

VS Code'da CareerPilot klasörünü aç → Terminal → New Terminal.
Terminal proje klasöründe değilse `cd <proje-klasörünün-yolu>` ile geç.
Ardından:

```sh
npm start
```

Tarayıcıdan **http://127.0.0.1:3211/** adresini aç.
Terminal açık kaldığı sürece panel çalışır. Terminali kapatırsan, `Ctrl+C`
yaparsan veya bilgisayarı kapatırsan panel durur. Tekrar `npm start` ile açılır.
Otomatik başlatılan bir servis değildir; sohbetin açık olması gerekmez.

Başlatmak ücretli analiz veya ilan araması çalıştırmaz. Analiz düğmesi hazır
olur; her analizde maliyet/profil paylaşımı onayını sen verirsin.
Aynı anda ikinci panel başlatma; port kullanımda mesajı görürsen mevcut
terminali ve tarayıcı adresini kontrol et.

Model ve arama bağlantıları olmadan yalnızca yerel kayıtlar için:

```sh
npm run start:offline
```

Bu modda mevcut analizleri ve başvuru takibini görebilirsin; yeni AI analizi ve
SerpAPI araması kapalıdır. Ücretsiz şirket kaynakları ve FreeHire kullanılabilir. Her iki komut aynı yerel kayıtları kullanır.

## İlk kurulum veya başka bilgisayar

Node.js 22 veya üzeri kurulu olmalı. Proje klasöründe:

```sh
npm ci
npm run browser:install
```

`.env.example` dosyasını `.env` adıyla kopyala; mevcut `.env` dosyanın üzerine
yazma. Gerçek kullanım için özel `.careerpilot/profile.json` ve CV dosyaları da
yerelde bulunmalı. GitHub'dan kodu indirmek kişisel kayıtlarını geri getirmez.
Özel profil şeması ve örnekler için [teknik referansa](USAGE.md#local-hub-dashboard) bak.

`.env` içinde API anahtarı, seçilen model ve doğrulanmış fiyat bilgileri gerekir.
Analiz için `CAREERPILOT_ENABLE_PAID_CALLS=true` olmalıdır. `.env.example` güvenli
başlangıç için false bırakılır; her kullanıcının kendi izni gerekir.
SerpAPI anahtarı yalnızca web araması içindir; FreeHire anahtar istemez.
Anahtarı sohbete, ekran görüntüsüne veya Git'e koyma.

## İlan bulma

1. **İlan keşfet** ekranını aç.
2. Rol grubunu seç: yazılım/veri, BT denetimi, finansal analiz veya pazarlama.
   Kendi rollerin de saklanır; finans araması eski yazılım kayıtlarını silmez.
3. Türkiye veya global remote seçimini, seviye tercihlerini kontrol et.
4. Finans başvurularında **Finans / işletme** belge türünü seç.
5. Kriter paylaşımı ve ücretsiz kota kutusunu okuyup onayla;
   **Mevcut kaynaklarda birlikte tara** düğmesine bas.
6. Kaynak raporundaki yeni, elenen, bilinen ve kontrol bekleyen sayılarını incele.

Bu akış ilk FreeHire sayfası, iki web sorgusu ve kayıtlı Greenhouse/Lever
şirket akışlarını işler. Tüm iş siteleri/tüm sayfalar taranmaz. Web araması son
ay indeks filtresi kullanır; bu yayın tarihi kanıtı değildir. Kota dolunca
bekler veya ilgili kaynağı atlar; ücretsiz plan koruması ücretliye geçmez.
Durdur düğmesi tamamlanan kayıtları korur. Yeniden arama bilinen URL/ID'leri
tekrar eklemez; farklı bağlantılardaki aynı iş için kesin tekrar garantisi yoktur.

## Kaydı inceleme ve analiz

**Kaynak kontrolü** gereken bir kayıt uygun/açık ilan sayılmaz.
İlanı asıl işveren sayfasında aç; unvanı, ülkeyi, dili, açıklamayı ve seviyeyi
kontrol et. Desteklenen Greenhouse/Lever kaydında **Resmî kaynaktan kontrol et**
kullanılabilir. Başka sitelerde insan kontrolü gerekir. Kontrolün geçerliliği
24 saattir; işe uygunluk veya yayın tarihi kanıtı değildir.

İlanın bilgilerini doğruladıktan sonra **Uyumunu analiz et** düğmesine bas.
Modeli, sağlayıcıyı ve bütçe sınırını gör; iki onay kutusunu inceleyerek analizi
başlat. Mesleki profil bilgileri ve ilan metni modele gider; iletişim bilgileri
ve CV dosyası gönderilmez. Bu izin yalnızca o analiz içindir.

0–100 puan profildeki dayanakların ilan şartlarını karşılama ölçüsüdür;
işe alınma olasılığı veya haricî ATS puanı değildir. Eksik dayanak becerinin
sende olmadığı anlamına gelmez. Analiz sonucunu ve kısmi eşleşmeleri oku.

Harcama koşu ve aylık bütçeyle sınırlanır. Bütçe/kota/sağlayıcı hatasında
engeli kaldırmak için harcama kayıtlarını silme. Faturalaması belirsiz isteğin
rezervi korunur; yeniden analiz ayrı maliyet doğurabilir. Kullanıcıya özel
sınırlar panelin analiz onayında görünür; limitler `.env` içindedir.

## CV, ön yazı ve başvuru

İlan ayrıntısındaki belge türünü kontrol et. Finans odağı ayrı finans CV'lerini
kullanır. Dil ve fotoğraf seçimi ilan talimatı/profil politikasına göredir;
seçilen dosyayı indirmeden önce kontrol et. **Ön yazı taslağını aç** ile metni
oku, gerekirse düzenleyip indir. Belge indirme/önizleme yeni model çağrısı yapmaz.
Finans taslağı kayıtlı gerçek bilgilerden hazırlanır; gönderilmeden önce okunmalıdır.

Desteklenen adreste **Form yardımcısını aç** hedefe özel iletişim paylaşımı onayı
ister. Giriş, CAPTCHA, belirsiz sorular, CV yükleme, hukuki onay ve son gönderim
sende kalır. Bilinen boş alanlar için yardımcı kullanılır; dolu alanlar ve sonuç
kontrol edilmelidir. Workday, Greenhouse yükleme ve LinkedIn Easy Apply için
ürün üzerinden doğrulanmış uçtan uca destek yoktur. Her site otomatik çalışmaz.

## Başvuruları takip etme

Başvuruyu gerçekten gönderdikten sonra kaydı **Başvuruldu** olarak işaretle.
**Başvurulanlar** bölümünden aşama, gerçek başvuru tarihi, takip tarihi ve not
kaydet. Takip tarihi otomatik e-posta veya bildirim göndermez.
**Listeden kaldır** kaydı gizler; geri getirebilirsin. Başvuruyu işverenden
çekmez. Gizli kayıtların aramada tekrar oluşmaması için dosyalarını silme.

## Kapanınca kayıtlar ne olur?

`.careerpilot/` ilanları, takip notlarını, bütçe/arama kayıtlarını ve özel profili
saklar. `.env` anahtarları ve ayarları tutar. Bunlar GitHub'a gönderilmez.
Kişisel CV dosyaların da özel konumlarında kalır. Bu dosyaları ve profilin
referans verdiği CV'leri özel bir yedeğe al; Git'e ekleme. İlan geçmişini veya
harcama kayıtlarını sıfırlamak için klasörü silme.

## Sorun giderme

- **Sayfa açılmıyor:** proje klasöründe `npm start` çalışıyor mu kontrol et;
  tarayıcıdaki adres `http://127.0.0.1:3211/` olmalı.
- **Port kullanımda:** başka CareerPilot terminali açıktır. Önce onu kontrol et;
  gerekirse o terminalde `Ctrl+C` ile kapatıp yeniden başlat.
- **Panel açılamadı / yapılandırma hatası:** `.env`, profil dosyası ve yerel CV
  yollarını kontrol et. Mevcut dosyaların üzerine örnek dosya kopyalama.
- **Analiz kapalı:** `npm start` kullan; `start:offline` model açmaz. Yerel izin,
  anahtar, model ve doğrulanmış fiyat ayarları da gerekir.
- **Arama az sonuç verdi:** kaynak kapsamı, kıdem/coğrafya filtreleri ve kalite
  elemesi sonucu azaltabilir. Rapordaki nedeni incele. Kotaları sıfırlama.
- **CAPTCHA veya giriş çıktı:** tarayıcıda kendin tamamla. Engeller otomatik aşılmaz.

Bu ilk test sürümüdür. Yerel panel, keşif, analiz, belgeler ve takip çalışır;
tüm siteler için tamamlanmış başvuru robotu değildir. Geliştirici kontrolleri:
`npm run check` ve `git diff --check`.

### Mac’te ilan ara ve belgeleri indir

**CareerPilot.app** dosyasına çift tıkla. İlk açılışta mevcut CareerPilot proje klasörünü seç. Başarılı açılıştan sonra uygulama bu klasörü hatırlar. Kayıtlı ilanlar **İlanlarım**, arama sonuçları **İlan ara** bölümündedir. İki bölüm arasında geçiş yaparken sonuçlar aynı sekmede kalır.

Başlatıcı ücretsiz aramayı açar. Rol ve çalışma biçimi tercihlerini değiştirdiğinde **Ücretsiz ilan ara** ile yeniden tara. **Diğer roller** altında finansal analiz ve bağımsız denetim de seçilebilir. Muhasebe başlıkları elenir. **Taranan kaynaklar** her şirketin ilan sistemini, incelenen kayıt ve eşleşme sayısını gösterir. FreeHire sayfaları arasında en az 30 saniye beklenir. Bir kaynağın yanıt vermemesi raporda belirtilir.

Sonuçta **Başvuru belgelerini hazırla** düğmesine bas. İlanın dilini ve belge türünü kontrol edip kaydet. Finansal analist ve bağımsız denetim ilanlarında finans seçili gelir. **Kayıtlı finans CV’sini indir (PDF)** profilindeki uygun dosyayı orijinal adıyla indirir. Uygun dosya bulunamazsa panel sebebini gösterir. İlanla ilgili profil bilgilerini seçerek CV ve ön yazı taslaklarını da düzenleyip PDF olarak indirebilirsin.

Form yardımcısı desteklenen sitelerde paylaşım onayından sonra bilinen alanları doldurur. Dosya yükleme ve son gönderim sende kalır. Başlatıcı yerel modda açılır. İsteğe bağlı model analizi için paneli kapatıp model seçeneğiyle açma komutu üstte açıklanmıştır.

Mac paketi için Node 22+ ile proje bağımlılıklarını kurup `scripts/build-mac-app.sh /istenen/çıktı` komutunu çalıştır.
