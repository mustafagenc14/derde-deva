require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');
const pdfParse = require('pdf-parse');
const { v4: uuidv4 } = require('uuid');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "AIza_YOUR_GEMINI_KEY");

let pc;
function getIndex() {
  if (!pc) {
    pc = new Pinecone({
      apiKey: process.env.PINECONE_API_KEY || "pcsk_dummy_key_to_prevent_crash_on_railway_boot"
    });
  }
  return pc.index(process.env.PINECONE_INDEX_NAME || "dijital-bilge");
}

/**
 * Metni belirli bir token (karakter bazlı) büyüklüğünde ve overlap (örtüşme) ile böler.
 * @param {string} text - Bölünecek tam metin
 * @param {number} chunkSize - Her parçanın maksimum karakter boyutu
 * @param {number} overlap - Parçalar arası eklenecek ortak karakter sayısı
 */
function chunkText(text, chunkSize = 1000, overlap = 150) {
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    let rawChunk = text.slice(i, i + chunkSize);
    // Cümle veya kelime ortasında kesmek yerine en son boşluğa kadar al
    let lastSpace = rawChunk.lastIndexOf(' ');
    
    // Eğer parça çok kısa değilse ve boşluk bulunduysa oradan kes
    if (lastSpace > 0 && i + chunkSize < text.length) {
      rawChunk = rawChunk.slice(0, lastSpace);
      i += lastSpace - overlap;
    } else {
      i += chunkSize - overlap;
    }
    
    chunks.push(rawChunk.trim());
  }
  return chunks;
}

/**
 * Textleri Gemini API ile vektöre (embedding) dönüştürür.
 * @param {string} text 
 */
async function getEmbedding(text) {
  // API key text-embedding-004 desteklemediği için gemini-embedding-2-preview kullanıyoruz
  // Pinecone indeksiniz 768 boyutlu. Gemini embedding 2 preview varsayılan boyutu faklı olabilir, o yüzden outputDimensionality veriyoruz.
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-2-preview' });
  const result = await model.embedContent({
      content: { role: 'user', parts: [{ text }] },
      outputDimensionality: 768
  });
  return result.embedding.values;
}

/**
 * Buffer halindeki PDF'i okur, parçalar, vektörleştirir ve Pinecone'a yükler.
 * @param {Buffer} pdfBuffer 
 * @param {string} sourceName 
 */
async function processAndIngestPDF(pdfBuffer, sourceName) {
  try {
    console.log(`[Ingestion] PDF okunuyor: ${sourceName}...`);
    const pdfData = await pdfParse(pdfBuffer);
    const text = pdfData.text.replace(/\\s+/g, ' ').trim(); // Fazla boşlukları temizle
    
    console.log(`[Ingestion] Metin parçalanıyor...`);
    const chunks = chunkText(text);
    console.log(`[Ingestion] Toplam ${chunks.length} parça oluşturuldu.`);

    const vectorsToUpsert = [];

    console.log(`[Ingestion] Vektörleştirme (Embedding) başlatılıyor... Lütfen bekleyin, bu işlem dosya boyutuna göre birkaç dakika sürebilir.`);
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (chunk.length < 20) continue; // Çok kısa spam/boşluk parçalarını atla
      
      const embedding = await getEmbedding(chunk);
      
      vectorsToUpsert.push({
        id: uuidv4(),
        values: embedding,
        metadata: {
          source: sourceName,
          text: chunk,
          chunkIndex: i
        }
      });

      // İlerleme durumunu ekrana bas (her 25 parçada bir)
      if (i > 0 && i % 25 === 0) {
        console.log(`[Ingestion] ⏳ ${i} / ${chunks.length} parça vektörleştirildi...`);
      }

      // API Rate Limitlerine takılmamak için hafif bekleme
      if (i % 10 === 0) await new Promise(r => setTimeout(r, 1000));
    }

    console.log(`[Ingestion] Pinecone'a yükleniyor...`);
    // Pinecone upsert limiti genellikle tek partide 100-200 arasıdır, güvenli olması için 50'şer yükleyelim
    const batchSize = 50;
    for (let i = 0; i < vectorsToUpsert.length; i += batchSize) {
      const batch = vectorsToUpsert.slice(i, i + batchSize);
      await getIndex().upsert({ records: batch });
      console.log(`[Ingestion] Batch ${i / batchSize + 1} yüklendi.`);
    }

    console.log(`[Ingestion] Başarıyla tamamlandı: ${sourceName}`);
    return { success: true, chunksProcessed: chunks.length };
  } catch (error) {
    console.error(`[Ingestion Error]`, error);
    throw error;
  }
}

/**
 * Kullanıcı derdine en uygun metinleri getiren fonksyion.
 * @param {string} query 
 * @param {number} topK 
 */
async function retrieveContext(query, topK = 3) {
  try {
    const queryEmbedding = await getEmbedding(query);
    const queryResponse = await getIndex().query({
      vector: queryEmbedding,
      topK: topK,
      includeMetadata: true
    });
    
    return queryResponse.matches.map(match => match.metadata.text);
  } catch (error) {
    console.error(`[Retrieval Error]`, error);
    return []; // Hata olursa sistem çökmesin, bağlamsız devam etsin
  }
}

module.exports = {
  processAndIngestPDF,
  retrieveContext
};
