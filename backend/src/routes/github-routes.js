/** GitHub data routes (proxied — the browser never holds a token). */

import { requireSession } from '../middleware/auth-middleware.js';
import { ApiError } from '../middleware/error-middleware.js';
import { LIMITS, enforceRateLimit } from '../middleware/rate-limit.js';
import { getRepositoryDetail, createRepository, listUserRepositories } from '../services/repository-service.js';
import { validateBranchName, validateOwner, validateRepoName } from '../utils/path-validator.js';
import { ValidationError, parsePositiveInt, requireObject, requireString, validateCommitMessage } from '../utils/validation.js';

export async function handleGithubRoutes(ctx) {
  const { method, url, auth, request, env, config } = ctx;
  if (!url.pathname.startsWith('/api/github/')) return null;
  requireSession(auth);
  await enforceRateLimit(env, request, { ...LIMITS.read, userId: auth.session.user.id });

  if (url.pathname === '/api/github/repos') {
    if (method === 'GET') {
      const page = parsePositiveInt(url.searchParams.get('page'), 1, 50);
      const perPage = parsePositiveInt(url.searchParams.get('per_page'), 50, 100);
      const sort = url.searchParams.get('sort') || 'updated';
      const result = await listUserRepositories(env, auth.token, { page, perPage, sort });
      return ctx.respond(result);
    }
    if (method === 'POST') {
      const body = requireObject(ctx.body);
      const name = validateRepoName(requireString(body.name, 'name', { max: 100 }));
      const description = String(body.description || '').slice(0, 350);
      const isPrivate = Boolean(body.private);
      const autoInit = Boolean(body.autoInit);

      const record = {
        name,
        description,
        private: isPrivate,
        autoInit,
      };
      try {
        const repo = await createRepository(env, auth.token, record);
        return ctx.respond({ repository: repo }, { status: 201 });
      } catch (error) {
        if (error.status === 422) {
          throw new ApiError(
            422,
            'REPO_NAME_TAKEN',
            'GitHub rejected that repository name. It may already exist on your account.',
            error.details
          );
        }
        throw error;
      }
    }
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET or POST for this endpoint.');
  }

  if (url.pathname === '/api/github/repository') {
    if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    const owner = validateOwner(url.searchParams.get('owner') || '');
    const repo = validateRepoName(url.searchParams.get('repo') || '');
    const detail = await getRepositoryDetail(env, auth.token, owner, repo);
    return ctx.respond({ repository: detail });
  }

  if (url.pathname === '/api/github/branches') {
    if (method !== 'GET') throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Use GET for this endpoint.');
    const owner = validateOwner(url.searchParams.get('owner') || '');
    const repo = validateRepoName(url.searchParams.get('repo') || '');
    const detail = await getRepositoryDetail(env, auth.token, owner, repo);
    const requested = url.searchParams.get('branch');
    if (requested) validateBranchName(requested);
    return ctx.respond({
      branches: detail.branches,
      defaultBranch: detail.defaultBranch,
      empty: detail.branches.length === 0,
    });
  }

  throw new ApiError(404, 'NOT_FOUND', 'Unknown GitHub endpoint.');
}

export { ValidationError, validateCommitMessage };
