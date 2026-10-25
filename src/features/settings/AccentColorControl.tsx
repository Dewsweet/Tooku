import { useEffect, useId, useState } from 'react';
import { usePreferences } from '../../state/preferences';
import { Select } from '../../components/Select';

const isColor = (value: string) => /^#[0-9a-f]{6}$/i.test(value);
const presets = [
  { id: 'default', name: '默认（红色）', value: '#c83e55' },
  { id: 'blue', name: '蓝色', value: '#3365c4' },
  { id: 'purple', name: '紫色', value: '#7051b8' },
  { id: 'green', name: '绿色', value: '#207a61' },
  { id: 'amber', name: '橙色', value: '#a65d21' },
];

export function AccentColorControl() {
  const accent = usePreferences((s) => s.accent);
  const fallback = usePreferences.getInitialState().accent;
  const value = isColor(accent) ? accent : fallback;
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const [custom, setCustom] = useState(false);
  const selection = custom ? 'custom' : presets.find((preset) => preset.value === value.toLowerCase())?.id ?? 'custom';
  const errorId = useId();
  useEffect(() => { setDraft(value); setInvalid(false); }, [value]);
  function apply(color: string) {
    setDraft(color); setInvalid(false);
    usePreferences.getState().update({ accent: color.toLowerCase() });
  }
  return <div className="setting-row"><strong>主题色</strong><div className="accent-control">
    <Select aria-label="主题色方案" value={selection} onChange={(next) => {
      setInvalid(false);
      if (next === 'custom') { setCustom(true); setDraft(value); }
      else { const preset = presets.find((item) => item.id === next); if (preset) { setCustom(false); apply(preset.value); } }
    }}>{presets.map((preset) => <option key={preset.id} value={preset.id}><span className="accent-choice"><span className="accent-swatch" aria-hidden="true" style={{ backgroundColor: preset.value }} />{preset.name}</span></option>)}<option value="custom"><span className="accent-choice"><span className="accent-swatch" aria-hidden="true" style={{ backgroundColor: value }} />自定义</span></option></Select>
    {selection === 'custom' && <div className="accent-inputs">
      <input type="color" aria-label="选择主题色" value={value} onChange={(event) => apply(event.target.value)} />
      <input className="accent-hex" aria-label="主题色值" aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined} autoComplete="off" spellCheck={false} maxLength={7} value={draft} onChange={(event) => {
        const next = event.target.value; setDraft(next); setInvalid(false);
        if (isColor(next)) apply(next);
      }} onBlur={() => setInvalid(!isColor(draft))} />
    </div>}
    {invalid && <p id={errorId} role="alert">请输入六位颜色值，如 #c83e55</p>}
  </div></div>;
}
