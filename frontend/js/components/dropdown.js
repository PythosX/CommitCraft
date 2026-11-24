/** Dropdown menus: click to open, outside click / Escape to close. */

const openMenus = new Set();

function closeMenu(menu, trigger) {
  menu.hidden = true;
  trigger?.setAttribute('aria-expanded', 'false');
  openMenus.delete(menu);
}

export function closeAllDropdowns() {
  for (const menu of [...openMenus]) {
    closeMenu(menu, menu.__trigger);
  }
}

function handleDocumentClick(event) {
  for (const menu of [...openMenus]) {
    const root = menu.closest('.dropdown');
    if (root && !root.contains(event.target)) closeMenu(menu, menu.__trigger);
  }
}

function handleKeydown(event) {
  if (event.key === 'Escape') closeAllDropdowns();
}

let bound = false;

export function initDropdowns(root = document) {
  if (!bound) {
    document.addEventListener('click', handleDocumentClick);
    document.addEventListener('keydown', handleKeydown);
    bound = true;
  }

  root.querySelectorAll('[data-dropdown]').forEach((wrapper) => {
    const trigger = wrapper.querySelector('[data-dropdown-trigger]');
    const menu = wrapper.querySelector('[data-dropdown-menu]');
    if (!trigger || !menu || trigger.dataset.dropdownBound === 'true') return;

    trigger.dataset.dropdownBound = 'true';
    menu.hidden = true;
    menu.__trigger = trigger;

    trigger.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = !menu.hidden;
      closeAllDropdowns();
      if (!isOpen) {
        menu.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        openMenus.add(menu);
      }
    });

    menu.addEventListener('click', () => closeAllDropdowns());
  });
}
