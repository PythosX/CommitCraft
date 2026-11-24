/**
 * Folder upload: reads a directory (picker or drag & drop), preserves relative
 * paths, and persists the project (metadata + base64 contents) in IndexedDB so
 * the plan page can publish after navigation. Nothing leaves the browser until
 * the user confirms publishing.
 */

import { APP_CONFIG } from '../config/app-config.js';
import { readFileAsBase64 } from '../utils/file-utils.js';
import { basename, commonRoot, normalizePath, stripRootFolder } from '../utils/path-utils.js';
import { applyIgnoreRules } from './file-service.js';

const DB_NAME = 'commitcraft';
const DB_VERSION = 1;
const STORE = 'projects';
const CURRENT_KEY = 'current-project';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
  });
}

async function withStore(mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE, mode);
    const store = transaction.objectStore(STORE);
    let result;
    try {
      result = action(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('Storage error'));
    };
  });
}

export async function saveProject(project) {
  const record = { key: CURRENT_KEY, ...project };
  try {
    await withStore('readwrite', (store) => store.put(record));
    return true;
  } catch (error) {
    console.warn('Could not persist project in IndexedDB', error);
    sessionStorage.setItem(CURRENT_KEY, 'unsupported');
    return false;
  }
}

export async function loadProject() {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(CURRENT_KEY);
      request.onsuccess = () => {
        db.close();
        resolve(request.result || null);
      };
      request.onerror = () => {
        db.close();
        reject(request.error);
      };
    });
  } catch {
    return null;
  }
}

export async function clearProject() {
  try {
    await withStore('readwrite', (store) => store.delete(CURRENT_KEY));
  } catch {
    /* nothing to clear */
  }
}

/* ---------- Directory walking ---------- */

function readEntryFile(entry) {
  return new Promise((resolve, reject) => {
    entry.file(
      (file) => resolve({ file, path: entry.fullPath || `/${file.name}` }),
      () => reject(new Error(`Could not read ${entry.name}`))
    );
  });
}

function readAllEntries(directoryReader) {
  return new Promise((resolve, reject) => {
    const collected = [];
    const readBatch = () => {
      directoryReader.readEntries((entries) => {
        if (!entries.length) {
          resolve(collected);
          return;
        }
        collected.push(...entries);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function walkEntry(entry, output) {
  if (!entry) return;
  if (entry.isFile) {
    const record = await readEntryFile(entry);
    output.push(record);
    return;
  }
  if (entry.isDirectory) {
    const entries = await readAllEntries(entry.createReader());
    for (const child of entries) await walkEntry(child, output);
  }
}

/** Reads a FileList from <input type="file"> (webkitdirectory aware). */
export function collectFromFileList(fileList) {
  return [...fileList].map((file) => ({
    file,
    path: file.webkitRelativePath || file.name,
  }));
}

/** Reads a drop event's items, recursing into dropped directories. */
export async function collectFromDataTransfer(dataTransfer) {
  const items = [...(dataTransfer.items || [])];
  const output = [];

  const entries = items
    .map((item) => (item.kind === 'file' && item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean);

  if (entries.length === 0) {
    for (const file of [...(dataTransfer.files || [])]) output.push({ file, path: file.name });
    return output;
  }

  for (const entry of entries) await walkEntry(entry, output);
  return output;
}

/**
 * Reads file contents, preserving paths, and applies ignore rules.
 * Active files are read first so a huge ignored folder cannot starve the plan.
 */
export async function buildProject(rawEntries, { customPatterns = [] } = {}) {
  if (!rawEntries.length) throw new Error('No files were found in that folder.');

  const normalizedPaths = rawEntries.map((entry) => normalizePath(entry.path));
  const rootName = commonRoot(normalizedPaths);

  const candidates = rawEntries.map((entry) => {
    const path = stripRootFolder(normalizePath(entry.path), rootName) || basename(entry.path);
    return { file: entry.file, path };
  });

  const deduped = new Map();
  for (const candidate of candidates) {
    if (!deduped.has(candidate.path)) deduped.set(candidate.path, candidate);
  }

  let files = [...deduped.values()].map((candidate) => ({
    path: candidate.path,
    size: candidate.file.size,
    type: candidate.file.type || '',
    lastModified: candidate.file.lastModified,
    selected: true,
    excluded: false,
    excludeReason: '',
    content: null,
    oversized: candidate.file.size > APP_CONFIG.maxFileBytes,
  }));

  // Ignore rules need paths only, so classify once before reading contents.
  const preliminary = files.map((file) => ({ ...file }));
  applyIgnoreRules(preliminary, { customPatterns });
  const ignored = new Set(preliminary.filter((file) => file.excluded).map((file) => file.path));

  const readOrder = [...files].sort((a, b) => Number(ignored.has(a.path)) - Number(ignored.has(b.path)));

  let budget = APP_CONFIG.maxJobBytes;
  for (const file of readOrder) {
    if (file.oversized) {
      file.skipReason = `Exceeds the ${Math.round(APP_CONFIG.maxFileBytes / 1024 / 1024)} MB file limit`;
      continue;
    }
    if (file.size > budget) {
      file.skipReason = 'Not loaded — exceeds the workspace size limit';
      continue;
    }
    const source = deduped.get(file.path).file;
    try {
      file.content = await readFileAsBase64(source);
      budget -= file.size;
    } catch {
      file.skipReason = 'Could not be read';
    }
  }

  applyIgnoreRules(files, { customPatterns });

  const project = {
    rootName: rootName || 'project',
    createdAt: new Date().toISOString(),
    files,
  };

  await saveProject(project);
  return project;
}

export function projectToUploadPayload(files) {
  return files
    .filter((file) => file.selected && !file.excluded && file.content)
    .map((file) => ({
      path: file.path,
      message: file.message || `Add ${file.path}`,
      content: file.content,
      size: file.size,
    }));
}

export async function projectExists() {
  const project = await loadProject();
  return Boolean(project && project.files?.length);
}
