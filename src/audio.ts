export type SoundKind = 'feed' | 'scrub' | 'collect' | 'reveal';
export interface AquariumAudio {
  play(kind: SoundKind): void;
  setMuted(muted: boolean): void;
  suspend(): void;
  dispose(): void;
}

/** Quiet, generated water and glass sounds. No context exists before a real gesture. */
export function createAudio(): AquariumAudio {
  let context: AudioContext | null = null, output: GainNode | null = null, noise: AudioBuffer | null = null;
  let muted = false, disposed = false;
  const voices = new Set<{ source: AudioScheduledSourceNode; gain: GainNode; filter?: BiquadFilterNode }>();
  const lastPlayed: Record<SoundKind, number> = { feed: -Infinity, scrub: -Infinity, collect: -Infinity, reveal: -Infinity };
  const cooldown: Record<SoundKind, number> = { feed: .07, scrub: .14, collect: .12, reveal: .6 };
  function stopVoices(): void {
    for (const voice of voices) {
      try { voice.source.stop(); } catch { /* An ended source is already silent. */ }
      voice.source.disconnect(); voice.gain.disconnect(); voice.filter?.disconnect();
    }
    voices.clear();
  }
  function unlock(event: Event): void {
    if (disposed || muted || !event.isTrusted) return;
    if (!context) {
      try {
        context = new AudioContext();
        output = context.createGain(); output.gain.value = .16; output.connect(context.destination);
        noise = context.createBuffer(1, Math.ceil(context.sampleRate * .4), context.sampleRate);
        const samples = noise.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      } catch { return; }
    }
    if (context.state === 'suspended') void context.resume().catch(() => { /* Audio stays optional when browser policy blocks it. */ });
  }
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });
  return {
    play(kind) {
      if (disposed || muted || !context || !output || context.state !== 'running') return;
      const now = context.currentTime;
      if (now - lastPlayed[kind] < cooldown[kind]) return;
      lastPlayed[kind] = now;
      const addVoice = (frequency: number, delay: number, duration: number, volume: number, watery: boolean) => {
        if (!context || !output || voices.size >= 6) return;
        const gain = context.createGain(), at = now + delay;
        gain.gain.setValueAtTime(.0001, at);
        gain.gain.exponentialRampToValueAtTime(volume, at + .012);
        gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
        gain.connect(output);
        let source: AudioScheduledSourceNode, filter: BiquadFilterNode | undefined;
        if (watery && noise) {
          const water = context.createBufferSource(); water.buffer = noise;
          filter = context.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = kind === 'scrub' ? .7 : 4;
          filter.frequency.setValueAtTime(frequency, at); filter.frequency.exponentialRampToValueAtTime(frequency * .45, at + duration);
          water.connect(filter); filter.connect(gain); source = water;
        } else {
          const tone = context.createOscillator(); tone.type = 'sine';
          tone.frequency.setValueAtTime(frequency, at); tone.frequency.exponentialRampToValueAtTime(frequency * .96, at + duration);
          tone.connect(gain); source = tone;
        }
        const voice = { source, gain, filter }; voices.add(voice);
        source.addEventListener('ended', () => { source.disconnect(); gain.disconnect(); filter?.disconnect(); voices.delete(voice); }, { once: true });
        source.start(at); source.stop(at + duration + .02);
      };
      if (kind === 'feed') { addVoice(1150, 0, .17, .6, true); addVoice(680, .045, .16, .23, false); }
      else if (kind === 'scrub') addVoice(1550, 0, .15, .23, true);
      else if (kind === 'collect') { addVoice(783.99, 0, .15, .4, false); addVoice(1174.66, .065, .2, .3, false); }
      else { addVoice(523.25, 0, .3, .3, false); addVoice(659.25, .12, .3, .28, false); addVoice(783.99, .24, .45, .25, false); }
    },
    setMuted(next) {
      muted = next;
      if (muted) {
        stopVoices();
        if (context && output) { output.gain.cancelScheduledValues(context.currentTime); output.gain.setValueAtTime(0, context.currentTime); }
      } else if (context && output) output.gain.setValueAtTime(.16, context.currentTime);
    },
    suspend() { stopVoices(); if (context?.state === 'running') void context.suspend().catch(() => {}); },
    dispose() {
      disposed = true; stopVoices();
      document.removeEventListener('pointerdown', unlock, { capture: true }); document.removeEventListener('keydown', unlock, { capture: true });
      if (context) void context.close().catch(() => {});
      context = null; output = null; noise = null;
    },
  };
}
