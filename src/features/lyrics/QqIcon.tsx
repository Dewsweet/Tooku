// Small monochrome penguin, drawn to share the weight of the player controls.
export function QqIcon({ size = 20 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 10C6.3 5.2 8 2.5 12 2.5S17.7 5.2 17 10c1.6 1.4 3 4.1 2.5 5.8-.3.8-1.2.6-2.2-.4.2 3.5-1.6 5.2-5.3 5.2s-5.5-1.7-5.3-5.2c-1 1-1.9 1.2-2.2.4C4 14.1 5.4 11.4 7 10Z" />
    <path d="M7 10c2.9 1.5 7.1 1.5 10 0M8.2 11.3l-.8 3.2 2 .5.7-3M8 20l-2 1.5h4M16 20l2 1.5h-4M10.5 8.2c1-.7 2-.7 3 0" />
    <path d="M10 5.5v.7M14 5.5v.7" />
  </svg>;
}
