import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { ContentScrollbar, scrollThumbGeometry } from '../src/components/ContentScrollbar';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture'); Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture'); });

function Viewport() {
  const viewport = useRef<HTMLElement>(null);
  return <div><main ref={viewport} id="workspace-content"><div>内容</div></main><ContentScrollbar viewport={viewport} scope="artist" /></div>;
}

it('bounds the thumb within the track and hides scrolling for a short page', () => {
  expect(scrollThumbGeometry(400, 200, 0).range).toBe(0);
  const top = scrollThumbGeometry(400, 1600, 0);
  const end = scrollThumbGeometry(400, 1600, 1200);
  expect(top.top).toBe(0); expect(end.top + end.thumb).toBe(392);
  expect(scrollThumbGeometry(400, 1600, 9999).top).toBe(end.top);
});

it('supports keyboard scrolling and thumb dragging in the existing viewport', async () => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1600);
  vi.stubGlobal('PointerEvent', MouseEvent);
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: () => false });
  const view = render(<Viewport />);
  const viewport = view.container.querySelector('main');
  if (!viewport) throw new Error('缺少滚动容器');
  const thumb = screen.getByRole('scrollbar', { name: '页面滚动条' });
  fireEvent.keyDown(thumb, { key: 'End' }); expect(viewport.scrollTop).toBe(1200);
  fireEvent.scroll(viewport);
  await waitFor(() => expect(thumb).toHaveAttribute('aria-valuenow', '1200'));
  fireEvent.keyDown(thumb, { key: 'Home' }); expect(viewport.scrollTop).toBe(0);
  fireEvent.pointerDown(thumb, { button: 0, clientY: 20 });
  fireEvent.pointerMove(thumb, { clientY: 118 });
  expect(viewport.scrollTop).toBe(400);
  fireEvent.pointerUp(thumb);
  view.unmount();
  Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture');
  Reflect.deleteProperty(HTMLElement.prototype, 'hasPointerCapture');
});

it('observes content growth and disconnects when leaving the page', () => {
  let resized: (() => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resized = callback; }
    observe = vi.fn(); unobserve = vi.fn(); disconnect = disconnect;
  });
  const view = render(<Viewport />);
  act(() => resized?.());
  view.unmount();
  expect(disconnect).toHaveBeenCalled();
});
