/** Publishing history: one record per finished job, newest first. */

import { encodeKeyPart, kvDelete, kvGetJSON, kvPutJSON } from './kv.js';
import { storageBindings } from '../config/env.js';

const ENTRY_PREFIX = 'history:';
const INDEX_PREFIX = 'history-index:';
const MAX_ENTRIES = 100;

function indexKey(userId) {
  return `${INDEX_PREFIX}${encodeKeyPart(userId)}`;
}

export async function appendHistory(env, userId, record) {
  const bindings = storageBindings(env);
  await kvPutJSON(bindings.history, `${ENTRY_PREFIX}${encodeKeyPart(userId)}:${record.id}`, record, {
    ttlSeconds: 60 * 60 * 24 * 180,
  });
  const key = indexKey(userId);
  const ids = (await kvGetJSON(bindings.history, key)) || [];
  const next = [record.id, ...ids.filter((id) => id !== record.id)].slice(0, MAX_ENTRIES);
  await kvPutJSON(bindings.history, key, next);
  return record;
}

export async function listHistory(env, userId, limit = 50) {
  const bindings = storageBindings(env);
  const ids = (await kvGetJSON(bindings.history, indexKey(userId))) || [];
  const records = [];
  for (const id of ids.slice(0, limit)) {
    const record = await kvGetJSON(bindings.history, `${ENTRY_PREFIX}${encodeKeyPart(userId)}:${id}`);
    if (record) records.push(record);
  }
  return records;
}

export async function clearHistory(env, userId) {
  const bindings = storageBindings(env);
  const key = indexKey(userId);
  const ids = (await kvGetJSON(bindings.history, key)) || [];
  await Promise.all(
    ids.map((id) => kvDelete(bindings.history, `${ENTRY_PREFIX}${encodeKeyPart(userId)}:${id}`))
  );
  await kvDelete(bindings.history, key);
}

export async function latestHistoryRecord(env, userId, jobId) {
  const bindings = storageBindings(env);
  return kvGetJSON(bindings.history, `${ENTRY_PREFIX}${encodeKeyPart(userId)}:${jobId}`);
}
