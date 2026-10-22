import './tooku-mark.css';

/** The same SVG supplies the favicon, brand mark and login artwork. */
export function TookuMark({ className = '' }: { className?: string }) {
  return <span className={`tooku-mark ${className}`.trim()} aria-hidden="true" />;
}
