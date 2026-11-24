/** Accessible modal dialogs (focus handling, ESC, backdrop click). */

import { icon } from './icons.js';

let activeModal = null;

export function closeModal(value = null) {
  if (!activeModal) return;
  const { backdrop, resolve, previousFocus } = activeModal;
  activeModal = null;
  document.removeEventListener('keydown', onKeydown);
  backdrop.remove();
  previousFocus?.focus?.();
  resolve(value);
}

function onKeydown(event) {
  if (!activeModal) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal(null);
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = activeModal.backdrop.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  if (focusable.length === 0) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/**
 * @param {{title: string, body: string|HTMLElement, confirmLabel?: string,
 *          cancelLabel?: string, danger?: boolean, wide?: boolean,
 *          actions?: Array<{label:string, value:string, variant?:string}>, dismissible?: boolean}} options
 * @returns {Promise<string|null>} the chosen action value, or null
 */
export function openModal(options) {
  const {
    title,
    body,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    danger = false,
    wide = false,
    actions,
    dismissible = true,
  } = options;

  closeModal(null);

  const previousFocus = document.activeElement;
  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = `
    <div class="modal${wide ? ' modal--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal__head">
        <h2 class="modal__title" id="modal-title"></h2>
        <button class="modal__close" type="button" aria-label="Close dialog">${icon('x', { size: 17 })}</button>
      </div>
      <div class="modal__body"></div>
      <div class="modal__foot"></div>
    </div>
  `;
  backdrop.querySelector('.modal__title').textContent = title;

  const bodyEl = backdrop.querySelector('.modal__body');
  if (typeof body === 'string') bodyEl.innerHTML = body;
  else if (body instanceof HTMLElement) bodyEl.appendChild(body);

  const foot = backdrop.querySelector('.modal__foot');
  const actionList = actions || [
    { label: cancelLabel, value: 'cancel', variant: 'ghost' },
    { label: confirmLabel, value: 'confirm', variant: danger ? 'danger' : 'primary' },
  ];

  for (const action of actionList) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `btn btn--${action.variant || 'secondary'}`;
    button.textContent = action.label;
    button.addEventListener('click', () => closeModal(action.value));
    foot.appendChild(button);
  }

  const promise = new Promise((resolve) => {
    activeModal = { backdrop, resolve, previousFocus, dismissible };
  });

  const closeButton = backdrop.querySelector('.modal__close');
  if (dismissible) {
    closeButton.addEventListener('click', () => closeModal(null));
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeModal(null);
    });
  } else {
    closeButton.remove();
  }

  document.body.appendChild(backdrop);
  document.addEventListener('keydown', onKeydown);
  const firstInput = backdrop.querySelector('input, textarea, select, .btn--primary, button');
  firstInput?.focus();

  return promise;
}

export async function confirmDialog({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
}) {
  const body = document.createElement('div');
  body.innerHTML = `<p class="text-sm" style="color:var(--text-muted);line-height:1.6"></p>`;
  body.querySelector('p').textContent = message;
  const result = await openModal({
    title,
    body,
    confirmLabel,
    cancelLabel,
    danger,
  });
  return result === 'confirm';
}

export async function promptDialog({ title, label, value = '', placeholder = '', confirmLabel = 'Save' }) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  wrapper.innerHTML = `
    <label class="field__label" for="modal-prompt-input"></label>
    <input class="input" id="modal-prompt-input" autocomplete="off" />
  `;
  wrapper.querySelector('label').textContent = label;
  const input = wrapper.querySelector('input');
  input.value = value;
  input.placeholder = placeholder;

  const result = await openModal({
    title,
    body: wrapper,
    confirmLabel,
    cancelLabel: 'Cancel',
  });
  return result === 'confirm' ? input.value.trim() : null;
}
