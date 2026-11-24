class VoicePcmCapture extends AudioWorkletProcessor {
  #enabled = false;
  #credits = 4;
  #remaining = sampleRate;
  #sum = 0;
  #frame = new DataView(new ArrayBuffer(640));
  #offset = 0;
  #energy = 0;

  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data === 'start') this.#enabled = true;
      if (data === 'ack') this.#credits = Math.min(4, this.#credits + 1);
      if (data === 'pause') {
        this.#enabled = false;
        this.#remaining = sampleRate;
        this.#sum = this.#offset = this.#energy = 0;
      }
    };
  }

  process(inputs) {
    // Leave the connected output silent. It keeps the capture graph active.
    const mono = inputs[0]?.[0];
    if (!this.#enabled || !mono) return true;
    for (const value of mono) {
      // In these units an input sample spans 16000 ticks and an output sample
      // spans sampleRate ticks. Preserve fractional overlap between render blocks.
      let ticks = 16000;
      while (ticks > 0) {
        const overlap = Math.min(ticks, this.#remaining);
        this.#sum += value * overlap;
        ticks -= overlap;
        this.#remaining -= overlap;
        if (this.#remaining === 0) {
          this.#write(this.#sum / sampleRate);
          this.#remaining = sampleRate;
          this.#sum = 0;
        }
      }
    }
    return true;
  }

  #write(value) {
    const x = Math.max(-1, Math.min(1, value));
    const scaled = x < 0 ? x * 32768 : x * 32767;
    this.#frame.setInt16(this.#offset, Math.round(scaled), true);
    this.#offset += 2;
    this.#energy += x * x;
    if (this.#offset !== 640) return;

    // When the main thread stalls, drop frames instead of queuing old speech.
    if (this.#credits > 0) {
      this.#credits--;
      const pcm = this.#frame.buffer;
      this.#frame = new DataView(new ArrayBuffer(640));
      this.port.postMessage({ pcm, level: Math.sqrt(this.#energy / 320) }, [pcm]);
    }
    this.#offset = 0;
    this.#energy = 0;
  }
}

registerProcessor('voice-pcm-capture', VoicePcmCapture);
