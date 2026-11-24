/** Progress bars animate transform only (never width) for 60fps. */

export function createProgress({ label, value = 0, size = 'md', tone = 'accent' } = {}) {
  const wrapper = document.createElement('div');
  wrapper.innerHTML = `
    ${label ? '<div class="progress-meta"><span data-progress-label></span><span data-progress-value></span></div>' : ''}
    <div class="progress ${size === 'lg' ? 'progress--lg' : ''} ${tone === 'success' ? 'progress--success' : ''}"
         role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
      <div class="progress__bar"></div>
    </div>
  `;
  if (label) wrapper.querySelector('[data-progress-label]').textContent = label;

  const bar = wrapper.querySelector('.progress');
  const valueLabel = wrapper.querySelector('[data-progress-value]');

  function set(next) {
    const percent = Math.max(0, Math.min(100, Math.round(Number(next) || 0)));
    bar.style.setProperty('--p', String(percent / 100));
    bar.setAttribute('aria-valuenow', String(percent));
    if (valueLabel) valueLabel.textContent = `${percent}%`;
  }

  set(value);

  return {
    element: wrapper,
    set,
    setLabel(text) {
      const node = wrapper.querySelector('[data-progress-label]');
      if (node) node.textContent = text;
    },
  };
}

export const progressBar = createProgress;
