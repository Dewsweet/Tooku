import { useEffect, useRef, useState } from 'react';
import { RotateCcw, RotateCw, ZoomIn, ZoomOut } from 'lucide-react';
import { Modal } from './Modal';
import { IconButton } from './Common';

interface Crop { zoom: number; x: number; y: number; rotation: number }
const initial: Crop = { zoom: 1, x: 0, y: 0, rotation: 0 };
const clamp = (value: number, min = -1, max = 1) => Math.min(max, Math.max(min, value));
export function cropGeometry(width: number, height: number, size: number, crop: Crop) {
  const rotated = crop.rotation % 180 !== 0; const w = rotated ? height : width; const h = rotated ? width : height;
  const scale = Math.max(size / w, size / h) * crop.zoom;
  return { scale, maxX: Math.max(0, (w * scale - size) / 2), maxY: Math.max(0, (h * scale - size) / 2) };
}
function paint(canvas: HTMLCanvasElement, image: ImageBitmap, crop: Crop, size: number) {
  canvas.width = canvas.height = size; const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器暂时无法编辑图片。');
  const { scale, maxX, maxY } = cropGeometry(image.width, image.height, size, crop);
  context.clearRect(0, 0, size, size); context.save(); context.translate(size / 2 + crop.x * maxX, size / 2 + crop.y * maxY); context.rotate(crop.rotation * Math.PI / 180);
  context.drawImage(image, -image.width * scale / 2, -image.height * scale / 2, image.width * scale, image.height * scale); context.restore();
}
export function AvatarEditor({ file, onSave, onClose, kind = 'avatar' }: { file: File; onSave: (image: string) => void; onClose: () => void; kind?: 'avatar' | 'cover' | 'artist' }) {
  const noun = kind === 'artist' ? '歌手图片' : kind === 'cover' ? '封面' : '头像';
  const [image, setImage] = useState<ImageBitmap | null>(null); const [crop, setCrop] = useState(initial); const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ pointer: number; x: number; y: number; crop: Crop } | null>(null);
  useEffect(() => {
    let active = true; let bitmap: ImageBitmap | undefined;
    async function load() {
      try {
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
        if (file.size > 5 * 1024 * 1024) throw new Error('图片大小请控制在 5 MB 以内。');
        bitmap = await createImageBitmap(file); if (active) setImage(bitmap); else bitmap.close();
      } catch (e) { if (active) setError(e instanceof Error ? e.message : '图片无法读取。'); }
    }
    void load(); return () => { active = false; bitmap?.close(); };
  }, [file]);
  useEffect(() => { if (image && canvas.current) paint(canvas.current, image, crop, 640); }, [image, crop]);
  return <Modal title={`编辑${noun}`} onClose={() => !saving && onClose()}><div className="avatar-editor"><p>拖动图片调整位置，{kind === 'avatar' ? '圆形区域为头像预览。' : '方形区域为图片预览。'}</p><div className="avatar-crop-stage"><canvas ref={canvas} tabIndex={0} role="img" aria-label={`${noun}裁剪预览，可用方向键调整位置`} onPointerDown={(event) => { if (!image) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, crop }; }} onPointerMove={(event) => {
    const start = drag.current; if (!start || !image || start.pointer !== event.pointerId) return;
    const width = event.currentTarget.getBoundingClientRect().width; const { maxX, maxY } = cropGeometry(image.width, image.height, width, start.crop);
    setCrop({ ...start.crop, x: maxX ? clamp(start.crop.x + (event.clientX - start.x) / maxX) : 0, y: maxY ? clamp(start.crop.y + (event.clientY - start.y) / maxY) : 0 });
  }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setCrop((c) => ({ ...c, x: clamp(c.x + (e.key === 'ArrowLeft' ? -.05 : e.key === 'ArrowRight' ? .05 : 0)), y: clamp(c.y + (e.key === 'ArrowUp' ? -.05 : e.key === 'ArrowDown' ? .05 : 0)) })); } }} />{kind === 'avatar' && <span className="avatar-crop-mask" aria-hidden="true" />}{!image && !error && <span className="avatar-crop-loading">加载图片…</span>}</div><div className="avatar-zoom"><ZoomOut size={17} /><input type="range" aria-label={`${noun}缩放`} min={1} max={3} step={.01} value={crop.zoom} disabled={!image} onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))} /><ZoomIn size={18} /></div><div className="avatar-edit-actions"><IconButton label={`旋转${noun}`} disabled={!image} onClick={() => setCrop((c) => ({ ...c, x: 0, y: 0, rotation: (c.rotation + 90) % 360 }))}><RotateCw size={18} /></IconButton><button className="text-button" onClick={() => setCrop(initial)}><RotateCcw size={15} />重置</button><button className="primary-button" disabled={!image || saving} onClick={() => { if (!image) return; setSaving(true); try { const output = document.createElement('canvas'); paint(output, image, crop, kind === 'avatar' ? 256 : 640); const result = kind === 'artist' ? output.toDataURL('image/jpeg', .9) : output.toDataURL('image/png'); if (kind === 'artist' && result.length > 2 * 1024 * 1024) throw new Error('图片过大，请缩小后重试。'); onSave(result); onClose(); } catch (e) { setError(e instanceof Error ? e.message : `${noun}未能保存。`); setSaving(false); } }}>{kind === 'artist' ? '使用图片' : kind === 'cover' ? '使用封面' : '保存头像'}</button></div>{error && <p className="form-error" role="alert">{error}</p>}</div></Modal>;
}
