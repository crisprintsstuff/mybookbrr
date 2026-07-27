import { HUB_URL } from '../lib/api';

export function BackToHubLink({ className = '' }: { className?: string }) {
  return (
    <a
      className={className}
      href={HUB_URL}
      title="Open BozNetwork Hub"
    >
      <i className="fa-solid fa-arrow-left" />
      <span>Back to Hub</span>
    </a>
  );
}
