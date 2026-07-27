import { countUsers, createUser } from '../db/authRepos.js';
import { hashPassword } from './password.js';

export async function bootstrapAdminIfNeeded(): Promise<void> {
  const existing = countUsers();
  if (existing > 0) return;

  const password =
    process.env.BOOTSTRAP_ADMIN_PASSWORD ||
    process.env.AUTH_PASSWORD ||
    'changeme';
  const username = (process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin').trim() || 'admin';
  const hash = await hashPassword(password);
  createUser({
    username,
    passwordHash: hash,
    role: 'admin',
    mustChangePassword: password === 'changeme',
  });
  console.log(
    `[Auth] Bootstrapped admin user "${username}". ` +
      (password === 'changeme'
        ? 'Using default password — change it immediately after login.'
        : 'Login with bootstrap credentials (env password is no longer used for ongoing auth).')
  );
}
