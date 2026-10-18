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
0–100 uyum puanı ve dayanak raporu mevcut hazırlık akışına eklendi.
Yerel panelde ilan kaydı, analiz görüntüleme ve durum takibi eklendi.
Panelden form asistanı başlatma henüz uygulanmadı.

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
Bu commit henüz ayrıca main'e birleştirilmedi; aşağıdaki panel dalı onu da içerir.
Skor gerçek işe alınma/ATS tahmini değil, değerlendirilmiş gereksinimlerdeki dayanak kapsamıdır.

## Tek aktif iş: yerel panel

Çalışma dalı: `feature/local-hub`, `feature/explainable-match-score` üzerinden açıldı.
Eski skor dalı için ayrıca PR açılmadıysa skor + panel aynı PR'de main'e incelenebilir.

- [x] Yeni bağımlılık eklemeden Node/TypeScript + yerel HTML/CSS/JavaScript paneli.
- [x] İlan metni, şirket/rol, kaynak URL, ülke ve dil kaydı; arama ve durum filtreleri.
- [x] Mevcut profil/analiz/skor kodunu kullanan ayrıntı ekranı ve kanıt bazlı gereksinimler.
- [x] Özel kayıtlar, atomik yazma ve yeniden açıldığında kalıcılık.
- [x] Önceki hazırlık paketinden ücretsiz analiz içe aktarma; mevcut profil ile yeniden doğrulama.
- [x] Gerçek/örnek dizinlerini ayıran, model çağrısına izin vermeyen kurgusal demo.
- [x] Model varsayılan kapalı; etkinleştirilirse her analizde iki ayrı onay ve mevcut bütçe kontrolü.
- [x] Yenilemede çağrı yapmama, çift analizi engelleme, hata kodu ve başarılı çağrı maliyeti kaydı.
- [x] Başvuruldu durumunun kullanıcı beyanı olduğunu ve CV'nin yüklenmediğini açık gösterme.
- [x] Tarayıcı: ekleme, arama, filtre, durum değiştirme, yeniden yükleme, içe aktarma, masaüstü/dar görünüm.
- [x] TypeScript, 116 çevrimdışı test, arayüz JavaScript sözdizimi ve whitespace kontrolü geçti.

Bu teslim panelden form asistanını başlatmaz, CV yüklemez veya gerçek başvuru
olasılığını test etmez. UI model sonuçlarını taklit ederek canlı kalite kanıtı
oluşturmaz. Doğrulama kurgusal aday/ilanlarla yapıldı; ücretli model çağrısı yok.
Kullanıcıya ait `.vscode/` dosyaları korunur ve commit'e eklenmez.

## Sonraki teslimler

1. **Form asistanı bağlantısı:** mevcut doldur/devam/devral akışını panelden erişilir
   yap; onaylı CV yüklemesini desteklenen yerde kullan, diğer yerde kullanıcıya bırak.
2. **Gerçek pilot ve ölçüm:** programın hibrit akışıyla bir hazırlığı doğrula;
   gerçek/manuel/taklit işlemleri ayır, toplam süreyi ve kalan manuel adımları kaydet.

Ayrıntılı kabul ölçütleri mimari belgede. Yeni UI yönü açıkça onaylandığı için
önceki “CLI pilotu bitmeden UI ekleme” kuralı yürürlükten kaldırıldı.
Her siteye ayrı robot kurma, toplu/gözetimsiz gönderim, yeni provider ve e-posta
entegrasyonu MVP kapsamına alınmadı.

## Harcama ve veri sınırları

Bu yerel panel geliştirmesinde ücretli API çağrısı veya gerçek başvuru yapılmaz.
`job`, yerel `prepare` ve `assist` ücretli model kullanmaz. `agent` ve açıkça
onaylanan model incelemeleri farklıdır. Kod varsayılanları aylık 5 USD ve koşu
başına 0,10 USD'dir; özel `.env` farklı olabilir. Bu limitler ödeme hesabının
otomatik yükleme ayarını değiştirmez. Bütçe korumaları korunur.
