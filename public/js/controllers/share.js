// @ts-check
import { planToText } from '../render/index.js';

/**
 * @typedef {import('../../../src/domain/brief.js').AirBrief} AirBrief
 * @typedef {{
 *   shareButton: HTMLButtonElement,
 *   speakButton: HTMLButtonElement,
 *   getBrief: () => AirBrief | null,
 *   setStatus: (message: string) => void,
 *   share: ((data: ShareData) => Promise<void>) | null | undefined,
 *   clipboard: Pick<Clipboard, 'writeText'> | null | undefined,
 *   speech: SpeechSynthesis | null | undefined,
 * }} ShareOptions
 */

/**
 * Share the plan (native share sheet or clipboard) and read it aloud.
 * @param {ShareOptions} options
 */
export function setupShare({
  shareButton,
  speakButton,
  getBrief,
  setStatus,
  share,
  clipboard,
  speech,
}) {
  shareButton.addEventListener('click', async () => {
    const brief = getBrief();
    if (!brief) return;
    const text = planToText(brief);
    try {
      if (share) {
        await share({ title: 'AirWise plan', text });
      } else if (clipboard) {
        await clipboard.writeText(text);
        setStatus('Plan copied. Paste it into your family or society group chat.');
      }
    } catch {
      // The user cancelled the share sheet; nothing to do.
    }
  });

  if (!speech) return;
  speakButton.hidden = false;
  speakButton.addEventListener('click', () => {
    const brief = getBrief();
    if (!brief) return;
    speech.cancel();
    const utterance = new SpeechSynthesisUtterance(planToText(brief));
    utterance.lang = 'en-IN';
    speech.speak(utterance);
  });
}
