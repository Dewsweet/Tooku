import { useEffect, useRef } from 'react';

export function AutoLoadMore({ enabled, load }: { enabled: boolean; load: () => void }) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = marker.current;
    if (!enabled || !target) return;
    const root = target.closest<HTMLElement>('.content');
    if (typeof IntersectionObserver === 'undefined') {
      const check = () => {
        if (target.getBoundingClientRect().top <= (root?.getBoundingClientRect().bottom ?? window.innerHeight) + 600) load();
      };
      const scrollTarget = root ?? window;
      scrollTarget.addEventListener('scroll', check, { passive: true });
      window.addEventListener('resize', check);
      check();
      return () => { scrollTarget.removeEventListener('scroll', check); window.removeEventListener('resize', check); };
    }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) load();
    }, { root, rootMargin: '600px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [enabled, load]);
  return <div ref={marker} className="auto-load-marker" aria-hidden="true" />;
}
