require('dotenv').config();
const chokidar = require('chokidar');
const path = require('path');
const fs = require('fs');
const { processAndIngestPDF } = require('./ingestion');

// Klasör yolları
const WATCH_DIR = path.join(__dirname, 'Dijital_Bilge_Kutuphanesi');
const PROCESSED_DIR = path.join(WATCH_DIR, 'islenenler');
const FAILED_DIR = path.join(WATCH_DIR, 'hatalilar');

// Klasörleri oluştur (Yoksa)
[WATCH_DIR, PROCESSED_DIR, FAILED_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

console.log(`\n======================================================`);
console.log(`👁️  DİJİTAL BİLGE KÜTÜPHANESİ GÖZCÜSÜ ÇALIŞIYOR`);
console.log(`   Klasör: ${WATCH_DIR}`);
console.log(`   Bu klasöre attığınız her PDF, otomatik olarak okunup öğrenilecektir.`);
console.log(`======================================================\n`);

// 1. Manuel Tarama Fonksiyonu (Klasördeki tüm PDF'leri bulup işler)
let isScanning = false;
async function scanAndProcess() {
  if (isScanning) return;
  isScanning = true;
  
  try {
    const files = fs.readdirSync(WATCH_DIR);
    for (const file of files) {
      if (file === 'islenenler' || file === 'hatalilar') continue;
      
      const filePath = path.join(WATCH_DIR, file);
      const stat = fs.statSync(filePath);
      
      // Sadece PDF'leri seç ve 2 saniyeden daha eskiyse işlem yap (kopyalanması bitmiş demektir)
      if (stat.isFile() && path.extname(file).toLowerCase() === '.pdf') {
        const timeSinceModified = Date.now() - stat.mtimeMs;
        
        if (timeSinceModified > 2000) {
          console.log(`\n[Gözcü] Sırada bekleyen PDF algılandı: ${file}`);
          await processSingleFile(filePath, file);
        }
      }
    }
  } catch (err) {
    console.error('[Gözcü] Klasör taranırken hata:', err.message);
  } finally {
    isScanning = false;
  }
}

// 2. Tekil Dosya İşleme Fonksiyonu
async function processSingleFile(filePath, fileName) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    
    // Pinecone'a Yükle
    const result = await processAndIngestPDF(fileBuffer, fileName);
    console.log(`[Gözcü] ✅ "${fileName}" başarıyla kitaba eklendi. ${result.chunksProcessed} parça hafızaya alındı.`);

    // İşlenenler klasörüne taşı
    const destPath = path.join(PROCESSED_DIR, fileName);
    fs.renameSync(filePath, destPath);
    console.log(`[Gözcü] 📁 "${fileName}" "islenenler" klasörüne kaldırıldı.`);

  } catch (error) {
    console.error(`[Gözcü] ❌ "${fileName}" işlenirken bir hata oluştu:`, error.message);
    
    // Hatalılar klasörüne taşı
    const destPath = path.join(FAILED_DIR, fileName);
    try {
      fs.renameSync(filePath, destPath);
      console.log(`[Gözcü] 📁 "${fileName}" "hatalilar" klasörüne kaldırıldı.`);
    } catch(moveErr) {
      console.error(`[Gözcü] Dosya taşınamadı:`, moveErr.message);
    }
  }
}

// 3. Her 3 Saniyede Bir Klasörü Kontrol Et (Windows'ta kesin çözüm)
setInterval(scanAndProcess, 3000);

// Başlangıçta bir kez hemen tara
scanAndProcess();

// Processi kalıcı olarak canlı tut (chokidar kapatsa bile dinlemeye devam etmesi için)
setInterval(() => {}, 1000 * 60 * 60); // Her saat başı boş bir döngü
