require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function checkModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  console.log("Testing API Key ending in:", apiKey ? apiKey.slice(-4) : 'none');
  
  const genAI = new GoogleGenerativeAI(apiKey);
  
  const modelsToTest = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-pro'
  ];

  for (const modelName of modelsToTest) {
    console.log(`\n--- Testing ${modelName} ---`);
    try {
      const model = genAI.getGenerativeModel({ model: modelName });
      const result = await model.generateContent("Sadece 'OK' yaz.");
      console.log(`✅ SUCCESS: ${result.response.text().trim()}`);
    } catch (err) {
      console.error(`❌ FAILED: ${err.message.split('\n')[0].substring(0, 100)}`);
    }
  }
}

checkModels();
