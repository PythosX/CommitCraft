/** Repository-relative path helpers (always forward slashes). */

export function normalizePath(value) {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/');
}

export function dirname(filePath) {
  const path = normalizePath(filePath);
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

export function basename(filePath) {
  const path = normalizePath(filePath);
  const index = path.lastIndexOf('/');
  return index === -1 ? path : path.slice(index + 1);
}

export function extname(filePath) {
  const name = basename(filePath);
  const index = name.lastIndexOf('.');
  if (index <= 0) return '';
  return name.slice(index + 1).toLowerCase();
}

export function folderOf(filePath) {
  const dir = dirname(filePath);
  if (!dir) return 'root';
  const segments = dir.split('/');
  return segments[segments.length - 1];
}

export function stripRootFolder(path, rootName) {
  const normalized = normalizePath(path);
  if (!rootName) return normalized;
  const prefix = `${rootName}/`;
  return normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

export function commonRoot(paths) {
  if (!paths.length) return '';
  const segments = normalizePath(paths[0]).split('/');
  if (segments.length === 1) return '';
  let root = segments[0];
  for (const path of paths) {
    const normalized = normalizePath(path);
    if (!normalized.startsWith(`${root}/`)) {
      root = '';
      break;
    }
  }
  return root;
}

export function parentFolders(filePath) {
  const parts = normalizePath(filePath).split('/');
  parts.pop();
  return parts;
}

/** Builds a nested tree structure from a flat list of paths. */
export function buildTree(files) {
  const root = { name: '', path: '', type: 'folder', children: [] };
  const folders = new Map([['', root]]);

  const ensureFolder = (path) => {
    if (folders.has(path)) return folders.get(path);
    const segments = path.split('/');
    const name = segments[segments.length - 1];
    const parentPath = segments.slice(0, -1).join('/');
    const parent = ensureFolder(parentPath);
    const node = { name, path, type: 'folder', children: [] };
    parent.children.push(node);
    folders.set(path, node);
    return node;
  };

  for (const file of files) {
    const path = normalizePath(file.path);
    const segments = path.split('/');
    const name = segments.pop();
    const parent = ensureFolder(segments.join('/'));
    parent.children.push({ ...file, name, path, type: 'file' });
  }

  const sortNodes = (node) => {
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { numeric: true });
    });
    for (const child of node.children) if (child.type === 'folder') sortNodes(child);
  };
  sortNodes(root);
  return root;
}
