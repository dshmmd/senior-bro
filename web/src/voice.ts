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

export const voiceSupported = (): boolean => recognitionCtor() !== null && 'speechSynthesis' in window

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
    this.rec.onerror = () => undefined
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

/**
 * Push-to-talk mic capture for server-side transcription (R30): record to a Blob, upload it,
 * get a transcript back. Unlike `Listener` there's no live interim text — the caller shows a
 * brief "transcribing…" state between stop() and the transcript arriving.
 */
export const recordingSupported = (): boolean =>
  'mediaDevices' in navigator && typeof MediaRecorder !== 'undefined'

export class Recorder {
  private media: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  active = false

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    this.chunks = []
    this.media = new MediaRecorder(this.stream)
    this.media.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data)
    }
    this.active = true
    this.media.start()
  }

  /** Stop recording and resolve with the captured audio, or null if nothing was recorded. */
  stop(): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.active = false
      const media = this.media
      if (!media) return resolve(null)
      media.onstop = () => {
        this.stream?.getTracks().forEach((t) => t.stop())
        this.stream = null
        this.media = null
        resolve(this.chunks.length ? new Blob(this.chunks, { type: media.mimeType || 'audio/webm' }) : null)
      }
      media.stop()
    })
  }
}

/**
 * Convert a MediaRecorder blob (WebM/Opus on Chrome, MP4/AAC on Safari) to 16-kHz mono
 * 16-bit PCM WAV. Transcription gateways (Arvan's GPT-4o-Transcribe rejects WebM with
 * "Audio file might be corrupted or unsupported") reliably accept WAV, and 16 kHz mono
 * is all speech models need — it also shrinks the upload. Decode failures throw; the
 * caller falls back to uploading the original blob.
 */
export async function toWav(blob: Blob): Promise<Blob> {
  const raw = await blob.arrayBuffer()
  const probe = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await probe.decodeAudioData(raw)
  } finally {
    void probe.close()
  }
  const rate = 16000
  const frames = Math.max(1, Math.ceil(decoded.duration * rate))
  // OfflineAudioContext(1, …) downmixes to mono and resamples in one render pass.
  const offline = new OfflineAudioContext(1, frames, rate)
  const src = offline.createBufferSource()
  src.buffer = decoded
  src.connect(offline.destination)
  src.start()
  const rendered = await offline.startRendering()
  return encodeWav16(rendered.getChannelData(0), rate)
}

/** Minimal RIFF/WAVE encoder: mono 16-bit PCM. */
function encodeWav16(samples: Float32Array, rate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2)
  const v = new DataView(buf)
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i))
  }
  str(0, 'RIFF')
  v.setUint32(4, 36 + samples.length * 2, true)
  str(8, 'WAVE')
  str(12, 'fmt ')
  v.setUint32(16, 16, true) // fmt chunk size
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, 1, true) // mono
  v.setUint32(24, rate, true)
  v.setUint32(28, rate * 2, true) // byte rate
  v.setUint16(32, 2, true) // block align
  v.setUint16(34, 16, true) // bits per sample
  str(36, 'data')
  v.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return new Blob([buf], { type: 'audio/wav' })
}

function makeUtterance(text: string): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1.05
  const voices = window.speechSynthesis.getVoices()
  const preferred = voices.find((v) => v.lang.startsWith('en') && v.localService) ?? voices[0]
  if (preferred) utterance.voice = preferred
  return utterance
}

export function speak(text: string, onDone?: () => void): void {
  window.speechSynthesis.cancel()
  const utterance = makeUtterance(text)
  if (onDone) utterance.onend = onDone
  window.speechSynthesis.speak(utterance)
}

export function stopSpeaking(): void {
  window.speechSynthesis.cancel()
}

/**
 * Sentence-by-sentence TTS for streamed replies: feed it raw text deltas,
 * it speaks each completed sentence while the rest is still arriving.
 */
export class Speaker {
  private buffer = ''

  push(delta: string): void {
    this.buffer += delta
    // flush complete sentences; keep the partial tail buffered
    const re = /[^.!?\n]*[.!?\n]+/g
    let consumed = 0
    let match: RegExpExecArray | null
    while ((match = re.exec(this.buffer)) !== null) {
      const sentence = match[0].replace('[INTERVIEW_COMPLETE]', '').trim()
      if (sentence) window.speechSynthesis.speak(makeUtterance(sentence))
      consumed = re.lastIndex
    }
    this.buffer = this.buffer.slice(consumed)
  }

  /** Speak whatever is left (end of stream). */
  flush(): void {
    const rest = this.buffer.replace('[INTERVIEW_COMPLETE]', '').trim()
    this.buffer = ''
    if (rest) window.speechSynthesis.speak(makeUtterance(rest))
  }

  cancel(): void {
    this.buffer = ''
    window.speechSynthesis.cancel()
  }
}
