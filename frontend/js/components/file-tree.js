/**
 * Interactive file tree.
 * Owns folder expansion and checkbox tri-state; the page owns the file model.
 */

import { formatBytes, escapeHtml } from '../utils/format-utils.js';
import { buildTree, normalizePath } from '../utils/path-utils.js';
import { fileKind, fileIconName } from '../utils/file-utils.js';
import { icon } from './icons.js';

const folderIconClass = (kind) =>
  kind === 'image' ? 'tree-icon--image' : kind === 'code' ? 'tree-icon--code' : '';

/**
 * @param {HTMLElement} container
 * @param {{files: Array<object>, onFocus?: Function, onChange?: Function,
 *          isSelectable?: (file: object) => boolean}} options
 */
export function mountFileTree(container, { files, onFocus, onChange, isSelectable = () => true, expandedPaths }) {
  const tree = buildTree(files);
  const expanded = new Set(expandedPaths || collectFolderPaths(tree, 3));
  const fileNodes = new Map();

  container.innerHTML = '';
  container.classList.add('filetree');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Project files');

  function collectFiles(node, output = []) {
    for (const child of node.children) {
      if (child.type === 'folder') collectFiles(child, output);
      else output.push(child);
    }
    return output;
  }

  function renderNode(node, depth) {
    if (node.type === 'folder') {
      const wrapper = document.createElement('div');
      wrapper.className = 'tree-node';

      const row = document.createElement('div');
      row.className = 'tree-row';
      row.dataset.path = node.path;
      row.style.paddingLeft = `${6 + depth * 2}px`;

      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'tree-toggle';
      toggle.setAttribute('aria-label', `Toggle ${node.name}`);
      toggle.setAttribute('aria-expanded', String(expanded.has(node.path)));
      toggle.innerHTML = icon('chevron-down', { size: 14 });

      const label = document.createElement('label');
      label.className = 'checkbox';
      label.title = `Select every file in ${node.path}`;
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.setAttribute('aria-label', `Select files in ${node.path}`);
      label.appendChild(checkbox);

      const folderIcon = document.createElement('span');
      folderIcon.className = 'tree-icon tree-icon--folder';
      folderIcon.innerHTML = icon(expanded.has(node.path) ? 'folder-open' : 'folder', { size: 16 });

      const name = document.createElement('button');
      name.type = 'button';
      name.className = 'tree-name';
      name.textContent = node.name;
      name.title = node.path;

      const size = document.createElement('span');
      size.className = 'tree-size';
      const descendants = collectFiles(node);
      size.textContent = String(descendants.length);

      row.append(toggle, label, folderIcon, name, size);

      const children = document.createElement('div');
      children.className = 'tree-children';
      children.hidden = !expanded.has(node.path);
      children.setAttribute('role', 'group');
      for (const child of node.children) children.appendChild(renderNode(child, depth + 1));

      const toggleFolder = () => {
        const isOpen = !children.hidden;
        children.hidden = isOpen;
        expanded[isOpen ? 'delete' : 'add'](node.path);
        toggle.setAttribute('aria-expanded', String(!isOpen));
        folderIcon.innerHTML = icon(isOpen ? 'folder' : 'folder-open', { size: 16 });
        if (onChange) onChange();
      };

      toggle.addEventListener('click', toggleFolder);
      name.addEventListener('click', toggleFolder);

      checkbox.addEventListener('change', () => {
        for (const file of descendants) {
          if (isSelectable(file)) file.selected = checkbox.checked;
        }
        sync();
        onChange?.(fileNodes.get(node.path));
      });

      wrapper.append(row, children);
      fileNodes.set(`folder:${node.path}`, { node, checkbox, descendants });
      return wrapper;
    }

    const row = document.createElement('div');
    row.className = 'tree-row';
    row.dataset.path = node.path;
    row.style.paddingLeft = `${6 + depth * 2}px`;

    const spacer = document.createElement('span');
    spacer.className = 'tree-toggle';
    spacer.setAttribute('aria-hidden', 'true');

    const label = document.createElement('label');
    label.className = 'checkbox';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = Boolean(node.selected);
    checkbox.disabled = !isSelectable(node);
    checkbox.setAttribute('aria-label', `Select ${node.path}`);
    label.appendChild(checkbox);

    const kind = fileKind(node.path);
    const fileIcon = document.createElement('span');
    fileIcon.className = `tree-icon ${folderIconClass(kind)}`;
    fileIcon.innerHTML = icon(fileIconName(node.path), { size: 16 });

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'tree-name';
    name.textContent = node.name;
    name.title = node.path;

    const size = document.createElement('span');
    size.className = 'tree-size';
    size.textContent = formatBytes(node.size);

    row.append(spacer, label, fileIcon, name, size);
    if (node.excluded) {
      row.classList.add('is-excluded');
      size.textContent = node.excludeReason || 'Excluded';
      size.title = node.excludeReason || 'Excluded';
    }

    checkbox.addEventListener('change', () => {
      node.selected = checkbox.checked;
      sync();
      onChange?.(node);
    });
    name.addEventListener('click', () => onFocus?.(node));
    fileNodes.set(node.path, { node, checkbox, row });

    return row;
  }

  for (const child of tree.children) container.appendChild(renderNode(child, 0));

  function sync() {
    for (const [key, entry] of fileNodes) {
      if (key.startsWith('folder:')) continue;
      entry.checkbox.checked = Boolean(entry.node.selected);
      entry.row.classList.toggle('is-focused', Boolean(entry.node.__focused));
    }
    for (const [, entry] of fileNodes) {
      if (!entry.descendants) continue;
      const selectable = entry.descendants.filter((file) => isSelectable(file));
      const selectedCount = selectable.filter((file) => file.selected).length;
      entry.checkbox.checked = selectable.length > 0 && selectedCount === selectable.length;
      entry.checkbox.indeterminate = selectedCount > 0 && selectedCount < selectable.length;
      entry.checkbox.disabled = selectable.length === 0;
    }
  }

  function focusPath(path) {
    for (const [key, entry] of fileNodes) {
      if (key.startsWith('folder:')) continue;
      entry.node.__focused = entry.node.path === normalizePath(path);
      entry.row.classList.toggle('is-focused', entry.node.__focused);
    }
  }

  sync();
  return { refresh: sync, focusPath, expanded };
}

function collectFolderPaths(node, maxDepth, depth = 0, output = []) {
  if (node.type === 'folder' && node.path) output.push(node.path);
  if (depth >= maxDepth) return output;
  for (const child of node.children) {
    if (child.type === 'folder') collectFolderPaths(child, maxDepth, depth + 1, output);
  }
  return output;
}

export function renderFileBadge(file) {
  return `<span class="badge">${escapeHtml(fileKind(file.path))}</span>`;
}
