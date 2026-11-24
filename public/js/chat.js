// @ts-check
import { el, replaceChildren } from './dom.js';
import { detectLanguage, textToBlocks } from './format.js';

/**
 * @typedef {{ role: 'user' | 'assistant', content: string }} Turn
 * @typedef {{ reply: string, source: string, suggestions: string[] }} ChatAnswer
 * @typedef {{
 *   log: HTMLElement,
 *   form: HTMLFormElement,
 *   input: HTMLTextAreaElement,
 *   suggestions: HTMLElement,
 *   send: (message: string, history: Turn[]) => Promise<ChatAnswer>,
 *   canSend: () => boolean,
 *   onBlocked: () => void,
 * }} ChatOptions
 */

const SOURCE_LABEL = /** @type {Record<string, string>} */ ({
  gemini: 'Answered by Gemini, grounded in your live air brief',
  claude: 'Answered by Claude, grounded in your live air brief',
  rules: 'Answered by AirWise rules from your live air brief',
});

/**
 * Render one message. Assistant text is split into paragraphs and lists and
 * inserted as text nodes only, so model output can never inject markup.
 * @param {Turn} turn
 * @param {string} [source]
 */
export function messageNode(turn, source) {
  const body = textToBlocks(turn.content).map((block) =>
    block.type === 'ul'
      ? el(
          'ul',
          {},
          block.items.map((item) => el('li', { text: item })),
        )
      : el('p', { text: block.text }),
  );
  return el(
    'div',
    { className: `msg msg-${turn.role}`, lang: detectLanguage(turn.content) },
    el('p', {
      className: 'visually-hidden',
      text: turn.role === 'user' ? 'You said:' : 'AirWise said:',
    }),
    body,
    source ? el('p', { className: 'msg-source', text: SOURCE_LABEL[source] ?? '' }) : null,
  );
}

/** @param {ChatOptions} options */
export function createChat(options) {
  /** @type {Turn[]} */
  const history = [];
  let busy = false;
  const button = /** @type {HTMLButtonElement | null} */ (
    options.form.querySelector('button[type="submit"]')
  );

  /** @param {readonly string[]} questions */
  function showSuggestions(questions) {
    replaceChildren(
      options.suggestions,
      questions.map((q) => {
        const chip = el('button', { type: 'button', className: 'chip', text: q });
        chip.addEventListener('click', () => void ask(q));
        return chip;
      }),
    );
  }

  /** @param {string} raw */
  async function ask(raw) {
    const message = raw.trim().slice(0, 600);
    if (!message || busy) return;
    if (!options.canSend()) {
      options.onBlocked();
      return;
    }
    busy = true;
    options.log.setAttribute('aria-busy', 'true');
    if (button) button.disabled = true;
    options.log.appendChild(messageNode({ role: 'user', content: message }));
    const thinking = el('p', { className: 'msg msg-pending', text: 'AirWise is thinking…' });
    options.log.appendChild(thinking);
    options.input.value = '';
    try {
      const answer = await options.send(message, history.slice(-6));
      history.push(
        { role: 'user', content: message },
        { role: 'assistant', content: answer.reply },
      );
      thinking.replaceWith(
        messageNode({ role: 'assistant', content: answer.reply }, answer.source),
      );
      showSuggestions(answer.suggestions ?? []);
    } catch (error) {
      thinking.replaceWith(
        messageNode({
          role: 'assistant',
          content: error instanceof Error ? error.message : 'Sorry, something went wrong.',
        }),
      );
    } finally {
      busy = false;
      options.log.setAttribute('aria-busy', 'false');
      if (button) button.disabled = false;
      options.log.scrollTop = options.log.scrollHeight;
    }
  }

  options.form.addEventListener('submit', (event) => {
    event.preventDefault();
    void ask(options.input.value);
  });
  // Enter sends, Shift+Enter adds a new line (common chat convention).
  options.input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void ask(options.input.value);
    }
  });

  return { ask, showSuggestions, history };
}
