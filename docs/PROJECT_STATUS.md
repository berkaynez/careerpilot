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
Yerel panel ve panelden asistan başlatma henüz uygulanmadı.

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

## Tek aktif iş: açıklanabilir uyum analizi

Çalışma dalı: `feature/explainable-match-score`, birleşmiş main üzerinden açıldı.

- [x] Mevcut ilandan gereksinim çıkarma ve profil eşleme akışı kullanılıyor.
- [x] Doğrulanmış değerlendirmeden sürümlü, deterministik 0–100 puan hesaplanıyor.
- [x] Temel/tercih/görev ağırlıkları ve her şartın katkısı raporda görünüyor.
- [x] Güçlü, kısmi ve belgelenmeyen dayanaklar bilgi referanslarıyla ayrılıyor.
- [x] Puan, çalışma hakkı ve sponsorluk kararlarından ayrı tutuluyor.
- [x] Sıfır dayanak gerçek 0; puanlanabilir gereksinim yokluğu null; hatalı analiz hata üretiyor.
- [x] CLI sonucu, özel preparation.json ve review.txt aynı analizi gösteriyor.
- [x] TypeScript, 110 çevrimdışı test ve whitespace kontrolü geçti.

Bu iş panel, yeni site adaptörü veya gerçek model denemesi içermez. Yeni skor
ücretsiz yerel hesaplamadır; model eşleştirmesinin doğruluğu ve çıkarılan şartların
eksiksizliği insan incelemesi gerektirir. Test sayısı ürün başarısı yerine geçmez.
Kullanıcıya ait `.vscode/` dosyaları bu dalın parçası değildir.

## Sonraki teslimler

1. **Yerel panel:** hafif HTML/CSS/JavaScript + mevcut Node/TypeScript. İlan ekle,
   analiz görüntüle, başvuru durumunu takip et. Kayıtlar özel yerel dizinde kalır.
   Panel yeni bir skor motoru kurmaz; tamamlanan analiz işlevini kullanır.
2. **Form asistanı bağlantısı:** mevcut doldur/devam/devral akışını panelden erişilir
   yap; onaylı CV yüklemesini desteklenen yerde kullan, diğer yerde kullanıcıya bırak.
3. **Gerçek pilot ve ölçüm:** programın hibrit akışıyla bir hazırlığı doğrula;
   gerçek/manuel/taklit işlemleri ayır, toplam süreyi ve kalan manuel adımları kaydet.

Ayrıntılı kabul ölçütleri mimari belgede. Yeni UI yönü açıkça onaylandığı için
önceki “CLI pilotu bitmeden UI ekleme” kuralı yürürlükten kaldırıldı.
Her siteye ayrı robot kurma, toplu/gözetimsiz gönderim, yeni provider ve e-posta
entegrasyonu MVP kapsamına alınmadı.

## Harcama ve veri sınırları

Bu uyum analizi geliştirmesinde ücretli API çağrısı veya gerçek başvuru yapılmaz.
`job`, yerel `prepare` ve `assist` ücretli model kullanmaz. `agent` ve açıkça
onaylanan model incelemeleri farklıdır. Kod varsayılanları aylık 5 USD ve koşu
başına 0,10 USD'dir; özel `.env` farklı olabilir. Bu limitler ödeme hesabının
otomatik yükleme ayarını değiştirmez. Bütçe korumaları korunur.
