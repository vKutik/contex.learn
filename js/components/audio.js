/* audio.js - the one place that makes a word audible.
 *
 * Every word has a real human recording taken from Wiktionary (see
 * js/data/pronunciation.js and the audio/ folder). A robot voice reading
 * an IPA-less string is not a pronunciation model, so the recording is
 * what plays; SpeechSynthesis only stands in when a file is missing or
 * the browser refuses to play it.
 */
import { pronunciations } from '../data/pronunciation.js';
import { track } from '../telemetry.js';

/* One <audio> per word, kept so a second tap replays instantly. */
const clips = new Map();
let playing = null;

/** The robot fallback, and what the very first release used everywhere. */
const speak = text => {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US'; u.rate = .85;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
  } catch(e){}
};

function stopAudio(){
  if(playing){ playing.pause(); playing.currentTime = 0; playing = null; }
  try { speechSynthesis.cancel(); } catch(e){}
}

/**
 * Say a word out loud: the recording if there is one, the robot if not.
 * @param {number} wordId
 * @param {string} text  what to fall back to reading
 */
export function say(wordId, text){
  track('say', { w: wordId });
  const rec = pronunciations[wordId];
  if(!rec) return speak(text);

  let clip = clips.get(wordId);
  if(!clip){
    clip = new Audio(rec.src);
    clip.preload = 'none';
    clips.set(wordId, clip);
  }

  stopAudio();
  playing = clip;
  clip.currentTime = 0;
  // play() rejects on a missing file or a blocked autoplay gesture
  const started = clip.play();
  if(started && started.catch) started.catch(() => {
    playing = null; speak(text);
    track('audio_fail', { w: wordId });
  });
}
