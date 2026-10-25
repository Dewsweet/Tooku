import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { expect, it } from 'vitest';
import { PageHistoryNavigation } from '../src/components/PageHistoryNavigation';

function Workspace() {
  const location = useLocation();
  const navigate = useNavigate();
  return <><PageHistoryNavigation /><output aria-label="当前页面">{location.pathname}{location.search}</output>
    <Link to="/artists">歌手页</Link><Link to="/albums">专辑页</Link>
    <button onClick={() => navigate('/artists?q=新名称', { replace: true })}>替换当前搜索</button>
    <button onClick={() => navigate(-1)}>浏览器后退</button>
  </>;
}

it('traverses session pages, follows browser back, and discards forward entries on a new visit', () => {
  render(<StrictMode><MemoryRouter><Workspace /></MemoryRouter></StrictMode>);
  const back = screen.getByRole('button', { name: '后退' });
  const forward = screen.getByRole('button', { name: '前进' });
  expect(back).toBeDisabled(); expect(forward).toBeDisabled();
  fireEvent.click(screen.getByText('歌手页'));
  expect(back).toBeEnabled(); expect(forward).toBeDisabled();
  fireEvent.click(back);
  expect(screen.getByLabelText('当前页面')).toHaveTextContent(/^\/$/);
  expect(back).toBeDisabled(); expect(forward).toBeEnabled();
  fireEvent.click(forward);
  expect(screen.getByLabelText('当前页面')).toHaveTextContent('/artists');
  fireEvent.click(screen.getByText('浏览器后退'));
  fireEvent.click(screen.getByText('专辑页'));
  expect(screen.getByLabelText('当前页面')).toHaveTextContent('/albums');
  expect(forward).toBeDisabled();
  fireEvent.click(back);
  fireEvent.click(forward);
  expect(screen.getByLabelText('当前页面')).toHaveTextContent('/albums');
});

it('replaces search entries without adding a step and stays inside observed workspace history', () => {
  render(<MemoryRouter initialEntries={['/outside', '/']} initialIndex={1}><Workspace /></MemoryRouter>);
  const back = screen.getByRole('button', { name: '后退' });
  const forward = screen.getByRole('button', { name: '前进' });
  expect(back).toBeDisabled();
  fireEvent.click(screen.getByText('歌手页'));
  fireEvent.click(screen.getByText('替换当前搜索'));
  fireEvent.click(back);
  expect(screen.getByLabelText('当前页面')).toHaveTextContent(/^\/$/);
  expect(back).toBeDisabled();
  fireEvent.click(forward);
  expect(screen.getByLabelText('当前页面')).toHaveTextContent('/artists?q=新名称');
  expect(forward).toBeDisabled();
});
