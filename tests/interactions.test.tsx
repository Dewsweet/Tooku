import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { Interactions } from '../src/components/Interactions';
import { IconButton } from '../src/components/Common';

it('replaces the native menu and lets Escape restore focus to the trigger', () => {
  render(<MemoryRouter><Interactions><button>测试区域</button></Interactions></MemoryRouter>);
  const trigger = screen.getByRole('button', { name: '测试区域' }); trigger.focus();
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 100 }); fireEvent(trigger, event);
  expect(event.defaultPrevented).toBe(true); expect(screen.getByRole('menu', { name: '快捷菜单' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '主页' }), { key: 'Escape' }); expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
});
it('shows an application tooltip for an icon without a native title and dismisses it on pointer down', async () => {
  render(<MemoryRouter><Interactions><IconButton label="播放选项">⋯</IconButton></Interactions></MemoryRouter>);
  const button = screen.getByRole('button', { name: '播放选项' }); expect(button).not.toHaveAttribute('title'); fireEvent.focusIn(button);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('播放选项'); fireEvent.pointerDown(button);
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
});
it('keeps accessible names separate from visible tooltip opt-ins', () => {
  vi.useFakeTimers();
  try {
    render(<MemoryRouter><Interactions><a href="/" aria-label="Tooku 主页">Tooku</a><div role="separator" aria-label="调整宽度" tabIndex={0} /><button aria-label="播放队列第 1 首：歌曲">歌曲</button><IconButton label="随机播放">↝</IconButton></Interactions></MemoryRouter>);
    for (const control of [screen.getByRole('link', { name: 'Tooku 主页' }), screen.getByRole('separator'), screen.getByRole('button', { name: '播放队列第 1 首：歌曲' })]) {
      fireEvent.pointerOver(control); vi.advanceTimersByTime(600);
      expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    }
    const icon = screen.getByRole('button', { name: '随机播放' });
    expect(icon).toHaveAttribute('data-tooltip', '随机播放');
  } finally { vi.useRealTimers(); }
});
