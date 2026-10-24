let audio = null, wakeLock = null, wakeRequest = null, wakeWanted = false, speaking = false;
export function lockTouchZoom() {
  // Safari can ignore user-scalable=no. Keep one-finger scrolling and swipes.
  const prevent = event => { if (event.cancelable) event.preventDefault(); };
  for (const type of ['gesturestart', 'gesturechange']) document.addEventListener(type, prevent, { passive: false });
  document.addEventListener('touchmove', event => { if (event.touches.length > 1) prevent(event); }, { passive: false });
}
export function unlockAudio() {
  try { audio ||= new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') void audio.resume().catch(() => {}); } catch { /* Visual alarm remains available. */ }
}
export function beep() {
  if (!audio || audio.state !== 'running') return;
  try {
    [880, 1174].forEach((frequency, i) => {
      const oscillator = audio.createOscillator(), gain = audio.createGain(), start = audio.currentTime + i * .18;
      oscillator.frequency.value = frequency; oscillator.connect(gain); gain.connect(audio.destination);
      gain.gain.setValueAtTime(.001, start); gain.gain.exponentialRampToValueAtTime(.2, start + .02);
      gain.gain.exponentialRampToValueAtTime(.001, start + .25); oscillator.start(start); oscillator.stop(start + .28);
    });
  } catch { /* Audio can be suspended independently of page visibility. */ }
}
export async function keepAwake(onStatus) {
  wakeWanted = true;
  if (!navigator.wakeLock) { onStatus('Display-Wachhalten nicht unterstützt'); return; }
  if (wakeLock && !wakeLock.released) return;
  if (wakeRequest) { try { await wakeRequest; } catch { /* The first caller reports the failure. */ } return; }
  try {
    wakeRequest = navigator.wakeLock.request('screen');
    const acquired = await wakeRequest;
    if (!wakeWanted) { await acquired.release(); return; }
    wakeLock = acquired; onStatus('Display bleibt wach');
    acquired.addEventListener('release', () => { if (wakeLock === acquired) { wakeLock = null; onStatus('Display-Wachhalten pausiert'); } });
  } catch { onStatus('Display-Wachhalten nicht verfügbar'); }
  finally { wakeRequest = null; }
}
export async function releaseWake() { wakeWanted = false; try { if (wakeRequest) await wakeRequest; if (!wakeWanted) await wakeLock?.release(); } catch { /* Already released by the browser. */ } }
export function speak(text, onEnd = () => {}) {
  if (!('speechSynthesis' in window)) throw new Error('Vorlesen wird von diesem Browser nicht unterstützt.');
  window.speechSynthesis.cancel();
  if (speaking) { speaking = false; onEnd(); return; }
  const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'de-DE'; utterance.rate = .9;
  utterance.onend = utterance.onerror = () => { speaking = false; onEnd(); };
  speaking = true; window.speechSynthesis.speak(utterance);
}
export function stopSpeaking() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); speaking = false; }
export function voiceAvailable() { return !!(window.SpeechRecognition || window.webkitSpeechRecognition); }
export function listen(onCommand, onEnd) {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) throw new Error('Sprachbefehle werden hier nicht unterstützt.');
  const recognition = new Recognition(); recognition.lang = 'de-DE'; recognition.continuous = false; recognition.interimResults = false;
  recognition.onresult = event => {
    const result = event.results[0][0];
    if (result.confidence && result.confidence < .6) return;
    onCommand(result.transcript.toLocaleLowerCase('de').trim().replace(/[.!?]+$/g, ''));
  };
  recognition.onerror = () => onEnd('Spracherkennung fehlgeschlagen oder nicht erlaubt.');
  recognition.onend = () => onEnd(); recognition.start(); return recognition;
}
export function download(name, value, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([typeof value === 'string' ? value : JSON.stringify(value, null, 2)], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function shareText(text) {
  if (navigator.share) { try { await navigator.share({ title: 'CHEF', text }); return; } catch (error) { if (error.name === 'AbortError') return; } }
  if (navigator.clipboard?.writeText) { try { await navigator.clipboard.writeText(text); return; } catch { /* Download is available without clipboard permission. */ } }
  download('chef-rezept-prompt.txt', text, 'text/plain');
}
