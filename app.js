// Global State
let recordingState = {
  isRecording: false,
  startTime: null,
  elapsedSeconds: 0,
  timerInterval: null,
  totalWords: 0,
  flaggedCount: 0,
  score: 100,
  categoryCounts: {
    fillers: 0,
    brainrot: 0,
    corporate: 0,
    custom: 0
  },
  offendingWords: {}, // { word: { count: x, category: y } }
  historyLog: [],     // Array of { timestamp: '00:00', word: '...', replacement: '...', category: '...' }
  challengeMode: 'free', // 'free', 'pitch', 'interview', 'presentation'
  challengeDuration: 0,   // seconds
};

// Settings (Load from LocalStorage or use defaults)
let settings = {
  categories: {
    fillers: true,
    brainrot: true,
    corporate: true
  },
  audioAlert: true,
  visualAlert: true,
  alertVolume: 0.4,
  customWords: {
    "crap": "unfortunate event",
    "whatever": "regardless"
  },
  language: "en-US"
};

// Load settings from LocalStorage
const STORAGE_KEY = 'verbalist_settings';
function loadSettings() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      settings = JSON.parse(saved);
      // Ensure fields exist in case structure updated
      if (!settings.categories) settings.categories = { fillers: true, brainrot: true, corporate: true };
      if (settings.audioAlert === undefined) settings.audioAlert = true;
      if (settings.visualAlert === undefined) settings.visualAlert = true;
      if (settings.alertVolume === undefined) settings.alertVolume = 0.4;
      if (!settings.customWords) settings.customWords = {};
      if (!settings.language) settings.language = "en-US";
    } catch (e) {
      console.error("Failed to parse settings, using defaults.", e);
    }
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

// Speech Recognition Variables
let recognition = null;
let finalTranscriptBuffer = '';
let alertTimeoutId = null;

// Initialize Speech Recognition
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    const viewport = document.getElementById('transcriptionViewport');
    viewport.innerHTML = `<div style="color: var(--color-brainrot); text-align: center; padding: 2rem;">
      <i class="fa-solid fa-triangle-exclamation" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
      <p style="font-weight: 600;">Web Speech API is not supported in this browser.</p>
      <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 0.5rem;">
        Please use a modern browser like Google Chrome, Microsoft Edge, or Safari.
      </p>
    </div>`;
    document.getElementById('startBtn').disabled = true;
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = settings.language;

  recognition.onstart = () => {
    recordingState.isRecording = true;
    document.getElementById('transcriptionPanel').classList.add('recording');
    document.getElementById('startBtn').style.display = 'none';
    document.getElementById('stopBtn').style.display = 'inline-flex';
    document.getElementById('languageBadge').textContent = document.querySelector(`#languageSelect option[value="${settings.language}"]`).textContent;
    
    // Set alert banner status to listening
    const alertIcon = document.getElementById('alertIcon');
    const alertTitle = document.getElementById('alertTitle');
    const alertMessage = document.getElementById('alertMessage');
    document.getElementById('alertBanner').classList.remove('alert-active');
    alertIcon.className = 'fa-solid fa-volume-high';
    alertTitle.textContent = 'Listening...';
    alertMessage.textContent = 'Speak naturally. We are monitoring your speech in real-time.';
    
    // Start Visualizer wave
    targetWaveAmp = 5; // idle hum
  };

  recognition.onend = () => {
    // If the browser stopped speech recognition but we are still supposedly recording, restart it!
    if (recordingState.isRecording) {
      try {
        recognition.start();
      } catch (e) {
        console.error("Failed to restart speech recognition:", e);
      }
    } else {
      document.getElementById('transcriptionPanel').classList.remove('recording');
      document.getElementById('startBtn').style.display = 'inline-flex';
      document.getElementById('stopBtn').style.display = 'none';
      targetWaveAmp = 0; // flatline
    }
  };

  recognition.onerror = (event) => {
    console.error("Speech Recognition Error:", event.error);
    if (event.error === 'not-allowed') {
      const viewport = document.getElementById('transcriptionViewport');
      viewport.innerHTML = `<div style="color: var(--color-brainrot); text-align: center; padding: 1rem;">
        <i class="fa-solid fa-microphone-slash" style="font-size: 2.5rem; margin-bottom: 1rem;"></i>
        <p style="font-weight: 600;">Microphone Access Denied</p>
        <p style="font-size: 0.9rem; color: var(--text-secondary); margin-top: 0.5rem;">
          Please check your browser permissions to allow microphone access, then refresh the page.
        </p>
      </div>`;
      endSession();
    }
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    
    // Animate visualizer wave slightly on speech input
    targetWaveAmp = 18;
    
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      const transcriptChunk = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        // Append to buffer and parse
        finalTranscriptBuffer += transcriptChunk + ' ';
        processFinalText(transcriptChunk);
      } else {
        interimTranscript += transcriptChunk;
      }
    }
    
    // Render the text inside the viewport
    renderTranscript(finalTranscriptBuffer, interimTranscript);
    
    // Auto scroll to bottom
    const viewport = document.getElementById('transcriptionViewport');
    viewport.scrollTop = viewport.scrollHeight;
  };

  return true;
}

// Build Consolidated Dictionary based on Settings
function getActiveDictionary() {
  const active = {};
  
  if (settings.categories.fillers) {
    for (const [word, replacement] of Object.entries(WORD_DICTIONARY.fillers.words)) {
      active[word.toLowerCase()] = { category: 'fillers', replacement };
    }
  }
  if (settings.categories.brainrot) {
    for (const [word, replacement] of Object.entries(WORD_DICTIONARY.brainrot.words)) {
      active[word.toLowerCase()] = { category: 'brainrot', replacement };
    }
  }
  if (settings.categories.corporate) {
    for (const [word, replacement] of Object.entries(WORD_DICTIONARY.corporate.words)) {
      active[word.toLowerCase()] = { category: 'corporate', replacement };
    }
  }
  // Custom Words
  for (const [word, replacement] of Object.entries(settings.customWords)) {
    active[word.toLowerCase()] = { category: 'custom', replacement: replacement || '[omit]' };
  }
  
  return active;
}

// Format the final transcript with highlights
function renderTranscript(finalText, interimText) {
  const viewport = document.getElementById('transcriptionViewport');
  
  // Format the finalized text with spans
  const formattedFinal = highlightForbiddenWords(finalText);
  
  // Format the interim text similarly or keep it plain (interim is greyed)
  const formattedInterim = interimText ? `<span class="interim-transcript">${interimText}</span>` : '';
  
  viewport.innerHTML = formattedFinal + formattedInterim;
}

// Parser to search and replace words with stylized spans
function highlightForbiddenWords(text) {
  if (!text) return '';
  
  let formatted = text;
  const activeDict = getActiveDictionary();
  const sortedKeys = Object.keys(activeDict).sort((a, b) => b.length - a.length);
  
  let placeholders = [];
  
  // Replace words matches with placeholders to avoid nested replacements
  for (const key of sortedKeys) {
    // Match word boundary or spaces (for phrases)
    const regex = new RegExp(`\\b(${key})\\b`, 'gi');
    formatted = formatted.replace(regex, (match) => {
      const idx = placeholders.length;
      const cat = activeDict[key].category;
      placeholders.push(`<span class="word-${cat}" title="Replacement: ${activeDict[key].replacement}">${match}</span>`);
      return `___PLACEHOLDER_${idx}___`;
    });
  }
  
  // Restore placeholders with spans
  for (let i = 0; i < placeholders.length; i++) {
    formatted = formatted.replace(`___PLACEHOLDER_${i}___`, placeholders[i]);
  }
  
  return formatted;
}

// Process newly finalized text chunk
function processFinalText(text) {
  // Clean text and count total words
  const cleanedWords = text.trim().split(/\s+/).filter(w => w.length > 0);
  recordingState.totalWords += cleanedWords.length;
  document.getElementById('totalWordsCount').textContent = recordingState.totalWords;
  
  // Parse for forbidden words
  const activeDict = getActiveDictionary();
  const sortedKeys = Object.keys(activeDict).sort((a, b) => b.length - a.length);
  
  // Clean punctuation for matching
  let tempCleaned = " " + text.toLowerCase().replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ") + " ";
  
  const matches = [];
  
  for (const key of sortedKeys) {
    const regex = new RegExp(`\\b${key}\\b`, 'g');
    if (regex.test(tempCleaned)) {
      const matchCount = (tempCleaned.match(regex) || []).length;
      if (matchCount > 0) {
        matches.push({
          word: key,
          count: matchCount,
          category: activeDict[key].category,
          replacement: activeDict[key].replacement
        });
        // Remove from string to prevent matching shorter nested words
        tempCleaned = tempCleaned.replace(regex, " [flagged] ");
      }
    }
  }
  
  // Apply matches to state
  if (matches.length > 0) {
    matches.forEach(m => {
      // Update global counters
      recordingState.flaggedCount += m.count;
      recordingState.categoryCounts[m.category] += m.count;
      
      // Update offending word counts
      if (!recordingState.offendingWords[m.word]) {
        recordingState.offendingWords[m.word] = { count: 0, category: m.category };
      }
      recordingState.offendingWords[m.word].count += m.count;
      
      // Add to timeline log
      const timeStr = formatTimerDigital(recordingState.elapsedSeconds);
      recordingState.historyLog.unshift({
        timestamp: timeStr,
        word: m.word,
        replacement: m.replacement,
        category: m.category
      });
      
      // Trigger Alert (only the first matched word in this chunk gets visual highlight in the card for sanity)
      triggerAlert(m.word, m.replacement, m.category);
    });
    
    // Update Score and sidebar stats
    updateScore();
    updateSidebarStats();
    renderFrequencyList();
    renderHistoryLog();
  }
  
  // Update speed metric
  updateWpmSpeed();
}

// Trigger warning alert (audio sound, visual flash, screen shake)
let lastAlertedTime = 0;
let lastAlertedWord = '';
function triggerAlert(word, replacement, category) {
  const now = Date.now();
  // Prevent duplicate alerts in rapid succession for same word
  if (word === lastAlertedWord && now - lastAlertedTime < 800) {
    return;
  }
  lastAlertedWord = word;
  lastAlertedTime = now;
  
  const banner = document.getElementById('alertBanner');
  const alertIcon = document.getElementById('alertIcon');
  const alertTitle = document.getElementById('alertTitle');
  const alertMessage = document.getElementById('alertMessage');
  
  let color = 'var(--color-filler)';
  let glow = 'var(--color-filler-glow)';
  let label = 'Filler Word Detected';
  
  if (category === 'brainrot') {
    color = 'var(--color-brainrot)';
    glow = 'var(--color-brainrot-glow)';
    label = 'Brainrot Word Detected';
  } else if (category === 'corporate') {
    color = 'var(--color-corporate)';
    glow = 'var(--color-corporate-glow)';
    label = 'Jargon Alert';
  } else if (category === 'custom') {
    color = 'var(--accent)';
    glow = 'var(--accent-glow)';
    label = 'Custom Block Word';
  }
  
  // Update CSS custom properties of alert banner
  banner.style.setProperty('--alert-color', color);
  banner.style.setProperty('--alert-color-glow', glow);
  banner.classList.add('alert-active');
  
  alertIcon.className = 'fa-solid fa-triangle-exclamation';
  alertTitle.textContent = label;
  
  const textReplacement = replacement === '[omit]' ? 'omit it' : `try <span class="replacement-word">${replacement}</span>`;
  alertMessage.innerHTML = `Instead of saying <span class="flagged-word">"${word}"</span>, ${textReplacement}.`;
  
  // Screen Shake & Flash
  if (settings.visualAlert) {
    const consolePanel = document.getElementById('transcriptionPanel');
    consolePanel.classList.add('shake-container');
    document.body.style.boxShadow = `inset 0 0 50px ${glow}`;
    setTimeout(() => {
      consolePanel.classList.remove('shake-container');
      document.body.style.boxShadow = 'none';
    }, 450);
  }
  
  // Synth buzzer/bell audio feedback
  if (settings.audioAlert) {
    playSynthSound(category);
  }
  
  // Auto reset alert banner back to listening status after 4.5 seconds
  clearTimeout(alertTimeoutId);
  alertTimeoutId = setTimeout(() => {
    banner.classList.remove('alert-active');
    if (recordingState.isRecording) {
      alertIcon.className = 'fa-solid fa-volume-high';
      alertTitle.textContent = 'Listening...';
      alertMessage.textContent = 'Speak naturally. We are monitoring...';
    } else {
      alertIcon.className = 'fa-solid fa-circle-check';
      alertTitle.textContent = 'Speech Clarity';
      alertMessage.textContent = 'Speech is clear. Say a filler or brainrot word to see suggestions.';
    }
  }, 4500);
}

// Programmatic Web Audio Synthesizer (Zero asset download required!)
let synthAudioContext = null;
function playSynthSound(category) {
  try {
    if (!synthAudioContext) {
      synthAudioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (synthAudioContext.state === 'suspended') {
      synthAudioContext.resume();
    }
    
    const gainNode = synthAudioContext.createGain();
    gainNode.gain.setValueAtTime(settings.alertVolume, synthAudioContext.currentTime);
    
    const osc = synthAudioContext.createOscillator();
    
    if (category === 'brainrot') {
      // Slightly annoying buzzer sound
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(200, synthAudioContext.currentTime);
      osc.frequency.linearRampToValueAtTime(140, synthAudioContext.currentTime + 0.25);
      
      const filter = synthAudioContext.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(500, synthAudioContext.currentTime);
      
      osc.connect(filter);
      filter.connect(gainNode);
      gainNode.connect(synthAudioContext.destination);
      
      osc.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, synthAudioContext.currentTime + 0.25);
      osc.stop(synthAudioContext.currentTime + 0.26);
    } else if (category === 'corporate') {
      // Tech-y laser ping
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, synthAudioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, synthAudioContext.currentTime + 0.15);
      
      osc.connect(gainNode);
      gainNode.connect(synthAudioContext.destination);
      
      osc.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, synthAudioContext.currentTime + 0.18);
      osc.stop(synthAudioContext.currentTime + 0.2);
    } else {
      // Normal filler word: soft clean bell sound
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, synthAudioContext.currentTime); // D5
      
      osc.connect(gainNode);
      gainNode.connect(synthAudioContext.destination);
      
      osc.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, synthAudioContext.currentTime + 0.35);
      osc.stop(synthAudioContext.currentTime + 0.4);
    }
  } catch (err) {
    console.error("Synthesizer sound playback failed:", err);
  }
}

// Update integrity score
function updateScore() {
  // Integrity Score Calculation:
  // Starts at 100%. Each filler word: -3%; brainrot: -5%; corporate: -2%; custom: -3%
  let scoreDeduction = 
    (recordingState.categoryCounts.fillers * 3) +
    (recordingState.categoryCounts.brainrot * 5) +
    (recordingState.categoryCounts.corporate * 2) +
    (recordingState.categoryCounts.custom * 3);
  
  recordingState.score = Math.max(0, 100 - scoreDeduction);
  
  const scoreEl = document.getElementById('clarityScore');
  scoreEl.textContent = recordingState.score;
  
  // Style based on score value
  scoreEl.className = 'score-number';
  if (recordingState.score < 70) {
    scoreEl.classList.add('score-critical');
  } else if (recordingState.score < 90) {
    scoreEl.classList.add('score-warning');
  }
}

// Update WPM
function updateWpmSpeed() {
  const elapsed = recordingState.elapsedSeconds;
  const speedEl = document.getElementById('speechSpeedWpm');
  
  if (elapsed < 3 || recordingState.totalWords === 0) {
    speedEl.textContent = '0';
    return;
  }
  
  const wpm = Math.round(recordingState.totalWords / (elapsed / 60));
  speedEl.textContent = wpm;
}

// Update Sidebar Numbers
function updateSidebarStats() {
  document.getElementById('flaggedWordsCount').textContent = recordingState.flaggedCount;
  document.getElementById('count-fillers').textContent = recordingState.categoryCounts.fillers;
  document.getElementById('count-brainrot').textContent = recordingState.categoryCounts.brainrot;
  document.getElementById('count-corporate').textContent = recordingState.categoryCounts.corporate;
}

// Render word frequency distribution list
function renderFrequencyList() {
  const freqList = document.getElementById('frequencyList');
  freqList.innerHTML = '';
  
  // Sort offending words by count descending
  const sorted = Object.entries(recordingState.offendingWords).sort((a, b) => b[1].count - a[1].count);
  
  if (sorted.length === 0) {
    return;
  }
  
  const maxCount = sorted[0][1].count;
  
  sorted.forEach(([word, info]) => {
    const item = document.createElement('div');
    item.className = 'freq-item';
    
    // Percentage width for bar
    const barWidthPercent = (info.count / maxCount) * 100;
    
    let barColor = 'var(--color-filler)';
    if (info.category === 'brainrot') barColor = 'var(--color-brainrot)';
    else if (info.category === 'corporate') barColor = 'var(--color-corporate)';
    else if (info.category === 'custom') barColor = 'var(--accent)';
    
    item.innerHTML = `
      <div class="freq-word-info">
        <span class="freq-word">"${word}"</span>
        <span class="freq-badge badge-${info.category}">${info.category}</span>
      </div>
      <div class="freq-count-bar">
        <div class="freq-bar-outer">
          <div class="freq-bar-inner" style="width: ${barWidthPercent}%; background-color: ${barColor}"></div>
        </div>
        <span class="freq-count">${info.count}</span>
      </div>
    `;
    freqList.appendChild(item);
  });
}

// Render historical timeline logs
function renderHistoryLog() {
  const logContainer = document.getElementById('historyLog');
  logContainer.innerHTML = '';
  
  recordingState.historyLog.forEach(log => {
    const item = document.createElement('div');
    item.className = 'history-item';
    
    let borderCol = 'var(--color-filler)';
    if (log.category === 'brainrot') borderCol = 'var(--color-brainrot)';
    else if (log.category === 'corporate') borderCol = 'var(--color-corporate)';
    else if (log.category === 'custom') borderCol = 'var(--accent)';
    
    item.style.borderColor = borderCol;
    
    const altText = log.replacement === '[omit]' ? 'omit' : `use "${log.replacement}"`;
    
    item.innerHTML = `
      <div class="history-time">${log.timestamp}</div>
      <div class="history-desc">
        Used <span class="cross" style="color: ${borderCol};">"${log.word}"</span> &rarr;
        <span class="alt-tag">${altText}</span>
      </div>
    `;
    logContainer.appendChild(item);
  });
}

// Practice Session / Challenge Timer Loop
function startTimer() {
  recordingState.elapsedSeconds = 0;
  updateTimerHUD();
  
  recordingState.timerInterval = setInterval(() => {
    recordingState.elapsedSeconds++;
    updateTimerHUD();
    updateWpmSpeed();
    
    // Challenge Mode ending check
    if (recordingState.challengeMode !== 'free') {
      const remaining = recordingState.challengeDuration - recordingState.elapsedSeconds;
      if (remaining <= 0) {
        clearInterval(recordingState.timerInterval);
        endSession();
        triggerChallengeEndSummary();
      }
    }
  }, 1000);
}

function updateTimerHUD() {
  const digitalEl = document.getElementById('timerDigital');
  const progressCircle = document.getElementById('timerProgress');
  
  if (recordingState.challengeMode === 'free') {
    digitalEl.textContent = formatTimerDigital(recordingState.elapsedSeconds);
    // Flat track in free speech mode
    progressCircle.style.strokeDashoffset = '0';
  } else {
    const remaining = Math.max(0, recordingState.challengeDuration - recordingState.elapsedSeconds);
    digitalEl.textContent = formatTimerDigital(remaining);
    
    // Math to compute SVG circumference stroke dashoffset
    // Radius = 20, Circumference = 125.66
    const fraction = remaining / recordingState.challengeDuration;
    const offset = 125.66 * (1 - fraction);
    progressCircle.style.strokeDashoffset = offset;
  }
}

function formatTimerDigital(totalSecs) {
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// Challenge End Notification
function triggerChallengeEndSummary() {
  // Programmatic Alert Sound (Success Bell Chime)
  try {
    if (synthAudioContext) {
      const gainNode = synthAudioContext.createGain();
      gainNode.gain.setValueAtTime(settings.alertVolume, synthAudioContext.currentTime);
      
      const osc1 = synthAudioContext.createOscillator();
      const osc2 = synthAudioContext.createOscillator();
      
      osc1.frequency.setValueAtTime(523.25, synthAudioContext.currentTime); // C5
      osc2.frequency.setValueAtTime(659.25, synthAudioContext.currentTime); // E5
      
      osc1.connect(gainNode);
      osc2.connect(gainNode);
      gainNode.connect(synthAudioContext.destination);
      
      osc1.start();
      osc2.start();
      
      gainNode.gain.exponentialRampToValueAtTime(0.01, synthAudioContext.currentTime + 1.2);
      osc1.stop(synthAudioContext.currentTime + 1.2);
      osc2.stop(synthAudioContext.currentTime + 1.2);
    }
  } catch(e){}
  
  // Custom styled popup or text alert
  let rating = "Excellent! You speak with professional precision.";
  if (recordingState.score < 60) {
    rating = "Practice makes perfect. Try to slow down and embrace pauses.";
  } else if (recordingState.score < 85) {
    rating = "Great job! A few filler words slipped in, but your message is clear.";
  }
  
  alert(`🏁 Challenge Session Complete! \n\n` + 
        `⏱ Mode: ${recordingState.challengeMode.toUpperCase()}\n` +
        `🎯 Speech Integrity: ${recordingState.score}%\n` +
        `📝 Words Spoken: ${recordingState.totalWords}\n` +
        `⚠️ Total Flagged Words: ${recordingState.flaggedCount}\n\n` +
        `Coach Rating: ${rating}`);
}

// Session Controls
function startSession() {
  if (recordingState.isRecording) return;
  
  // Request mic access & init recognition
  if (!recognition) {
    const ok = initSpeechRecognition();
    if (!ok) return;
  }
  
  // Clear previous session states
  finalTranscriptBuffer = '';
  document.getElementById('transcriptionViewport').innerHTML = '';
  
  recordingState.totalWords = 0;
  recordingState.flaggedCount = 0;
  recordingState.score = 100;
  recordingState.categoryCounts = { fillers: 0, brainrot: 0, corporate: 0, custom: 0 };
  recordingState.offendingWords = {};
  recordingState.historyLog = [];
  
  document.getElementById('totalWordsCount').textContent = '0';
  document.getElementById('speechSpeedWpm').textContent = '0';
  document.getElementById('flaggedWordsCount').textContent = '0';
  updateScore();
  updateSidebarStats();
  renderFrequencyList();
  renderHistoryLog();
  
  // Set challenge details
  const activeCard = document.querySelector('.challenge-card.active');
  const mode = activeCard.dataset.mode;
  recordingState.challengeMode = mode;
  
  if (mode === 'pitch') {
    recordingState.challengeDuration = 60;
  } else if (mode === 'interview') {
    recordingState.challengeDuration = 120;
  } else if (mode === 'presentation') {
    recordingState.challengeDuration = 180;
  } else {
    recordingState.challengeDuration = 0;
  }
  
  document.getElementById('challengeStatus').textContent = mode === 'free' ? 'FREE PRACTICE' : 'COACH ACTIVE';
  document.getElementById('challengeStatus').style.color = mode === 'free' ? 'var(--text-muted)' : 'var(--safe)';
  
  try {
    recognition.lang = settings.language;
    recognition.start();
    startTimer();
  } catch (e) {
    console.error("Speech Recognition starting exception:", e);
  }
}

function endSession() {
  if (!recordingState.isRecording) return;
  
  recordingState.isRecording = false;
  clearInterval(recordingState.timerInterval);
  
  if (recognition) {
    try {
      recognition.stop();
    } catch(e){}
  }
  
  document.getElementById('challengeStatus').textContent = 'OFF';
  document.getElementById('challengeStatus').style.color = 'var(--text-muted)';
  
  // Update final status message
  const alertIcon = document.getElementById('alertIcon');
  const alertTitle = document.getElementById('alertTitle');
  const alertMessage = document.getElementById('alertMessage');
  alertIcon.className = 'fa-solid fa-circle-check';
  alertTitle.textContent = 'Session Stopped';
  alertMessage.innerHTML = `Integrity Score finished at <span class="replacement-word" style="background: var(--accent-glow); color: var(--accent); border-color: var(--accent)">${recordingState.score}%</span>. View analytics below.`;
}

function resetSession() {
  endSession();
  
  finalTranscriptBuffer = '';
  document.getElementById('transcriptionViewport').innerHTML = '';
  
  recordingState.totalWords = 0;
  recordingState.flaggedCount = 0;
  recordingState.score = 100;
  recordingState.categoryCounts = { fillers: 0, brainrot: 0, corporate: 0, custom: 0 };
  recordingState.offendingWords = {};
  recordingState.historyLog = [];
  
  document.getElementById('totalWordsCount').textContent = '0';
  document.getElementById('speechSpeedWpm').textContent = '0';
  document.getElementById('flaggedWordsCount').textContent = '0';
  updateScore();
  updateSidebarStats();
  renderFrequencyList();
  renderHistoryLog();
  
  recordingState.elapsedSeconds = 0;
  updateTimerHUD();
  
  const alertIcon = document.getElementById('alertIcon');
  const alertTitle = document.getElementById('alertTitle');
  const alertMessage = document.getElementById('alertMessage');
  alertIcon.className = 'fa-solid fa-circle-check';
  alertTitle.textContent = 'Speech Clarity';
  alertMessage.textContent = 'Speech is clear. Say a filler or brainrot word to see suggestions.';
}

// Custom word management
function renderCustomWordsList() {
  const container = document.getElementById('customWordsList');
  container.innerHTML = '';
  
  const words = Object.entries(settings.customWords);
  if (words.length === 0) {
    container.innerHTML = `<span style="font-size: 0.8rem; color: var(--text-muted); padding: 0.5rem;">No custom target words added yet.</span>`;
    return;
  }
  
  words.forEach(([word, replacement]) => {
    const tag = document.createElement('div');
    tag.className = 'custom-word-tag';
    tag.innerHTML = `
      <strong>${word}</strong> &rarr; ${replacement || '[omit]'}
      <button class="remove-tag-btn" data-word="${word}">&times;</button>
    `;
    container.appendChild(tag);
  });
  
  // Attach delete events
  container.querySelectorAll('.remove-tag-btn').forEach(btn => {
    btn.onclick = (e) => {
      const wordToDelete = e.currentTarget.dataset.word;
      delete settings.customWords[wordToDelete];
      saveSettings();
      renderCustomWordsList();
    };
  });
}

// Export Session logs to text
function exportSessionLog() {
  if (recordingState.historyLog.length === 0 && !finalTranscriptBuffer) {
    alert("Nothing to export! Record a speech session first.");
    return;
  }
  
  let logText = `======================================\n`;
  logText += ` VERBALIST AI SPEECH COACH REPORT \n`;
  logText += ` Generated: ${new Date().toLocaleString()}\n`;
  logText += `======================================\n\n`;
  logText += `[RESULTS SUMMARY]\n`;
  logText += `- Final Integrity Score: ${recordingState.score}%\n`;
  logText += `- Total Spoken Words: ${recordingState.totalWords}\n`;
  logText += `- Speed: ${document.getElementById('speechSpeedWpm').textContent} Words/Min\n`;
  logText += `- Total Flagged Words: ${recordingState.flaggedCount}\n`;
  logText += `  * Fillers: ${recordingState.categoryCounts.fillers}\n`;
  logText += `  * Brainrot Slang: ${recordingState.categoryCounts.brainrot}\n`;
  logText += `  * Corporate Jargon: ${recordingState.categoryCounts.corporate}\n`;
  logText += `  * Custom Words: ${recordingState.categoryCounts.custom}\n\n`;
  
  logText += `[TOP OFFENDING WORDS]\n`;
  const sorted = Object.entries(recordingState.offendingWords).sort((a, b) => b[1].count - a[1].count);
  if (sorted.length > 0) {
    sorted.forEach(([word, info]) => {
      logText += ` - "${word}" (${info.category}): spoken ${info.count} times\n`;
    });
  } else {
    logText += ` No offending words used! Excellent communication.\n`;
  }
  logText += `\n`;
  
  logText += `[TIMELINE & TRANSLATIONS LOG]\n`;
  if (recordingState.historyLog.length > 0) {
    [...recordingState.historyLog].reverse().forEach(log => {
      logText += ` [${log.timestamp}] Spoke "${log.word}" (${log.category}) -> Suggested: ${log.replacement}\n`;
    });
  } else {
    logText += ` No corrections recorded.\n`;
  }
  logText += `\n`;
  
  logText += `[FULL TRANSCRIPTION]\n`;
  logText += finalTranscriptBuffer ? finalTranscriptBuffer.trim() : "No transcript recorded.";
  logText += `\n\n======================================\n`;
  
  const blob = new Blob([logText], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `verbalist_speech_report_${Date.now()}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Canvas Waveform Animation setup
let canvas = null;
let canvasCtx = null;
let animationFrameId = null;
let wavePhase = 0;
let waveAmp = 0;
let targetWaveAmp = 0;

function initCanvasVisuals() {
  canvas = document.getElementById('visualizer');
  canvasCtx = canvas.getContext('2d');
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);
  
  animateWave();
}

function resizeCanvas() {
  if (canvas) {
    canvas.width = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }
}

function animateWave() {
  canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
  
  // Interpolation for smooth motion
  waveAmp += (targetWaveAmp - waveAmp) * 0.1;
  
  // Slowly decay target amp if recording
  if (recordingState.isRecording) {
    if (targetWaveAmp > 4) {
      targetWaveAmp -= 0.15;
    } else {
      targetWaveAmp = 4; // idle hum
    }
  } else {
    targetWaveAmp = 0; // flatline
  }
  
  wavePhase += 0.06;
  const midY = canvas.height / 2;
  const width = canvas.width;
  
  if (waveAmp > 0.05) {
    // 3 overlaying wave paths
    const waves = [
      { color: 'hsla(260, 85%, 65%, 0.45)', freq: 0.018, ampMult: 1.0, phaseOffset: 0 },
      { color: 'hsla(174, 90%, 45%, 0.35)', freq: 0.024, ampMult: 0.7, phaseOffset: Math.PI / 2.5 },
      { color: 'hsla(195, 90%, 50%, 0.25)', freq: 0.012, ampMult: 0.5, phaseOffset: -Math.PI / 3 }
    ];
    
    canvasCtx.lineWidth = 2.5;
    canvasCtx.lineCap = 'round';
    
    waves.forEach(w => {
      canvasCtx.beginPath();
      canvasCtx.strokeStyle = w.color;
      
      for (let x = 0; x < width; x += 3) {
        // Taper edges with Math.sin envelope
        const envelope = Math.sin((x / width) * Math.PI);
        const y = midY + Math.sin(x * w.freq + wavePhase + w.phaseOffset) * waveAmp * w.ampMult * envelope * 12;
        
        if (x === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }
      }
      canvasCtx.stroke();
    });
  } else {
    // Draw flat line
    canvasCtx.beginPath();
    canvasCtx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    canvasCtx.lineWidth = 1.5;
    canvasCtx.moveTo(0, midY);
    canvasCtx.lineTo(width, midY);
    canvasCtx.stroke();
  }
  
  animationFrameId = requestAnimationFrame(animateWave);
}

// Bind DOM events on document load
document.addEventListener('DOMContentLoaded', () => {
  // Load settings & render tags
  loadSettings();
  renderCustomWordsList();
  
  // Sync setting form UI
  document.getElementById('toggleFillers').checked = settings.categories.fillers;
  document.getElementById('toggleBrainrot').checked = settings.categories.brainrot;
  document.getElementById('toggleCorporate').checked = settings.categories.corporate;
  document.getElementById('toggleAudioAlert').checked = settings.audioAlert;
  document.getElementById('toggleVisualAlert').checked = settings.visualAlert;
  document.getElementById('alertVolume').value = settings.alertVolume;
  document.getElementById('languageSelect').value = settings.language;
  
  // Set initial digital timer values
  updateTimerHUD();
  
  // Init Canvas visualizer
  initCanvasVisuals();
  
  // Initialize speech engine (starts lazily or prompts permission)
  initSpeechRecognition();
  
  // Event listeners
  document.getElementById('startBtn').onclick = startSession;
  document.getElementById('stopBtn').onclick = endSession;
  document.getElementById('resetBtn').onclick = resetSession;
  document.getElementById('exportLogBtn').onclick = exportSessionLog;
  
  // Challenge mode selector cards
  document.querySelectorAll('.challenge-card').forEach(card => {
    card.onclick = (e) => {
      if (recordingState.isRecording) {
        alert("Please end the active practice session before changing challenges.");
        return;
      }
      document.querySelectorAll('.challenge-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');
      
      const mode = card.dataset.mode;
      recordingState.challengeMode = mode;
      
      if (mode === 'pitch') recordingState.challengeDuration = 60;
      else if (mode === 'interview') recordingState.challengeDuration = 120;
      else if (mode === 'presentation') recordingState.challengeDuration = 180;
      else recordingState.challengeDuration = 0;
      
      updateTimerHUD();
    };
  });
  
  // Settings Modal Handlers
  const modal = document.getElementById('settingsModal');
  document.getElementById('openSettingsBtn').onclick = () => modal.classList.add('active');
  document.getElementById('closeSettingsBtn').onclick = () => modal.classList.remove('active');
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.remove('active');
  };
  
  // Form updates
  document.getElementById('toggleFillers').onchange = (e) => {
    settings.categories.fillers = e.target.checked;
    saveSettings();
  };
  document.getElementById('toggleBrainrot').onchange = (e) => {
    settings.categories.brainrot = e.target.checked;
    saveSettings();
  };
  document.getElementById('toggleCorporate').onchange = (e) => {
    settings.categories.corporate = e.target.checked;
    saveSettings();
  };
  document.getElementById('toggleAudioAlert').onchange = (e) => {
    settings.audioAlert = e.target.checked;
    saveSettings();
  };
  document.getElementById('toggleVisualAlert').onchange = (e) => {
    settings.visualAlert = e.target.checked;
    saveSettings();
  };
  document.getElementById('alertVolume').oninput = (e) => {
    settings.alertVolume = parseFloat(e.target.value);
    saveSettings();
  };
  document.getElementById('languageSelect').onchange = (e) => {
    settings.language = e.target.value;
    saveSettings();
    if (recognition) {
      recognition.lang = settings.language;
    }
  };
  
  // Custom word addition
  document.getElementById('addCustomWordBtn').onclick = () => {
    const wordInput = document.getElementById('customWordInput');
    const repInput = document.getElementById('customReplacementInput');
    
    const word = wordInput.value.trim().toLowerCase();
    const replacement = repInput.value.trim();
    
    if (!word) {
      alert("Please enter a target word.");
      return;
    }
    
    settings.customWords[word] = replacement;
    saveSettings();
    renderCustomWordsList();
    
    wordInput.value = '';
    repInput.value = '';
  };
});
