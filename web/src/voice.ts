/**
 * Voice layer on the browser-native Web Speech API.
 * STT: SpeechRecognition (Chrome/Edge/Safari). TTS: speechSynthesis.
 * Zero cost, zero extra API keys — fits the BYOK philosophy.
 */

type RecognitionCtor = new () => SpeechRecognitionLike

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((e: SpeechRecognitionEventLike) => void) | null
  onend: (() => void) | null
  onerror: ((e: { error: string }) => void) | null
  start(): void
  stop(): void
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>
}

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as Record<string, unknown>
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as RecognitionCtor | null
}

export const voiceSupported = (): boolean =>
  recognitionCtor() !== null && 'speechSynthesis' in window

export class Listener {
  private rec: SpeechRecognitionLike | null = null
  private finalText = ''
  active = false

  start(onInterim: (text: string) => void): void {
    const Ctor = recognitionCtor()
    if (!Ctor) throw new Error('Speech recognition not supported in this browser')
    this.finalText = ''
    this.rec = new Ctor()
    this.rec.lang = 'en-US'
    this.rec.continuous = true
    this.rec.interimResults = true
    this.rec.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]!
        if (r.isFinal) this.finalText += r[0].transcript + ' '
        else interim += r[0].transcript
      }
      onInterim((this.finalText + interim).trim())
    }
    // Some browsers auto-stop on silence; restart while the mic is meant to be open.
    this.rec.onend = () => {
      if (this.active) this.rec?.start()
    }
    this.rec.onerror = () => {}
    this.active = true
    this.rec.start()
  }

  stop(): string {
    this.active = false
    this.rec?.stop()
    this.rec = null
    return this.finalText.trim()
  }
}

export function speak(text: string, onDone?: () => void): void {
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.05
  const voices = window.speechSynthesis.getVoices()
  const preferred = voices.find((v) => v.lang.startsWith('en') && v.localService) ?? voices[0]
  if (preferred) utterance.voice = preferred
  if (onDone) utterance.onend = onDone
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking(): void {
  window.speechSynthesis.cancel()
}
