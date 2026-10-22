import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { Interactions } from '../src/components/Interactions';
import { IconButton } from '../src/components/Common';
import { revealPopover } from '../src/components/popover';

afterEach(() => { delete document.documentElement.dataset.focusInput; vi.restoreAllMocks(); vi.useRealTimers(); });

it('replaces the native menu and lets Escape restore focus to the trigger', () => {
  render(<MemoryRouter><Interactions><button>测试区域</button></Interactions></MemoryRouter>);
  const trigger = screen.getByRole('button', { name: '测试区域' }); trigger.focus();
  const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 100 }); fireEvent(trigger, event);
  expect(event.defaultPrevented).toBe(true); expect(screen.getByRole('menu', { name: '快捷菜单' })).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('menuitem', { name: '主页' }), { key: 'Escape' }); expect(screen.queryByRole('menu')).not.toBeInTheDocument(); expect(trigger).toHaveFocus();
});
it('shows an application tooltip for an icon without a native title and dismisses it on pointer down', async () => {
  render(<MemoryRouter><Interactions><IconButton label="播放选项">⋯</IconButton></Interactions></MemoryRouter>);
  const button = screen.getByRole('button', { name: '播放选项' }); expect(button).not.toHaveAttribute('title'); fireEvent.keyDown(document, { key: 'Tab' }); fireEvent.focusIn(button);
  expect(await screen.findByRole('tooltip')).toHaveTextContent('播放选项'); fireEvent.pointerDown(button);
  await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());
});

function pointer(target: HTMLElement, type: string, x = 20, y = 20) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, { pointerType: 'touch', pointerId: 1, clientX: x, clientY: y });
  fireEvent(target, event);
}
it('shows touch hints only while holding, suppresses the long-press click and keeps a later tap functional', () => {
  vi.useFakeTimers(); const click = vi.fn();
  render(<MemoryRouter><Interactions><IconButton label="队列" onClick={click}>≡</IconButton></Interactions></MemoryRouter>);
  const button = screen.getByRole('button', { name: '队列' });
  pointer(button, 'pointerover'); pointer(button, 'pointerdown'); fireEvent.focusIn(button);
  act(() => vi.advanceTimersByTime(100)); pointer(button, 'pointerup'); fireEvent.click(button);
  act(() => vi.advanceTimersByTime(600)); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(); expect(click).toHaveBeenCalledOnce();
  pointer(button, 'pointerdown'); act(() => vi.advanceTimersByTime(550));
  expect(screen.getByRole('tooltip')).toHaveTextContent('队列');
  const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true }); fireEvent(button, context);
  expect(context.defaultPrevented).toBe(true); expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  pointer(button, 'pointerup'); fireEvent.click(button, { detail: 1 });
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument(); expect(click).toHaveBeenCalledOnce();
  pointer(button, 'pointerdown'); pointer(button, 'pointerup'); fireEvent.click(button);
  expect(click).toHaveBeenCalledTimes(2);
});
it('cancels a touch hint when scrolling, dragging or cancelling', () => {
  vi.useFakeTimers();
  render(<MemoryRouter><Interactions><IconButton label="播放">▶</IconButton></Interactions></MemoryRouter>);
  const button = screen.getByRole('button', { name: '播放' });
  for (const interrupt of [() => pointer(button, 'pointermove', 20, 40), () => pointer(button, 'pointercancel'), () => fireEvent.scroll(document)]) {
    pointer(button, 'pointerdown'); act(() => vi.advanceTimersByTime(200)); interrupt();
    act(() => vi.advanceTimersByTime(600)); expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  }
});
it('clears pending and visible hints when navigating away from their trigger', () => {
  vi.useFakeTimers();
  render(<MemoryRouter><Interactions><IconButton label="播放">▶</IconButton><Link to="/albums">专辑</Link></Interactions></MemoryRouter>);
  const button = screen.getByRole('button', { name: '播放' });
  fireEvent.pointerOver(button); act(() => vi.advanceTimersByTime(200));
  fireEvent.click(screen.getByRole('link', { name: '专辑' })); act(() => vi.advanceTimersByTime(600));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.pointerOver(button); act(() => vi.advanceTimersByTime(450)); expect(screen.getByRole('tooltip')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: '专辑' }));
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
});
it('keeps pointer focus quiet for system volume keys and retains keyboard navigation hints', () => {
  vi.useFakeTimers();
  render(<MemoryRouter><Interactions><IconButton label="播放">▶</IconButton></Interactions></MemoryRouter>);
  const button = screen.getByRole('button', { name: '播放' });
  fireEvent.pointerDown(button); fireEvent.focusIn(button);
  for (const key of ['AudioVolumeUp', 'AudioVolumeDown', 'AudioVolumeMute', 'MediaPlayPause', 'Shift', 'Unidentified']) fireEvent.keyDown(button, { key });
  act(() => vi.advanceTimersByTime(600));
  expect(document.documentElement).toHaveAttribute('data-focus-input', 'pointer');
  expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  fireEvent.keyDown(document, { key: 'Tab' }); fireEvent.focusIn(button); act(() => vi.advanceTimersByTime(200));
  expect(document.documentElement).toHaveAttribute('data-focus-input', 'keyboard'); expect(screen.getByRole('tooltip')).toHaveTextContent('播放');
});
it('falls back from a native popover lifecycle exception without unmounting the workspace', () => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, 'showPopover', { configurable: true, value: vi.fn(() => { throw new DOMException('stale top layer', 'InvalidStateError'); }) });
  try {
    render(<MemoryRouter><Interactions><IconButton label="播放">▶</IconButton></Interactions></MemoryRouter>);
    const button = screen.getByRole('button', { name: '播放' });
    fireEvent.keyDown(document, { key: 'Tab' }); fireEvent.focusIn(button); act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).not.toHaveAttribute('popover'); expect(button).toBeInTheDocument();
    expect(HTMLElement.prototype.showPopover).toHaveBeenCalledOnce();
    fireEvent.pointerDown(button); fireEvent.contextMenu(button);
    expect(screen.getByRole('menu')).not.toHaveAttribute('popover'); expect(button).toBeInTheDocument();
  } finally { Reflect.deleteProperty(HTMLElement.prototype, 'showPopover'); }
});
it('does not try to open detached popovers or popovers in a closed dialog', () => {
  const node = document.createElement('div'); const show = vi.fn(); node.showPopover = show;
  expect(revealPopover(node)).toBe(false);
  const dialog = document.createElement('dialog'); dialog.append(node); document.body.append(dialog);
  try { expect(revealPopover(node)).toBe(false); expect(show).not.toHaveBeenCalled(); }
  finally { dialog.remove(); }
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
