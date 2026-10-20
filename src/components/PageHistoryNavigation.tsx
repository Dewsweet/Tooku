import { useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton } from './Common';

export function PageHistoryNavigation() {
  const { key } = useLocation();
  const action = useNavigationType();
  const navigate = useNavigate();
  const [history, setHistory] = useState(() => ({ keys: [key], index: 0 }));

  useLayoutEffect(() => {
    setHistory((previous) => {
      if (previous.keys[previous.index] === key) return previous;
      if (action === 'PUSH') {
        const keys = [...previous.keys.slice(0, previous.index + 1), key];
        return { keys, index: keys.length - 1 };
      }
      if (action === 'REPLACE') {
        return { ...previous, keys: previous.keys.map((entry, index) => index === previous.index ? key : entry) };
      }
      const index = previous.keys.indexOf(key);
      // Only traverse entries observed during this signed-in workspace session.
      return index >= 0 ? { ...previous, index } : { keys: [key], index: 0 };
    });
  }, [key, action]);

  return <nav className="header-history" aria-label="页面历史">
    <IconButton label="后退" disabled={history.index === 0} onClick={() => navigate(-1)}><ChevronLeft size={21} /></IconButton>
    <IconButton label="前进" disabled={history.index === history.keys.length - 1} onClick={() => navigate(1)}><ChevronRight size={21} /></IconButton>
  </nav>;
}
