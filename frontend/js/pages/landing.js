/** Landing page: auth-aware CTAs, theme, mobile nav, scroll reveals. */

import { loadSession, signIn } from '../core/auth-manager.js';
import { APP_CONFIG } from '../config/app-config.js';
import { initTheme, cycleTheme } from '../utils/theme.js';
import { toast } from '../components/toast.js';

initTheme();

/* Theme toggle */
const themeToggle = document.getElementById('themeToggle');
themeToggle?.addEventListener('click', () => {
  const next = cycleTheme();
  themeToggle.setAttribute('aria-label', `Theme: ${next}. Click to change.`);
  themeToggle.innerHTML =
    next === 'light'
      ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
      : next === 'dark'
        ? '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>'
        : '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
});

/* Header elevation on scroll */
const header = document.getElementById('siteHeader');
const onScroll = () => header?.classList.toggle('is-scrolled', window.scrollY > 8);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* Mobile navigation */
const nav = document.getElementById('siteNav');
const navToggle = document.getElementById('navToggleLanding');
navToggle?.addEventListener('click', () => {
  const isOpen = nav?.classList.toggle('site-nav--open');
  navToggle.setAttribute('aria-expanded', String(Boolean(isOpen)));
});
nav?.querySelectorAll('.site-nav__links a').forEach((link) =>
  link.addEventListener('click', () => {
    nav.classList.remove('site-nav--open');
    navToggle?.setAttribute('aria-expanded', 'false');
  })
);

/* Scroll reveals (once) */
const revealNodes = document.querySelectorAll('.reveal');
if ('IntersectionObserver' in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.18, rootMargin: '0px 0px -40px 0px' }
  );
  revealNodes.forEach((node) => observer.observe(node));
} else {
  revealNodes.forEach((node) => node.classList.add('is-visible'));
}

document.getElementById('year').textContent = new Date().getFullYear();

/* Auth state + messages */
const params = new URLSearchParams(window.location.search);

function announceAuthState() {
  const authError = params.get('auth_error');
  if (authError === 'access_denied') {
    toast.info('Authorization cancelled', 'CommitCraft needs repository access to publish commits.');
  } else if (authError === 'state_mismatch') {
    toast.error('Sign-in could not be verified', 'The OAuth state did not match. Please try again.');
  } else if (authError === 'exchange_failed' || authError === 'github_error') {
    toast.error('GitHub sign-in failed', 'GitHub did not complete the authorization. Please retry.');
  }
  if (params.get('auth') === 'required') {
    toast.info('Sign in to continue', 'Connect your GitHub account to open the dashboard.');
  }
  if (params.get('auth') === 'expired') {
    toast.info('Session expired', 'Sign in again to keep publishing.');
  }
}

announceAuthState();

async function wireCtas() {
  const session = await loadSession();
  const authed = Boolean(session?.authenticated);

  if (authed) {
    const name = session.user?.login ? `@${session.user.login}` : 'dashboard';
    document.querySelectorAll('[data-action="signin"]').forEach((button) => {
      button.textContent = `Open ${name}`;
    });
    document.querySelectorAll('[data-action="start"]').forEach((button) => {
      button.addEventListener('click', () => {
        window.location.href = APP_CONFIG.pages.dashboard;
      });
    });
    document.querySelectorAll('[data-action="signin"]').forEach((button) => {
      button.addEventListener('click', () => {
        window.location.href = APP_CONFIG.pages.dashboard;
      });
    });
    return;
  }

  document.querySelectorAll('[data-action="signin"], [data-action="start"]').forEach((button) => {
    button.addEventListener('click', () => signIn());
  });
}

wireCtas();
