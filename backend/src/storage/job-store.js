/** Publishing job persistence: metadata in KV, file contents in KV blobs. */

import { decodeBase64Size } from '../utils/validation.js';
import { encodeKeyPart, kvDelete, kvGetJSON, kvPutJSON } from './kv.js';
import { storageBindings } from '../config/env.js';

const JOB_PREFIX = 'job:';
const BLOB_PREFIX = 'blob:';
const USER_INDEX_PREFIX = 'jobs:';

export function jobKey(jobId) {
  return `${JOB_PREFIX}${jobId}`;
}

function blobKey(jobId, index) {
  return `${BLOB_PREFIX}${jobId}:${index}`;
}

function userIndexKey(userId) {
  return `${USER_INDEX_PREFIX}${encodeKeyPart(userId)}`;
}

export async function saveJob(env, job) {
  const bindings = storageBindings(env);
  job.updatedAt = new Date().toISOString();
  // File contents never live inside the job document (KV value limit).
  await kvPutJSON(bindings.jobs, jobKey(job.id), job, { ttlSeconds: 60 * 60 * 24 * 7 });
  return job;
}

export async function getJob(env, jobId) {
  const bindings = storageBindings(env);
  return kvGetJSON(bindings.jobs, jobKey(jobId));
}

export async function saveFileContent(env, jobId, index, content) {
  const bindings = storageBindings(env);
  await kvPutJSON(
    bindings.jobs,
    blobKey(jobId, index),
    { content, size: decodeBase64Size(content) },
    { ttlSeconds: 60 * 60 * 24 * 7 }
  );
}

export async function getFileContent(env, jobId, index) {
  const bindings = storageBindings(env);
  const stored = await kvGetJSON(bindings.jobs, blobKey(jobId, index));
  return stored?.content ?? null;
}

export async function deleteFileContent(env, jobId, index) {
  const bindings = storageBindings(env);
  await kvDelete(bindings.jobs, blobKey(jobId, index));
}

export async function deleteJob(env, jobId) {
  await kvDelete(storageBindings(env).jobs, jobKey(jobId));
}

export async function addJobToUserIndex(env, userId, jobId) {
  const bindings = storageBindings(env);
  const key = userIndexKey(userId);
  const existing = (await kvGetJSON(bindings.jobs, key)) || [];
  const next = [jobId, ...existing.filter((id) => id !== jobId)].slice(0, 50);
  await kvPutJSON(bindings.jobs, key, next, { ttlSeconds: 60 * 60 * 24 * 30 });
  return next;
}

export async function listJobIdsForUser(env, userId) {
  const bindings = storageBindings(env);
  return (await kvGetJSON(bindings.jobs, userIndexKey(userId))) || [];
}

export async function listJobsForUser(env, userId, limit = 20) {
  const ids = await listJobIdsForUser(env, userId);
  const jobs = [];
  for (const id of ids.slice(0, limit)) {
    const job = await getJob(env, id);
    if (job) jobs.push(job);
  }
  return jobs;
}
