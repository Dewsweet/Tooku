import { useId, type ReactNode } from 'react';
import './settings.css';

export function SettingsSection({ title, children, action, className = '' }: { title: string; children: ReactNode; action?: ReactNode; className?: string }) {
  const headingId = useId();
  return <section className={`settings-section ${className}`} aria-labelledby={headingId}>
    <header className="settings-section-heading"><h2 id={headingId}>{title}</h2>{action}</header>
    {children}
  </section>;
}
