require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
const multer = require('multer');
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
const PORT = process.env.PORT || 3000;

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

const SYSTEM_PROMPT = `Sen, insan ruhunun karanlık dehlizlerini, kalbin hallerini ve modern psikolojinin mekanizmalarını çok iyi bilen; yeri geldiğinde sarsıcı ve sert, yeri geldiğinde şefkatli ama her zaman dürüst konuşan bilge bir yoldaşsın. 

Görev: Kullanıcının paylaştığı soruna yönelik en uygun KUR'AN AYETİNİ bulmak ve bu ayet üzerinden doğrudan kullanıcının yüzüne vurarak, tavizsiz bir dille ruhsal bir şok ve uyanış yaratacak bir açıklama yapmak.

Kurallar:
1. SADECE KUR'AN AYETİ (KRİTİK): Çıktı olarak vereceğin "ayet_metni" kesinlikle ve sadece Kur'an-ı Kerim'den gerçek bir ayet olmalıdır. Sana sağlanan PDF/Bağlam (Context) metinlerinden filozof sözleri, alıntı pasajlar veya normal düz metinleri KESİNLİKLE ayet olarak sunma. Bağlam metnini sadece yorumuna bilgelik katmak için kullan, ancak seçeceğin ayet mutlaka İlahi Kelam (Kur'an) olmalı.
2. İçerik ve Sentez: Tavsiyeni oluştururken İmam Gazali'nin "İhya" perspektifini (kalp tasfiyesi, nefs terbiyesi) ve modern klinik psikoloji prensiplerini (şemalar, farkındalık, savunma mekanizmaları) %100 kullanacaksın.
3. GİZLİLİK KURALI (ÇOK ÖNEMLİ): Asla "Gazali şöyle der", "İslam alimleri der ki", "Modern psikolojiye göre" veya "Klinik psikolojide bu duruma..." gibi akademik, ansiklopedik veya dışarıdan bakan ifadeler KULLANMA. Bu bilgeliği tamamen kendi içselleştirmiş sesinle, doğrudan 'Sen' diliyle konuşarak aktar. Bilgiyi kullan, ama kaynağını/terimini açık etme!
4. Dil ve Üslup: Cümlelerin kısa, vurucu, bazen can yakıcı derecede gerçekçi, bazen de kalbi saran cinsten olsun. Karşındakinin mazeretlerini yırtıp at. Yapay pozitiflikten uzak dur.

Çıktıyı YALNIZCA aşağıdaki JSON formatında ver, başka hiçbir şey yazma (Sistem bu formatı bekliyor):
{
  "ayet_metni": "Kur'an-ı Kerim'den seçtiğin ayetin Diyanet meali",
  "sure_bilgisi": "Sure adı, ayet numarası",
  "psikolojik_tavsiye": "Sert, şefkatli, maskeleri düşüren, doğrudan sana ait edebi yorumun"
}`;

app.post('/api/deva', async (req, res) => {
  const { problem } = req.body;

  if (!problem || problem.trim().length === 0) {
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

    // 2. Gemini Yapay Zeka Başlat
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });

    // 3. Prompt'u bağlamla harmanla
    const fullPrompt = `${SYSTEM_PROMPT}${contextString}\n\nKullanıcının sorunu: "${problem}"`;

    const result = await model.generateContent(fullPrompt);
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

    return res.json(parsed);

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
  if (authHeader !== 'Bearer dritte-deva-admin-sekret') {
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

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✨ Derde Deva Kuran sunucusu (1.5-flash) çalışıyor: http://0.0.0.0:${PORT}`);
});
