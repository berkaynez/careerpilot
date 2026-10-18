# CareerPilot — Hybrid Job Application Hub

Onaylanan yön: 18 Ekim 2026. Bu belge mimari hedefi tanımlar; uygulanmış özelliklerin
ve aktif işin kaydı [proje durumundadır](PROJECT_STATUS.md).

## Kullanıcıya sunulacak akış

1. **İlan ekle:** bağlantı veya ilan metni. Site okunamıyorsa metin yapıştırılır;
   giriş/CAPTCHA ile mücadele eden arka plan robotları kurulmaz.
2. **Analizi incele:** şirket, rol, gerçek konum, gereksinimler, profilindeki
   dayanaklar, güçlü yönler, eksikler ve açıklanabilir 0–100 uyum puanı.
3. **Hazırlan:** seçilen CV ve cevapları gör; başvuru adresini ve paylaşılacak
   bilgileri onaylayarak mevcut form yardımcısını aç.
4. **Birlikte tamamla:** yardımcı bilinen alanları doldurur; hesap, CAPTCHA,
   belirsiz sorular, hukuki onaylar ve son gönderim kullanıcıda kalır.
5. **Takip et:** kaydedildi / analiz hazır / hazırlanıyor / inceleme gerekiyor /
   başvuruldu / vazgeçildi. Kullanıcı gönderdiğini işaretleyebilir; bu durum
   işverenden alınmış doğrulama gibi sunulmaz. Gözlenen başarı ayrıca kaydedilir.

Hedef hazırlık süresini %80 azaltmaktır. Aynı tür görevlerde manuel ve destekli
süreler ölçülmeden bu hedefe ulaşıldığı iddia edilmez. Bekleme ve kullanıcının
müdahale süresi de hesaba katılır; yalnızca kodun çalışma süresi ölçülmez.

## İlk sürümün teknik seçimi

Tek yerel Node.js/TypeScript uygulaması: mevcut CLI modüllerini çağıran küçük
bir HTTP sunucusu ve yerelden sunulan HTML/CSS/JavaScript paneli. İlk sürüm için
Next.js, ayrı backend, bulut veritabanı, mesaj kuyruğu veya genel plugin sistemi
kurulmaz. Görsel tasarım sade ve modern olur; dış CDN zorunluluğu yoktur.
React'e ancak ekran karmaşıklığı bunu gerektirirse geçilir.

İşler UUID ile özel `.careerpilot/` dizininde saklanır. Mevcut hazırlık paketleri
kullanılır; küçük bir sürümlü kayıt analiz, durum ve kaynak bağlantısını tutar.
İlk sürüm tek kullanıcı ve tek süreç içindir; aynı kayda yazma sıralanır,
dosyalar geçici dosyadan atomik değiştirilir. Yeni ORM/depo katmanı kurulmaz.

## Mevcut kodu nasıl kullanacağız?

- `src/jobs`: desteklenen bağlantıların normalleştirilmesi ve açık ilan okuma.
  Okunamayan ya da desteklenmeyen bağlantılarda metin girişi sunulur.
- `src/preparation/posting.ts`: ilandan alıntılanmış gereksinim çıkarma ve model
  kararını doğrulama. İlan metni talimat değil, veridir.
- `src/preparation/core.ts`: mevcut aday bilgileriyle gereksinim eşleme,
  bilgi referansları, CV seçimi, paylaşım onayı ve bütçeli model çağrısı.
- Yeni küçük bir skor fonksiyonu: doğrulanmış eşleştirmeden puan ve açıklama
  çıkarır. Ayrı model sağlayıcısı veya ikinci paralel analiz motoru kurulmaz.
- Yeni küçük yerel sunucu/panel: bu işlevleri doğrudan çağırır. API sadece
  somut kullanıcı işlemlerini sunar; genel uzaktan komut çalıştırma arayüzü olmaz.
- `src/applications`: panelden açılan gözetimli form oturumunun alan doldurması.
  Önce mevcut destek korunur; gerektiğinde terminal komutları yerine yerel panelde
  doldur / devam et / devral eylemleri bağlanır.
- `src/lever`: onaylı CV yüklemesi ve insan devri için mevcut uygulama örneği.
  Genel CV yükleme desteği uygulanana kadar panel manuel yüklemeyi açıkça gösterir.
- `src/browser`, `src/validation`, `src/privacy`, `src/policy` ve bütçe modülleri:
  mevcut korumalar korunur. Yerel deneyin ağ kısıtları doğrudan gerçek sitelere
  kopyalanmaz; gerçek site asistanının mevcut koruma/devretme modeli kullanılır.

CLI ve panel aynı işlevleri kullanır. İki ayrı profil, iki analiz motoru veya
birbirinden kopuk skor hesaplaması oluşturulmaz.

## Uyum puanı ve açıklama sözleşmesi

Puanı modelden serbestçe istemek yerine model gereksinimleri profil dayanaklarıyla
eşler; kod bu doğrulanmış sonucu puana çevirir. İlk açık hesaplama politikası:

- Temel gereksinimin ağırlığı 3, tercih edilenin ağırlığı 1.
- İlgili doğrudan dayanak: 1; kısmi/ilişkili dayanak: 0,5; belgelenmeyen: 0.
- Puan: `100 × toplam(ağırlık × dayanak) / toplam(ağırlık)`, en yakın tam sayıya.
- Görev tanımları raporda gösterilir, ilk sürümde puan paydasına katılmaz.
- Puanlanabilir gereksinim yoksa veya analiz başarısızsa puan boş kalır; sahte 0
  ya da varsayılan 50 üretilmez. Başarısızlık ve yeniden deneme maliyeti görünür olur.

Bu ağırlıklar ürün politikasıdır; bilimsel olarak kalibre edilmiş bir tahmin değildir.
Her sonuçta formül sürümü ve gereksinim bazlı katkılar gösterilir. Eksik bilgi
adayın o beceriye sahip olmadığının kanıtı olarak sunulmaz. Modelin gereksinim
atlaması veya yanlış eşlemesi insan incelemesinde düzeltilebilir; puan yeniden hesaplanır.

Çalışma hakkı, konum, sponsorluk ve temel başvuru engelleri puandan ayrı gösterilir.
Yüksek puan çalışma hakkı varmış veya sponsor bulunmuş gibi yorumlanmaz.
Arayüz puanı işe alınma olasılığı, dış ATS puanı veya işe uygunluğun kesin kanıtı
olarak adlandırmaz. Henüz doğrulanmamış analiz tamamlanmış gibi gösterilmez.

## Panelin ilk ekranları

- **İlan listesi:** şirket/rol, konum, durum, varsa puan; ilan/metin ekleme ve filtreleme.
- **İlan ayrıntısı:** kaynak metni, gereksinim–profil dayanakları, eksikler,
  çalışma hakkı uyarıları, CV seçimi, analiz kaynağı ve maliyet.
- **Hazırlık alanı:** mevcut tarayıcı oturumunun durumu, doldurulabilen alanlar,
  kullanıcıya kalan sorular, CV yükleme durumu ve kontrolü devralma.

İlk panel kurgusal verilerle kullanılabilir. Model çağrısı ancak açık bir analiz
isteği, ücret/mesleki profil paylaşımı onayı ve mevcut bütçe kontrolüyle başlar.
Aynı sayfayı açmak veya yenilemek yeniden ücretli çağrı başlatmaz.

## Yerel güvenlik ve veri sınırları

Sunucu yalnızca loopback adresine bağlanır. Değişiklik yapan isteklerde Origin/Host
ve oturum belirteci kontrol edilir; CORS herkese açılmaz. Kullanıcı/ilan metni
HTML olarak çalıştırılmaz. URL okuma mevcut destekli okuyucularla sınırlıdır;
panel keyfi URL proxy'si veya bilgisayarda keyfi dosya okuma aracı olmaz.
CV seçimi kayıtlı belge kimliğiyle yapılır; web isteğiyle serbest dosya yolu alınmaz.
API anahtarları, çerezler ve şifreler panele veya kayıtlara dökülmez.

Her gerçek paylaşım/CV yükleme için hedef ve veri açık olur. CAPTCHA çözme,
şifre yönetimi, hukuki onay ve son gönderim otomatikleştirilmez. Yeni bir
siteyi desteklemek mümkün olmadığında kullanıcı normal tarayıcı akışıyla devam eder;
bu durum ürünün tümünü bloke etmez ve otomatik başarı sayılmaz.

## Teslim sırası ve kabul ölçütleri

1. **Eski dalı kapat:** mevcut değişiklikleri gözden geçir, test et, commit et,
   GitHub erişimi varsa PR üzerinden birleştir. Başarısız erişimi birleşti diye yazma.
2. **Analiz:** mevcut gereksinim/plan yapısına açıklanabilir skor ekle. Aynı girdi
   aynı puanı üretmeli; eksik ve çelişkili bilgi görünmeli. Testler kurgusal/model taklitlidir.
3. **Yerel panel:** ilan ekleme, liste/ayrıntı, analiz sonucu ve durum güncelleme.
   Yeniden açıldığında kayıt korunmalı; boş/hata/yükleniyor durumları anlaşılır olmalı.
4. **Form bağlantısı:** panelden mevcut asistanı başlat, bilinen alanları doldur,
   CV için desteklenen yükleme veya açık manuel adım sun, belirsizlikte kullanıcıya bırak.
5. **Gerçek pilot:** uygun bir ilanda paylaşım onaylarıyla uçtan uca hazırlığı doğrula,
   kullanıcı son gönderimi yapsın; süre ve kalan elle yapılan işleri kaydet.

Her teslim mevcut testleri korur. Test sayısını artırmak yerine sonucu, hata
hallerini ve kullanıcı devrini doğrulayan kontroller eklenir. Önceki CLI pilotu
panel planını süresiz durduran ön koşul olmaktan çıkarılmıştır; gerçek pilot bu
hibrit akışın kabul testi olur.

## MVP dışında

Gözetimsiz yüzlerce başvuru, sürekli ilan tarama, CAPTCHA/anti-bot aşma, e-posta
entegrasyonu, çoklu agent ordusu, yeni model sağlayıcıları ve her siteye özel
üyelik/başvuru adaptörleri. CV/ön yazı tasarımını baştan yapmak ayrı iştir.
