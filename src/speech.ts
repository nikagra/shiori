// Japanese text-to-speech with the device's built-in voices (free, no network).
// iPhone and Mac ship Japanese voices; the reading (kana) is spoken because
// kanji alone can be read more than one way.

function japaneseVoice(): SpeechSynthesisVoice | undefined {
  if (!('speechSynthesis' in window)) return undefined;
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.replace('_', '-').startsWith('ja'));
  return voices.find((v) => v.localService) ?? voices[0];
}

export function canSpeak(): boolean {
  return 'speechSynthesis' in window;
}

export function hasJapaneseVoice(): boolean {
  return japaneseVoice() !== undefined;
}

export function speak(text: string): void {
  if (!canSpeak()) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ja-JP';
  const voice = japaneseVoice();
  if (voice) u.voice = voice;
  u.rate = 0.9;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(u);
}
