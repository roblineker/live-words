// Lower-third cards. Edit these for your talk.
//
//   say:   words or phrases that pop the card when you say them (case does not matter).
//          Leave it empty for a card you only show by hand with the arrow keys or a clicker.
//   tag:   the small black label.
//   title: the big word.
//   sub:   the line underneath.
//   hold:  optional, milliseconds on screen (0 = stays until you hide it).
//          Without it, the "card secs" dial in the design panel (D) decides.
//
// The arrow keys and PgUp/PgDn step through the cards in this order.

export const CUE_COOLDOWN_MS = 45000;

export const CUES = [
  {
    say: ['moonshine'],
    tag: 'SPEECH MODEL',
    title: 'Moonshine',
    sub: 'open source  .  on this laptop  .  ~0.3 s voice to word',
  },
  {
    say: ['browser', 'webgpu', 'web gpu'],
    tag: 'RUNS IN',
    title: 'The browser',
    sub: 'transformers.js  .  WebGPU  .  nothing to install',
  },
  {
    say: ['creative code', 'ascii'],
    tag: 'SCENE',
    title: 'Creative code',
    sub: 'every word you say drives the picture',
  },
  {
    say: ['green screen'],
    tag: 'NOT NEEDED',
    title: 'Green screen',
    sub: 'a laptop, a mic and a browser',
  },
  {
    say: [],
    tag: 'OVER TO YOU',
    title: 'Questions?',
    sub: 'manual card: step to it with the arrow keys or a clicker',
    hold: 0,
  },
];
