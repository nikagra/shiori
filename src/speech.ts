// Japanese text-to-speech with the device's built-in voices (free, no network).
// iPhone and Mac ship Japanese voices; the reading (kana) is spoken because
// kanji alone can be read more than one way.

// macOS lists novelty voices (Eddy, Grandma, Rocko…) as Japanese too; these
// are the natural ones, best first.
const PREFERRED = ['Kyoko', 'Otoya', 'O-Ren', 'Hattori', 'Google 日本語'];

function japaneseVoice(): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith('ja'));
  for (const name of PREFERRED) {
    const v = voices.find((x) => x.name.startsWith(name));
    if (v) return v;
  }
  return voices.find((v) => v.default) ?? voices.find((v) => v.localService) ?? voices[0];
}

export function canSpeak(): boolean {
  return 'speechSynthesis' in window;
}

export function hasJapaneseVoice(): boolean {
  return japaneseVoice() !== undefined;
}

/** Call from a tap or key press: iOS only lets a page start speech from one. */
export function speak(text: string): void {
  if (!canSpeak()) return;
  const synth = window.speechSynthesis;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  // Voices can load late on iOS; with none chosen, lang alone picks one.
  const voice = japaneseVoice();
  if (voice) u.voice = voice;
  u.rate = 0.9;
  // Safari on iOS can drop an utterance queued right after cancel(), so only
  // cancel when something is actually playing, and wake a stuck queue.
  if (synth.speaking || synth.pending) synth.cancel();
  synth.resume();
  synth.speak(u);
}
