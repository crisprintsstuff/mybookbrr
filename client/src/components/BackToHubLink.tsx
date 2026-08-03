import { HUB_URL } from '../lib/api';

/** Shown only when VITE_HUB_URL is set at build time (standalone installs hide it). */
export function BackToHubLink({ className = '' }: { className?: string }) {
  if (!HUB_URL) return null;
  return (
    <a className={className} href={HUB_URL} title="Open control plane / hub">
      <i className="fa-solid fa-arrow-left" />
      <span>Back to Hub</span>
    </a>
  );
}
