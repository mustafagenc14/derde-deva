require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const multer = require('multer');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const { processAndIngestPDF, retrieveContext } = require('./ingestion');

// Pinecone bağlantısını lazy (ihtiyaç anında) kuracak şekilde hazırlıyoruz
let pc;
function getPineconeIndex() {
  if (!pc) {
    pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY || "pcsk_dummy_key_to_prevent_crash_on_railway_boot"
    });
  }
  return pc.index(process.env.PINECONE_INDEX_NAME || "dijital-bilge");
}

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// --- GÜVENLİK KATMANLARI ---
// 1. Helmet: Güvenli HTTP başlıkları
app.use(helmet());

// 2. CORS: Çapraz kaynak erişimi (ihtiyaca göre kısıtlanabilir)
app.use(cors());

// 3. Genel Rate Limiter: Tüm isteklere genel bir sınır (örneğin 15 dakikada 100 istek)
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 dakika
  max: 100, // IP başına 100 istek
  message: { error: 'Çok fazla istek gönderildi. Lütfen 15 dakika sonra tekrar deneyin.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(globalLimiter);

// 4. Özel Rate Limiter: AI API uç noktası için daha sıkı sınırlama
const devaLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 saat
  max: 20, // IP başına saatte 20 istek
  message: { error: 'Saatlik deva arama sınırına ulaştınız. Lütfen bir saat sonra tekrar deneyin.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Configure Multer to store uploaded PDFs in memory temporarily
const upload = multer({ storage: multer.memoryStorage() });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Root ve Health Check
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Global Hata Yakalayıcılar (Railway Logları için)
process.on('uncaughtException', (err) => {
  console.error('Kritik Hata (Uncaught):', err);
});
process.on('unhandledRejection', (reason, promise) => {
  console.error('Yakalanmayan Reddedilme (Unhandled Rejection):', reason);
});

const SYSTEM_PROMPT = `SENİN KİMLİĞİN: Sen, mazeretleri yırtıp atan, önce sarsan sonra şefkatle sarmalayan, insanı kendi hikayesinden çıkarıp peygamberlerin mirasına bağlayan bilge bir yoldaşsın.

GÖREV: Kullanıcının paylaştığı soruna yönelik en uygun Kur'an ayetini bulmak ve aşağıdaki akışla ruhsal bir dönüşüm yaratmak.

KRİTİK KURAL: "ayet_metni" alanı kesinlikle ve sadece Kur'an-ı Kerim'den gerçek bir ayet olmalıdır. PDF/Bağlam metinlerinden filozof sözleri veya düz metinleri KESİNLİKLE ayet olarak sunma. Bağlamı sadece yorumuna bilgelik katmak için kullan.

İÇERİK KAYNAKLARI: İmam Gazali'nin "İhya" perspektifini (kalp tasfiyesi, nefs terbiyesi) ve modern klinik psikoloji prensiplerini (şemalar, farkındalık, savunma mekanizmaları) içselleştirerek kullan.

ÜSLUP VE İÇERİK AKIŞI (psikolojik_tavsiye alanında bu sırayla uygula):

🔴 ŞOK VE UYANIŞ (Giriş): Kullanıcının içine düştüğü "kurban psikolojisini" veya hatasını sarsıcı, sert ve tavizsiz bir dille yüzüne vur. Kaçtığı gerçeği tokat gibi patlat.

📖 KISSA AYNASI (Köprü): Kullanıcının yaşadığı sıkıntıyı, bir peygamberin yaşadığı benzer bir imtihanla doğrudan bağdaştır. "O da bu yoldan geçmişti, o şu tepkiyi vererek karanlığı yardı, sen de şu an kendi kuyundasın/ateşindesin..." diyerek bir yol çiz.

🟡 DÖNÜŞÜM (Gelişme): Modern ruh biliminin derinliğini kullanarak tonu yumuşat. Sarsılan ruhu toparla.

🟢 SONSUZ MERHAMET (Sonuç): Allah'ın rahmetini ve çözümün aslında ne kadar yakın olduğunu hissettirerek metni bitir.

✨ ALTIN KURAL (Soru): Son cümle istisnasız bir şekilde kullanıcıya yöneltilen derin bir soru olmalıdır.

YASAKLAR: "Gazali der ki", "Psikolojiye göre", "Şu peygamberin hayatında geçer ki" gibi akademik/mesafeli ifadeler KULLANMA. Bilgiyi kendi sesine erit, doğrudan 'Sen' diliyle konuş.

Çıktıyı YALNIZCA aşağıdaki JSON formatında ver, başka hiçbir şey yazma:
{
  "ayet_metni": "Kur'an-ı Kerim'den seçtiğin ayetin Diyanet meali",
  "sure_bilgisi": "Sure adı, ayet numarası",
  "psikolojik_tavsiye": "Yukarıdaki 5 aşamalı akışa uygun: şok → kıssa aynası → dönüşüm → merhamet → düşündürücü soru"
}`;

app.post('/api/deva', devaLimiter, async (req, res) => {
  const problem = req.body.problem?.trim()?.slice(0, 1000);

  if (!problem || problem.length === 0) {
    return res.status(400).json({ error: 'Lütfen bir sorun belirtin.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'your_gemini_api_key_here') {
    return res.status(500).json({
      error: 'API anahtarı bulunamadı. Lütfen .env dosyasına GEMINI_API_KEY ekleyin.'
    });
  }

  try {
    // 1. Dış Kaynakları (Bağlam) Çek
    // Kullanıcının derdini vektörleştir ve veritabanındaki (eğer varsa) kitaplardan en iyi 3 pasajı bul
    const contextPassages = await retrieveContext(problem, 3);
    const contextString = contextPassages.length > 0 
      ? `\n\nALGI (CONTEXT) METİNLERİ:\n${contextPassages.map((p, i) => `[PASAJ ${i+1}]: ${p}`).join('\n')}`
      : '\n\nALGI: Veritabanında ek bir edebi bağlam bulunamadı, mevcut bilgeliğini kullan.';

    // 2. Gemini Yapay Zeka Başlat (Çoklu Model Yedekleme Sistemi)
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelsToTry = [
      'gemini-2.5-flash', // Diagnostic script ile doğrulanan model
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ];

    let result;
    let successModel = '';
    let lastError = null;

    for (const modelName of modelsToTry) {
      try {
        console.log(`[Gemini] Deneniyor: ${modelName}...`);
        const model = genAI.getGenerativeModel({
          model: modelName,
          generationConfig: {
            responseMimeType: 'application/json',
          },
        });

        // Prompt'u bağlamla harmanla
        const fullPrompt = `${SYSTEM_PROMPT}${contextString}\n\nKullanıcının sorunu: "${problem}"`;
        
        result = await model.generateContent(fullPrompt);
        successModel = modelName;
        console.log(`[Gemini] Başarılı: ${modelName}`);
        break; // Biri çalışırsa döngüden çık
      } catch (err) {
        console.error(`[Gemini] Hata (${modelName}):`, err.message);
        lastError = err;
        // Eğer 404 ise bir sonrakini dene, değilse (kota vb.) muhtemelen hepsi hata verecektir ama şansımızı deneyelim
      }
    }

    if (!result) {
      throw lastError || new Error('Uygun bir AI modeli bulunamadı.');
    }

    const responseText = result.response.text();

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (parseErr) {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Geçersiz JSON yanıtı.');
      }
    }

    if (!parsed.ayet_metni || !parsed.sure_bilgisi || !parsed.psikolojik_tavsiye) {
      throw new Error('Eksik JSON alanları.');
    }

    return res.json({ ...parsed, _meta: { model: successModel } });

  } catch (err) {
    console.error('Gemini API Hatası:', err.message);
    
    // Custom error message for quota limitations
    if (err.message && err.message.includes('Quota exceeded')) {
      return res.status(429).json({
        error: 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.'
      });
    }

    return res.status(500).json({
      error: 'Bir hata oluştu. Lütfen tekrar deneyin.',
      detail: err.message
    });
  }
});

// --- ADMİN PANELİ ROUTE'LARI ---
// Frontend için admin sayfasını sunar
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// PDF Dosya Yükleme (Ingestion) Endpoint'i
app.post('/api/admin/upload', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Lütfen bir PDF dosyası seçin.' });
  }
  
  // Basit admin şifresi kontrolü (.env'de ADMIN_PASSWORD beklenebilir veya basit mock konulabilir)
  const authHeader = req.headers['authorization'];
  if (!process.env.ADMIN_PASSWORD || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return res.status(403).json({ error: 'Yetkisiz erişim.' });
  }

  try {
    const result = await processAndIngestPDF(req.file.buffer, req.file.originalname);
    return res.json({ 
      success: true, 
      message: `${req.file.originalname} başarıyla öğrenildi. Toplam ${result.chunksProcessed} parça veritabanına işlendi.` 
    });
  } catch (err) {
    console.error('Yükleme hatası:', err);
    return res.status(500).json({ error: 'PDF işlenirken bir hata oluştu.', detail: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✨ Sunucu ${PORT} portunda başarıyla ayağa kalktı.`);
});
