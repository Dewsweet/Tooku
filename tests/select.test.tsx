import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { Select } from '../src/components/Select';

afterEach(() => vi.restoreAllMocks());

it('tracks ancestor scrolling, ignores list scrolling and closes when the trigger leaves the viewport', async () => {
  const changed = vi.fn();
  const { container, unmount } = render(<div><Select aria-label="地区" value="cn" onChange={changed}><option value="cn">cn</option><option value="jp">jp</option></Select></div>);
  const trigger = screen.getByRole('combobox', { name: '地区' });
  let top = 100;
  const rect = vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => new DOMRect(20, top, 200, 44));
  trigger.focus(); fireEvent.click(trigger);
  const list = screen.getByRole('listbox', { name: '地区' });
  expect(list).toHaveStyle({ top: '150px', left: '20px' });
  top = 45; fireEvent.scroll(container.firstElementChild!);
  await waitFor(() => expect(list).toHaveStyle({ top: '95px' }));
  const measured = rect.mock.calls.length;
  fireEvent.scroll(list);
  expect(rect).toHaveBeenCalledTimes(measured);
  top = window.innerHeight + 20; fireEvent.scroll(document);
  await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
  expect(trigger).toHaveFocus(); expect(changed).not.toHaveBeenCalled();
  top = 100; fireEvent.keyDown(trigger, { key: 'Enter' });
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  unmount(); const calls = rect.mock.calls.length;
  fireEvent.scroll(document); fireEvent.resize(window);
  expect(rect).toHaveBeenCalledTimes(calls);
});
