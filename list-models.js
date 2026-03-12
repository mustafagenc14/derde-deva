require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testDims() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  console.log("Testing text-embedding-004...");
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const res = await model.embedContent("test");
    console.log("text-embedding-004 length:", res.embedding.values.length);
  } catch(e) { console.error("text-embedding-004 failed"); }

  console.log("Testing embedding-001...");
  try {
    const model = genAI.getGenerativeModel({ model: 'embedding-001' });
    const res = await model.embedContent("test");
    console.log("embedding-001 length:", res.embedding.values.length);
  } catch(e) { console.error("embedding-001 failed"); }

  console.log("Testing text-embedding-004 (as models/text-embedding-004)...");
  try {
    const model = genAI.getGenerativeModel({ model: 'models/text-embedding-004' });
    const res = await model.embedContent("test");
    console.log("models/text-embedding-004 length:", res.embedding.values.length);
  } catch(e) { console.error("models/text-embedding-004 failed"); }
  
  console.log("Testing gemini-embedding-2-preview with outputDimensionality...");
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-embedding-2-preview' });
    const res = await model.embedContent({ 
        content: { role: 'user', parts: [{ text: "test" }] },
        outputDimensionality: 768 
    });
    console.log("gemini-embedding-2-preview length:", res.embedding.values.length);
  } catch(e) { console.error("failed:", e.message); }

  console.log("Testing text-embedding-004 outputDimensionality in taskParams...");
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const res = await model.embedContent({ content: "test", outputDimensionality: 768 });
    console.log("text-embedding-004 length:", res.embedding.values.length);
  } catch(e) { console.error("failed:", e.message); }
}
testDims();
