/** Accessible toast notifications with polite live region. */

import { icon } from './icons.js';

let stack = null;

function ensureStack() {
  if (stack && document.body.contains(stack)) return stack;
  stack = document.createElement('div');
  stack.className = 'toast-stack';
  stack.setAttribute('role', 'status');
  stack.setAttribute('aria-live', 'polite');
  document.body.appendChild(stack);
  return stack;
}

function show(type, title, message, { duration = 5000 } = {}) {
  const container = ensureStack();
  const node = document.createElement('div');
  node.className = `toast toast--${type}`;
  const iconName =
    type === 'success' ? 'check-circle' : type === 'error' ? 'alert-circle' : type === 'info' ? 'info' : 'info';

  node.innerHTML = `
    <span class="toast__icon">${icon(iconName, { size: 17 })}</span>
    <div class="toast__body">
      <div class="toast__title"></div>
      ${message ? '<div class="toast__msg"></div>' : ''}
    </div>
    <button class="toast__close" type="button" aria-label="Dismiss notification">${icon('x', { size: 14 })}</button>
  `;
  node.querySelector('.toast__title').textContent = title;
  if (message) node.querySelector('.toast__msg').textContent = message;

  let timer = null;
  const dismiss = () => {
    if (!node.isConnected) return;
    clearTimeout(timer);
    node.classList.add('is-leaving');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  };

  node.querySelector('.toast__close').addEventListener('click', dismiss);
  container.appendChild(node);

  if (duration > 0) timer = setTimeout(dismiss, duration);

  return { dismiss };
}

export const toast = {
  success: (title, message, options) => show('success', title, message, options),
  error: (title, message, options) => show('error', title, message, { duration: 7000, ...options }),
  info: (title, message, options) => show('info', title, message, options),
  dismissAll() {
    if (stack) stack.innerHTML = '';
  },
};
