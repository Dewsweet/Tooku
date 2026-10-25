import './tooku-mark.css';

/** The same SVG supplies the favicon, brand mark and login artwork. */
export function TookuMark({ className = '' }: { className?: string }) {
  return <img className={`tooku-mark ${className}`.trim()} src="/tooku.svg" width={96} height={96} alt="" aria-hidden="true" draggable={false} />;
}
