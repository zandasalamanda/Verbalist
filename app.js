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
    informal: 0,
    jargon: 0,
    weak: 0,
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
    informal: true,
    jargon: true,
    weak: true
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
      if (!settings.categories) settings.categories = { fillers: true, informal: true, jargon: true, weak: true };
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

// Respect the OS "reduce motion" setting for the waveform and detection flash.
const reduceMotionQuery = window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)')
  : { matches: false };
const prefersReducedMotion = () => reduceMotionQuery.matches;

// Initialize Speech Recognition
function initSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  
  if (!SpeechRecognition) {
    const viewport = document.getElementById('transcriptionViewport');
    viewport.innerHTML = `<div class="transcript-notice">
      <span class="notice-icon"><i class="fa-solid fa-triangle-exclamation"></i></span>
      <p class="notice-title">This browser can't transcribe speech</p>
      <p class="notice-hint">Verbalist needs the Web Speech API. Open it in Chrome, Edge or Safari to start a session.</p>
    </div>`;
    document.getElementById('startBtn').disabled = true;
    return false;
  }

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 3;
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
    alertIcon.className = 'fa-solid fa-microphone-lines';
    alertTitle.textContent = 'Listening';
    alertMessage.textContent = 'Speak naturally. Verbalist is monitoring in real time.';
    
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
      viewport.innerHTML = `<div class="transcript-notice">
        <span class="notice-icon"><i class="fa-solid fa-microphone-slash"></i></span>
        <p class="notice-title">Microphone access is blocked</p>
        <p class="notice-hint">Allow microphone access for this site in your browser settings, then reload the page.</p>
      </div>`;
      endSession();
    }
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    
    // Animate visualizer wave slightly on speech input
    targetWaveAmp = 18;
    
    for (let i = event.resultIndex; i < event.results.length; ++i) {
      // Pick highest confidence alternative
      let bestAlt = event.results[i][0];
      for (let a = 1; a < event.results[i].length; a++) {
        if (event.results[i][a].confidence > bestAlt.confidence) {
          bestAlt = event.results[i][a];
        }
      }
      
      const transcriptChunk = bestAlt.transcript;
      
      if (event.results[i].isFinal) {
        // Update confidence display
        updateConfidenceDisplay(bestAlt.confidence);
        
        // Append to buffer and parse
        finalTranscriptBuffer += transcriptChunk + ' ';
        processFinalText(transcriptChunk);
        
        // Run sentence analysis
        analyzeSentence(transcriptChunk);
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
  if (settings.categories.informal) {
    for (const [word, replacement] of Object.entries(WORD_DICTIONARY.informal.words)) {
      active[word.toLowerCase()] = { category: 'informal', replacement };
    }
  }
  if (settings.categories.jargon) {
    for (const [word, replacement] of Object.entries(WORD_DICTIONARY.jargon.words)) {
      active[word.toLowerCase()] = { category: 'jargon', replacement };
    }
  }
  if (settings.categories.weak) {
    for (const [word, replacement] of Object.entries(WORD_DICTIONARY.weak.words)) {
      active[word.toLowerCase()] = { category: 'weak', replacement };
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
  let label = 'Filler word';

  if (category === 'informal') {
    color = 'var(--color-informal)';
    glow = 'var(--color-informal-glow)';
    label = 'Informal language';
  } else if (category === 'jargon') {
    color = 'var(--color-jargon)';
    glow = 'var(--color-jargon-glow)';
    label = 'Overused jargon';
  } else if (category === 'weak') {
    color = 'var(--color-weak)';
    glow = 'var(--color-weak-glow)';
    label = 'Weak phrasing';
  } else if (category === 'custom') {
    color = 'var(--accent)';
    glow = 'var(--accent-glow)';
    label = 'Your word';
  }
  
  // Update CSS custom properties of alert banner
  banner.style.setProperty('--alert-color', color);
  banner.style.setProperty('--alert-color-glow', glow);
  banner.classList.add('alert-active');
  
  alertIcon.className = 'fa-solid fa-triangle-exclamation';
  alertTitle.textContent = label;
  
  const textReplacement = replacement === '[omit]' ? 'omit it' : `try <span class="replacement-word">${replacement}</span>`;
  alertMessage.innerHTML = `Instead of saying <span class="flagged-word">"${word}"</span>, ${textReplacement}.`;
  
  // Flash the console in the category colour
  if (settings.visualAlert && !prefersReducedMotion()) {
    const consolePanel = document.getElementById('transcriptionPanel');
    consolePanel.classList.add('shake-container');
    setTimeout(() => {
      consolePanel.classList.remove('shake-container');
    }, 600);
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
      alertIcon.className = 'fa-solid fa-microphone-lines';
      alertTitle.textContent = 'Listening';
      alertMessage.textContent = 'Nothing flagged right now. Keep going.';
    } else {
      alertIcon.className = 'fa-solid fa-circle-check';
      alertTitle.textContent = 'Coach';
      alertMessage.textContent = 'Start a session and flagged words appear here with a stronger alternative.';
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
    
    if (category === 'informal') {
      // Subtle low buzz for informal language
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
    } else if (category === 'jargon') {
      // Clean descending ping for jargon
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(800, synthAudioContext.currentTime);
      osc.frequency.exponentialRampToValueAtTime(300, synthAudioContext.currentTime + 0.15);
      
      osc.connect(gainNode);
      gainNode.connect(synthAudioContext.destination);
      
      osc.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, synthAudioContext.currentTime + 0.18);
      osc.stop(synthAudioContext.currentTime + 0.2);
    } else if (category === 'weak') {
      // Soft double-tap for weak phrasing
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, synthAudioContext.currentTime); // A4
      osc.frequency.setValueAtTime(392, synthAudioContext.currentTime + 0.12); // G4
      
      osc.connect(gainNode);
      gainNode.connect(synthAudioContext.destination);
      
      osc.start();
      gainNode.gain.exponentialRampToValueAtTime(0.01, synthAudioContext.currentTime + 0.3);
      osc.stop(synthAudioContext.currentTime + 0.32);
    } else {
      // Default filler word: soft clean bell sound
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
  // Starts at 100%. Each filler word: -3%; informal: -4%; jargon: -2%; weak: -4%; custom: -3%
  let scoreDeduction = 
    (recordingState.categoryCounts.fillers * 3) +
    (recordingState.categoryCounts.informal * 4) +
    (recordingState.categoryCounts.jargon * 2) +
    (recordingState.categoryCounts.weak * 4) +
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

  // Drives the meter rule beneath the number (see .score-number::after)
  scoreEl.style.setProperty('--score', recordingState.score);
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
  document.getElementById('count-informal').textContent = recordingState.categoryCounts.informal;
  document.getElementById('count-jargon').textContent = recordingState.categoryCounts.jargon;
  document.getElementById('count-weak').textContent = recordingState.categoryCounts.weak;
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
    if (info.category === 'informal') barColor = 'var(--color-informal)';
    else if (info.category === 'jargon') barColor = 'var(--color-jargon)';
    else if (info.category === 'weak') barColor = 'var(--color-weak)';
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
    if (log.category === 'informal') borderCol = 'var(--color-informal)';
    else if (log.category === 'jargon') borderCol = 'var(--color-jargon)';
    else if (log.category === 'weak') borderCol = 'var(--color-weak)';
    else if (log.category === 'custom') borderCol = 'var(--accent)';
    
    item.style.borderLeftColor = borderCol;
    
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
  
  showToast(`Session Complete! Score: ${recordingState.score}% | Words: ${recordingState.totalWords} | Flagged: ${recordingState.flaggedCount} — ${rating}`, 'success');
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
  recordingState.categoryCounts = { fillers: 0, informal: 0, jargon: 0, weak: 0, custom: 0 };
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
  
  document.getElementById('challengeStatus').textContent = mode === 'free' ? 'Free practice' : 'Timed';
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
  
  document.getElementById('challengeStatus').textContent = 'Off';
  document.getElementById('challengeStatus').style.color = 'var(--text-muted)';
  
  // Update final status message
  const alertIcon = document.getElementById('alertIcon');
  const alertTitle = document.getElementById('alertTitle');
  const alertMessage = document.getElementById('alertMessage');
  alertIcon.className = 'fa-solid fa-circle-check';
  alertTitle.textContent = 'Session ended';
  alertMessage.innerHTML = `Speech integrity finished at <span class="replacement-word">${recordingState.score}%</span>. The breakdown is below.`;
}

function resetSession() {
  endSession();
  
  finalTranscriptBuffer = '';
  document.getElementById('transcriptionViewport').innerHTML = '';
  
  recordingState.totalWords = 0;
  recordingState.flaggedCount = 0;
  recordingState.score = 100;
  recordingState.categoryCounts = { fillers: 0, informal: 0, jargon: 0, weak: 0, custom: 0 };
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
  alertTitle.textContent = 'Coach';
  alertMessage.textContent = 'Start a session and flagged words appear here with a stronger alternative.';
}

// Custom word management
function renderCustomWordsList() {
  const container = document.getElementById('customWordsList');
  container.innerHTML = '';
  
  const words = Object.entries(settings.customWords);
  if (words.length === 0) {
    container.innerHTML = `<span class="empty-note">No words of your own yet.</span>`;
    return;
  }
  
  words.forEach(([word, replacement]) => {
    const tag = document.createElement('div');
    tag.className = 'custom-word-tag';
    tag.innerHTML = `
      <span><strong>${word}</strong> &rarr; ${replacement || '[omit]'}</span>
      <button type="button" class="remove-tag-btn" data-word="${word}" aria-label="Remove ${word}">&times;</button>
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
    showToast('Nothing to export. Record a speech session first.', 'warning');
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
  logText += `  * Informal Language: ${recordingState.categoryCounts.informal}\n`;
  logText += `  * Overused Jargon: ${recordingState.categoryCounts.jargon}\n`;
  logText += `  * Weak Phrasing: ${recordingState.categoryCounts.weak}\n`;
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
  if (!canvas) return;
  // Back the canvas with the device pixel ratio so the trace stays crisp on
  // retina displays, and keep drawing in CSS pixels.
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.parentElement.clientWidth;
  const h = canvas.parentElement.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  canvasCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function animateWave() {
  const cssWidth = canvas.clientWidth;
  const cssHeight = canvas.clientHeight;
  canvasCtx.clearRect(0, 0, cssWidth, cssHeight);

  if (prefersReducedMotion()) {
    // Hold a steady level rather than animating amplitude.
    targetWaveAmp = recordingState.isRecording ? 4 : 0;
    waveAmp = targetWaveAmp;
  } else {
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
  }

  // Hold the trace still when the user has asked for reduced motion; the level
  // is still shown, it just does not travel.
  if (!prefersReducedMotion()) {
    wavePhase += 0.06;
  }

  const midY = cssHeight / 2;
  const width = cssWidth;
  const baseline = 'rgba(174, 184, 196, 0.14)';

  // Draw the centre line first — it reads as the zero level of a meter.
  canvasCtx.beginPath();
  canvasCtx.strokeStyle = baseline;
  canvasCtx.lineWidth = 1;
  canvasCtx.moveTo(0, midY + 0.5);
  canvasCtx.lineTo(width, midY + 0.5);
  canvasCtx.stroke();

  if (waveAmp > 0.05) {
    // Three traces in the interface greys, plus the live red on the leading
    // one — same restraint as the rest of the console.
    const waves = [
      { color: 'rgba(255, 74, 61, 0.55)',    freq: 0.018, ampMult: 1.0, phaseOffset: 0 },
      { color: 'rgba(237, 241, 245, 0.30)',  freq: 0.024, ampMult: 0.7, phaseOffset: Math.PI / 2.5 },
      { color: 'rgba(174, 184, 196, 0.18)',  freq: 0.012, ampMult: 0.5, phaseOffset: -Math.PI / 3 }
    ];

    canvasCtx.lineWidth = 1.75;
    canvasCtx.lineCap = 'round';
    canvasCtx.lineJoin = 'round';

    // Scale the trace to the box so it never clips into hard corners.
    const ampScale = (midY - 3) / 18;

    waves.forEach(w => {
      canvasCtx.beginPath();
      canvasCtx.strokeStyle = w.color;

      for (let x = 0; x <= width; x += 2) {
        // Taper edges with Math.sin envelope
        const envelope = Math.sin((x / width) * Math.PI);
        const y = midY + Math.sin(x * w.freq + wavePhase + w.phaseOffset) * waveAmp * w.ampMult * envelope * ampScale;

        if (x === 0) {
          canvasCtx.moveTo(x, y);
        } else {
          canvasCtx.lineTo(x, y);
        }
      }
      canvasCtx.stroke();
    });
  }

  animationFrameId = requestAnimationFrame(animateWave);
}

// Toast Notification System (replaces native alert() calls)
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  
  let icon = 'fa-circle-info';
  if (type === 'warning') icon = 'fa-triangle-exclamation';
  else if (type === 'success') icon = 'fa-circle-check';
  else if (type === 'error') icon = 'fa-circle-xmark';
  
  toast.innerHTML = `
    <i class="fa-solid ${icon}"></i>
    <span>${message}</span>
  `;
  
  container.appendChild(toast);
  
  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  
  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Confidence tracking for speech recognition
let lastConfidence = 0;
function updateConfidenceDisplay(confidence) {
  lastConfidence = confidence;
  const confEl = document.getElementById('confidenceValue');
  const confBar = document.getElementById('confidenceBar');
  if (confEl) {
    const pct = Math.round(confidence * 100);
    confEl.textContent = pct + '%';
    if (confBar) {
      confBar.style.width = pct + '%';
      if (confBar.parentElement) confBar.parentElement.setAttribute('aria-valuenow', pct);
    }
    
    // Colour by confidence level: good / caution / poor
    if (pct >= 85) {
      confEl.style.color = 'var(--good)';
      if (confBar) confBar.style.background = 'var(--good)';
    } else if (pct >= 60) {
      confEl.style.color = 'var(--warn)';
      if (confBar) confBar.style.background = 'var(--warn)';
    } else {
      confEl.style.color = 'var(--live)';
      if (confBar) confBar.style.background = 'var(--live)';
    }
  }
}

// Sentence Analysis Engine
let sentenceBuffer = [];
let sentenceIssues = [];

function analyzeSentence(text) {
  const issues = [];
  const words = text.trim().split(/\s+/).filter(w => w.length > 0);
  const wordCount = words.length;
  
  // Check for run-on sentence (overly long without natural breaks)
  if (wordCount > 40) {
    issues.push({
      type: 'run-on',
      severity: 'warning',
      message: `Long sentence detected (${wordCount} words). Consider breaking into shorter, clearer statements.`,
      suggestion: 'Use pauses and break complex ideas into 15-25 word sentences for maximum clarity.'
    });
  }
  
  // Check for excessive filler density
  const activeDict = getActiveDictionary();
  const lowerText = text.toLowerCase();
  let fillerCount = 0;
  for (const key of Object.keys(activeDict)) {
    if (activeDict[key].category === 'fillers') {
      const regex = new RegExp(`\\b${key}\\b`, 'gi');
      const matches = lowerText.match(regex);
      if (matches) fillerCount += matches.length;
    }
  }
  
  if (wordCount > 5 && fillerCount / wordCount > 0.2) {
    issues.push({
      type: 'filler-density',
      severity: 'caution',
      message: `High filler density: ${fillerCount} filler words in ${wordCount} words (${Math.round(fillerCount/wordCount*100)}%).`,
      suggestion: 'Slow down and embrace silence instead of filling gaps with placeholder words.'
    });
  }
  
  // Check for repeated words (stuttering/uncertainty pattern)
  for (let i = 0; i < words.length - 1; i++) {
    if (words[i].toLowerCase() === words[i+1].toLowerCase() && words[i].length > 2) {
      issues.push({
        type: 'repetition',
        severity: 'info',
        message: `Repeated word "${words[i]}" detected — may indicate hesitation.`,
        suggestion: 'Pause and collect your thoughts before continuing.'
      });
      break; // Only flag once per chunk
    }
  }
  
  if (issues.length > 0) {
    sentenceIssues.unshift(...issues);
    // Keep only last 20 issues
    if (sentenceIssues.length > 20) sentenceIssues = sentenceIssues.slice(0, 20);
    renderSentenceAnalysis();
  }
}

function renderSentenceAnalysis() {
  const container = document.getElementById('sentenceAnalysis');
  if (!container) return;
  
  container.innerHTML = '';
  
  if (sentenceIssues.length === 0) return;
  
  sentenceIssues.forEach(issue => {
    const item = document.createElement('div');
    item.className = `sentence-issue severity-${issue.severity}`;
    
    let icon = 'fa-circle-info';
    if (issue.severity === 'warning') icon = 'fa-triangle-exclamation';
    else if (issue.severity === 'caution') icon = 'fa-bolt';
    
    item.innerHTML = `
      <div class="issue-header">
        <i class="fa-solid ${icon}"></i>
        <span class="issue-type">${issue.type.replace('-', ' ')}</span>
      </div>
      <p class="issue-message">${issue.message}</p>
      <p class="issue-suggestion"><i class="fa-solid fa-lightbulb"></i> ${issue.suggestion}</p>
    `;
    container.appendChild(item);
  });
}

// Bind DOM events on document load
document.addEventListener('DOMContentLoaded', () => {
  // Load settings & render tags
  loadSettings();
  renderCustomWordsList();
  
  // Sync setting form UI
  document.getElementById('toggleFillers').checked = settings.categories.fillers;
  document.getElementById('toggleInformal').checked = settings.categories.informal;
  document.getElementById('toggleJargon').checked = settings.categories.jargon;
  document.getElementById('toggleWeak').checked = settings.categories.weak;
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
        showToast('Please end the active session before switching modes.', 'warning');
        return;
      }
      document.querySelectorAll('.challenge-card').forEach(c => {
        c.classList.remove('active');
        c.setAttribute('aria-pressed', 'false');
      });
      card.classList.add('active');
      card.setAttribute('aria-pressed', 'true');

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
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const closeSettingsBtn = document.getElementById('closeSettingsBtn');

  const openSettings = () => {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    closeSettingsBtn.focus();
  };
  const closeSettings = () => {
    if (!modal.classList.contains('active')) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    openSettingsBtn.focus();
  };

  openSettingsBtn.onclick = openSettings;
  closeSettingsBtn.onclick = closeSettings;
  modal.onclick = (e) => {
    if (e.target === modal) closeSettings();
  };
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeSettings();
  });
  
  // Form updates
  document.getElementById('toggleFillers').onchange = (e) => {
    settings.categories.fillers = e.target.checked;
    saveSettings();
  };
  document.getElementById('toggleInformal').onchange = (e) => {
    settings.categories.informal = e.target.checked;
    saveSettings();
  };
  document.getElementById('toggleJargon').onchange = (e) => {
    settings.categories.jargon = e.target.checked;
    saveSettings();
  };
  document.getElementById('toggleWeak').onchange = (e) => {
    settings.categories.weak = e.target.checked;
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
      showToast('Please enter a target word.', 'warning');
      return;
    }
    
    settings.customWords[word] = replacement;
    saveSettings();
    renderCustomWordsList();
    
    wordInput.value = '';
    repInput.value = '';
  };
});
