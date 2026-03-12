/* ============================================================
   DERDE DEVA KURAN — App Logic
   Handles: form submission, screen transitions,
            loading animation, fetch, fade-in, typewriter
   ============================================================ */

const MIN_LOADING_MS = 3500; // minimum loading display time

// --- Element References ---
const inputScreen   = document.getElementById('input-screen');
const loadingScreen = document.getElementById('loading-screen');
const resultScreen  = document.getElementById('result-screen');

const problemForm   = document.getElementById('problem-form');
const problemInput  = document.getElementById('problem-input');
const charCount     = document.getElementById('char-count');
const submitBtn     = document.getElementById('submit-btn');

const verseBlock    = document.getElementById('verse-block');
const verseText     = document.getElementById('verse-text');
const verseSource   = document.getElementById('verse-source');

const adviceBlock   = document.getElementById('advice-block');
const adviceText    = document.getElementById('advice-text');
const twCursor      = document.getElementById('typewriter-cursor');

const exportCard    = document.getElementById('export-card');
const actionButtons = document.getElementById('action-buttons');
const shareBtn      = document.getElementById('share-btn');

const errorBlock    = document.getElementById('error-block');
const errorMessage  = document.getElementById('error-message');

const backBtn       = document.getElementById('back-btn');

// --- Character Counter ---
problemInput.addEventListener('input', () => {
  charCount.textContent = `${problemInput.value.length} / 1000`;
});

// --- Screen Transition Helpers ---
function showScreen(screen) {
  [inputScreen, loadingScreen, resultScreen].forEach(s => {
    s.classList.remove('active');
  });
  screen.classList.add('active');
}

// --- Typewriter Effect ---
function typeWriter(element, text, cursor, speed = 28) {
  return new Promise(resolve => {
    let i = 0;
    element.textContent = '';
    cursor.classList.remove('hidden');

    const interval = setInterval(() => {
      if (i < text.length) {
        element.textContent += text[i];
        i++;
      } else {
        clearInterval(interval);
        // keep cursor blinking for 2s then hide
        setTimeout(() => {
          cursor.classList.add('hidden');
        }, 2000);
        resolve();
      }
    }, speed);
  });
}

// --- Show Result ---
async function showResult(data) {
  // Hide all result sub-blocks first
  exportCard.classList.add('hidden');
  verseBlock.classList.add('hidden');
  adviceBlock.classList.add('hidden');
  actionButtons.classList.add('hidden');
  shareBtn.classList.add('hidden');
  errorBlock.classList.add('hidden');
  backBtn.classList.add('hidden');

  showScreen(resultScreen);

  // 1. Fade in the export card and verse
  await delay(200); // small settle time
  verseText.textContent   = `"${data.ayet_metni}"`;
  verseSource.textContent = data.sure_bilgisi;
  exportCard.classList.remove('hidden');
  verseBlock.classList.remove('hidden');

  // 2. After verse is read (1.5s), show advice block + start typewriter
  await delay(1800);
  adviceBlock.classList.remove('hidden');
  await delay(400); // let block fade in
  await typeWriter(adviceText, data.psikolojik_tavsiye, twCursor, 26);

  // 3. Show buttons
  await delay(600);
  actionButtons.classList.remove('hidden');
  shareBtn.classList.remove('hidden');
  backBtn.classList.remove('hidden');
}

// --- Show Error ---
function showError(message) {
  exportCard.classList.add('hidden');
  actionButtons.classList.add('hidden');
  errorBlock.classList.remove('hidden');
  errorMessage.textContent = message;
  backBtn.classList.remove('hidden');
  showScreen(resultScreen);
}

// --- Utility: Promise-based delay ---
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Form Submit ---
problemForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const problem = problemInput.value.trim();
  if (!problem) return;

  submitBtn.disabled = true;

  // Switch to loading screen
  showScreen(loadingScreen);

  const loadStart = Date.now();

  try {
    const response = await fetch('/api/deva', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ problem }),
    });

    const json = await response.json();

    // Enforce minimum loading duration for the mystical effect
    const elapsed = Date.now() - loadStart;
    if (elapsed < MIN_LOADING_MS) {
      await delay(MIN_LOADING_MS - elapsed);
    }

    if (!response.ok) {
      showError(json.error || 'Beklenmedik bir hata oluştu. Lütfen tekrar deneyin.');
    } else {
      await showResult(json);
    }

  } catch (err) {
    const elapsed = Date.now() - loadStart;
    if (elapsed < MIN_LOADING_MS) await delay(MIN_LOADING_MS - elapsed);
    showError('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.');
  } finally {
    submitBtn.disabled = false;
  }
});

// --- Back Button ---
backBtn.addEventListener('click', () => {
  problemInput.value = '';
  charCount.textContent = '0 / 1000';
  showScreen(inputScreen);
});

// --- Share Button (html2canvas) ---
shareBtn.addEventListener('click', async () => {
  const originalText = shareBtn.innerHTML;
  shareBtn.innerHTML = 'HAYAL EDİLİYOR...';
  shareBtn.style.pointerEvents = 'none';
  
  try {
    // Generate image
    const canvas = await html2canvas(exportCard, {
      scale: 3, // High resolution for stories
      backgroundColor: '#12121f',
      useCORS: true,
      logging: false
    });
    
    // Convert to Blob for sharing/downloading
    canvas.toBlob(async (blob) => {
      const fileName = 'derde_deva_tavsiye.png';
      
      // Try Native Share API First (works on Mobile Safari, Android Chrome, etc)
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob], fileName, { type: blob.type })] })) {
        try {
          const file = new File([blob], fileName, { type: blob.type });
          await navigator.share({
            title: 'Derde Deva Kuran',
            text: 'Derde Deva bulduğum ayet ve tavsiye.',
            files: [file]
          });
        } catch (shareErr) {
          console.log('User cancelled share or share failed. Triggering download fallback.');
          downloadBlob(blob, fileName);
        }
      } else {
        // Fallback for Desktop: Direct Download
        downloadBlob(blob, fileName);
      }
      
      shareBtn.innerHTML = originalText;
      shareBtn.style.pointerEvents = 'auto';
    }, 'image/png');
    
  } catch (err) {
    console.error('Canvas error:', err);
    shareBtn.innerHTML = 'Hata Oluştu';
    setTimeout(() => {
      shareBtn.innerHTML = originalText;
      shareBtn.style.pointerEvents = 'auto';
    }, 2000);
  }
});

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Auto-focus textarea on load ---
window.addEventListener('load', () => {
  setTimeout(() => problemInput.focus(), 300);
});
