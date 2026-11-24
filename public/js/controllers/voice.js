// @ts-check

/**
 * Minimal shape of the Web Speech API recogniser we use.
 * @typedef {{
 *   lang: string,
 *   interimResults: boolean,
 *   maxAlternatives: number,
 *   start(): void,
 *   stop(): void,
 *   onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null,
 *   onend: (() => void) | null,
 *   onerror: (() => void) | null,
 * }} Recogniser
 * @typedef {new () => Recogniser} RecogniserConstructor
 * @typedef {{
 *   button: HTMLButtonElement,
 *   input: HTMLTextAreaElement,
 *   onTranscript: (text: string) => void,
 *   setStatus: (message: string, kind?: 'info' | 'error') => void,
 *   Recognition: RecogniserConstructor | null | undefined,
 * }} VoiceOptions
 */

/**
 * Speak a question instead of typing it (helps low-literacy users and anyone
 * on a phone). Hidden entirely where the browser has no speech recognition.
 * @param {VoiceOptions} options
 */
export function setupVoice({ button, input, onTranscript, setStatus, Recognition }) {
  if (!Recognition) return null;
  const recogniser = new Recognition();
  recogniser.lang = 'en-IN';
  recogniser.interimResults = false;
  recogniser.maxAlternatives = 1;
  let listening = false;

  /** @param {boolean} on */
  const setListening = (on) => {
    listening = on;
    button.setAttribute('aria-pressed', String(on));
    button.setAttribute('aria-label', on ? 'Stop listening' : 'Ask by voice');
  };

  recogniser.onresult = (event) => {
    const transcript = event.results[0]?.[0]?.transcript?.trim() ?? '';
    if (!transcript) return;
    input.value = transcript;
    onTranscript(transcript);
  };
  recogniser.onend = () => setListening(false);
  recogniser.onerror = () => {
    setListening(false);
    setStatus('Could not hear that. Check microphone permission or type your question.', 'error');
  };

  button.hidden = false;
  button.addEventListener('click', () => {
    if (listening) {
      recogniser.stop();
      return;
    }
    setListening(true);
    setStatus('Listening… ask your question in English or Hindi.');
    recogniser.start();
  });
  return recogniser;
}
