import { signIn } from '@/services/auth-state';
import { openSignUp } from '@/services/clerk';

/**
 * Minimal auth launcher -- wraps auth-state's signIn() (Clerk when
 * configured, a local-only session otherwise) / Clerk's openSignUp().
 * Replaces the custom OTP modal. Clerk handles all UI when it's the active
 * provider.
 */
export class AuthLauncher {
  public open(): void {
    signIn();
  }

  public openSignUp(): void {
    openSignUp();
  }

  public close(): void {
    // Clerk manages its own modal lifecycle
  }

  public destroy(): void {
    // Nothing to clean up -- Clerk manages its own resources
  }
}
