import { signIn, signOut, type AuthSession, subscribeAuthState } from '@/services/auth-state';
import { isClerkAuthEnabled, mountUserButton, openSignUp } from '@/services/clerk';
import { t } from '@/services/i18n';
import { setTrustedHtml, trustedHtml } from '@/utils/dom-utils';

export class AuthHeaderWidget {
  private container: HTMLElement;
  private unsubscribeAuth: (() => void) | null = null;
  private unmountUserButton: (() => void) | null = null;
  private onSignInClick?: () => void;
  private onSettingsClick?: () => void;
  private onBillingClick?: () => void;

  constructor(
    onSignInClick?: () => void,
    onSettingsClick?: () => void,
    onBillingClick?: () => void,
  ) {
    this.onSignInClick = onSignInClick;
    this.onSettingsClick = onSettingsClick;
    this.onBillingClick = onBillingClick;
    this.container = document.createElement('div');
    this.container.className = 'auth-header-widget';

    this.unsubscribeAuth = subscribeAuthState((state: AuthSession) => {
      if (state.isPending) {
        this.renderPending();
        return;
      }
      this.render(state);
    });
  }

  public getElement(): HTMLElement {
    return this.container;
  }

  public destroy(): void {
    this.unmountUserButton?.();
    this.unmountUserButton = null;
    if (this.unsubscribeAuth) {
      this.unsubscribeAuth();
      this.unsubscribeAuth = null;
    }
  }

  private render(state: AuthSession): void {
    this.unmountUserButton?.();
    this.unmountUserButton = null;
    this.container.classList.remove('auth-header-widget-pending');
    this.container.removeAttribute('aria-busy');
    setTrustedHtml(this.container, trustedHtml('', 'legacy direct innerHTML migration'));

    if (!state.user) {
      this.renderSignedOut();
      return;
    }
    this.renderSignedIn(state);
  }

  private renderPending(): void {
    this.unmountUserButton?.();
    this.unmountUserButton = null;
    this.container.classList.add('auth-header-widget-pending');
    this.container.setAttribute('aria-busy', 'true');
    setTrustedHtml(this.container, trustedHtml('', 'legacy direct innerHTML migration'));

    const signInSkeleton = document.createElement('span');
    signInSkeleton.className = 'auth-header-skeleton auth-header-skeleton-signin';
    signInSkeleton.setAttribute('aria-hidden', 'true');
    this.container.appendChild(signInSkeleton);

    const signUpSkeleton = document.createElement('span');
    signUpSkeleton.className = 'auth-header-skeleton auth-header-skeleton-signup';
    signUpSkeleton.setAttribute('aria-hidden', 'true');
    this.container.appendChild(signUpSkeleton);
  }

  private renderSignedOut(): void {
    const signInBtn = document.createElement('button');
    signInBtn.className = 'auth-signin-btn';
    signInBtn.textContent = t('auth.signIn');
    signInBtn.addEventListener('click', () => {
      if (this.onSignInClick) this.onSignInClick();
      else signIn();
    });
    this.container.appendChild(signInBtn);

    // Sign-up is a Clerk-account concept — nothing to create in local mode,
    // where "signing in" already just flips a local flag.
    if (isClerkAuthEnabled()) {
      const signUpLink = document.createElement('button');
      signUpLink.className = 'auth-signup-link';
      signUpLink.textContent = t('auth.createAccount');
      signUpLink.addEventListener('click', () => openSignUp());
      this.container.appendChild(signUpLink);
    }
  }

  private renderSignedIn(state: AuthSession): void {
    if (isClerkAuthEnabled()) {
      const userBtnEl = document.createElement('div');
      userBtnEl.className = 'auth-clerk-user-button';
      this.container.appendChild(userBtnEl);
      // Settings and billing now live inside Clerk's own user-button menu
      // (upstream #5940), so no separate settings button is rendered here.
      this.unmountUserButton = mountUserButton(userBtnEl, {
        onBillingClick: this.onBillingClick,
        onSettingsClick: this.onSettingsClick,
      });
      return;
    }

    // Local mode: there's no real Clerk instance to mount a UserButton
    // from — show a plain chip with a click-to-sign-out affordance, plus the
    // standalone settings button, since there is no Clerk menu to host it.
    const localChip = document.createElement('button');
    localChip.type = 'button';
    localChip.className = 'auth-local-user-chip';
    localChip.textContent = state.user?.name ?? t('auth.localUser');
    localChip.title = t('auth.localUserSignOutHint');
    localChip.addEventListener('click', () => { void signOut(); });
    this.container.appendChild(localChip);

    if (this.onSettingsClick) {
      const settingsBtn = document.createElement('button');
      settingsBtn.className = 'auth-settings-btn';
      settingsBtn.type = 'button';
      settingsBtn.setAttribute('aria-label', t('auth.settings'));
      settingsBtn.title = t('auth.settings');
      setTrustedHtml(settingsBtn, trustedHtml(SETTINGS_ICON, "legacy direct innerHTML migration"));
      settingsBtn.addEventListener('click', () => this.onSettingsClick?.());
      this.container.appendChild(settingsBtn);
    }
  }
}
const SETTINGS_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
