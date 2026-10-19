import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Profiles {
  avatars: Record<string, string>;
  setAvatar: (identity: string, image?: string) => void;
}
export const useProfiles = create<Profiles>()(persist((set) => ({
  avatars: {},
  setAvatar: (identity, image) => set((s) => {
    const avatars = { ...s.avatars }; if (image) avatars[identity] = image; else delete avatars[identity];
    return { avatars };
  }),
}), { name: 'tooku-profiles', version: 1 }));

export async function prepareAvatar(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (file.size > 5 * 1024 * 1024) throw new Error('图片大小请控制在 5 MB 以内。');
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const context = canvas.getContext('2d'); if (!context) throw new Error('浏览器无法处理图片，请换一张图片。');
    const size = Math.min(bitmap.width, bitmap.height);
    context.drawImage(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size, 0, 0, 256, 256);
    return canvas.toDataURL('image/png');
  } finally { bitmap.close(); }
}
