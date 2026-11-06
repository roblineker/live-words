// Collects audio into 512-sample frames at 16 kHz and posts them to the page.
// The AudioContext runs at the device's native rate (phones refuse a forced 16 kHz),
// so this averages blocks of input samples down to 16 kHz. Averaging doubles as a
// simple low-pass filter, which is plenty for speech.
const FRAME = 512;
const TARGET_RATE = 16000;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(FRAME);
    this.n = 0;
    this.step = sampleRate / TARGET_RATE; // input samples per output sample
    this.phase = 0;
    this.acc = 0;
    this.count = 0;
  }

  emit(v) {
    this.buf[this.n++] = v;
    if (this.n === FRAME) {
      this.port.postMessage(this.buf.slice(0));
      this.n = 0;
    }
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (this.step === 1) {
      for (let i = 0; i < ch.length; i++) this.emit(ch[i]);
      return true;
    }
    for (let i = 0; i < ch.length; i++) {
      this.acc += ch[i];
      this.count++;
      this.phase += 1;
      if (this.phase >= this.step) {
        this.phase -= this.step;
        this.emit(this.acc / this.count);
        this.acc = 0;
        this.count = 0;
      }
    }
    return true;
  }
}

registerProcessor('capture', CaptureProcessor);
