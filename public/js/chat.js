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

/** @param {unknown} error */
const failureText = (error) =>
  error instanceof Error ? error.message : 'Sorry, something went wrong.';

/**
 * Suggested follow-up questions as one-tap chips.
 * @param {HTMLElement} container @param {readonly string[]} questions
 * @param {(question: string) => unknown} ask
 */
function renderSuggestions(container, questions, ask) {
  replaceChildren(
    container,
    questions.map((q) => {
      const chip = el('button', { type: 'button', className: 'chip', text: q });
      chip.addEventListener('click', () => void ask(q));
      return chip;
    }),
  );
}

/**
 * Submitting sends; so does Enter, while Shift+Enter adds a new line (common chat convention).
 * @param {HTMLFormElement} form @param {HTMLTextAreaElement} input
 * @param {(text: string) => unknown} ask
 */
function bindComposer(form, input, ask) {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void ask(input.value);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void ask(input.value);
    }
  });
}

/**
 * The "waiting for an answer" state: it blocks new questions, marks the log busy and
 * disables the Send button.
 * @param {HTMLElement} log @param {HTMLFormElement} form
 */
function busyState(log, form) {
  const button = /** @type {HTMLButtonElement | null} */ (
    form.querySelector('button[type="submit"]')
  );
  let busy = false;
  return {
    isBusy: () => busy,
    /** @param {boolean} on */
    set(on) {
      busy = on;
      log.setAttribute('aria-busy', String(on));
      if (button) button.disabled = on;
    },
  };
}

/**
 * Post the question with a "thinking" placeholder and clear the input; returns the placeholder.
 * @param {HTMLElement} log @param {HTMLTextAreaElement} input @param {string} message
 */
function postQuestion(log, input, message) {
  log.appendChild(messageNode({ role: 'user', content: message }));
  const thinking = el('p', { className: 'msg msg-pending', text: 'AirWise is thinking…' });
  log.appendChild(thinking);
  input.value = '';
  return thinking;
}

/**
 * The chat: one question at a time, the last six turns sent as context, every answer
 * rendered as plain text.
 * @param {ChatOptions} options
 */
export function createChat(options) {
  /** @type {Turn[]} */
  const history = [];
  const busy = busyState(options.log, options.form);

  /** @param {readonly string[]} questions */
  const showSuggestions = (questions) => renderSuggestions(options.suggestions, questions, ask);

  /**
   * Record the exchange and swap the placeholder for the answer.
   * @param {string} message @param {ChatAnswer} reply @param {HTMLElement} thinking
   */
  function showAnswer(message, reply, thinking) {
    history.push({ role: 'user', content: message }, { role: 'assistant', content: reply.reply });
    thinking.replaceWith(messageNode({ role: 'assistant', content: reply.reply }, reply.source));
    showSuggestions(reply.suggestions ?? []);
  }

  /** @param {string} raw */
  async function ask(raw) {
    const message = raw.trim().slice(0, 600);
    if (!message || busy.isBusy()) return;
    if (!options.canSend()) {
      options.onBlocked();
      return;
    }
    busy.set(true);
    const thinking = postQuestion(options.log, options.input, message);
    try {
      showAnswer(message, await options.send(message, history.slice(-6)), thinking);
    } catch (error) {
      thinking.replaceWith(messageNode({ role: 'assistant', content: failureText(error) }));
    } finally {
      busy.set(false);
      options.log.scrollTop = options.log.scrollHeight;
    }
  }

  bindComposer(options.form, options.input, ask);
  return { ask, showSuggestions, history };
}
