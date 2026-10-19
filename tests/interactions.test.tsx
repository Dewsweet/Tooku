import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it } from 'vitest';
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
