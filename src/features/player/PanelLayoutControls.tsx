import { ArrowDown, ArrowUp, RotateCcw } from 'lucide-react';
import { defaultPanelSections, normalizePanelSections, panelSectionNames, usePreferences } from '../../state/preferences';
import { IconButton } from '../../components/Common';

export function PanelLayoutControls() {
  const prefs = usePreferences(); const sections = normalizePanelSections(prefs.panelSections);
  function move(index: number, direction: number) {
    const next = [...sections]; const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]]; prefs.update({ panelSections: next });
  }
  return <div className="panel-layout-controls"><p>选择显示内容，调整上下顺序。</p><ol>{sections.map((section, index) => <li key={section.id}><label><input type="checkbox" checked={section.enabled} onChange={(e) => prefs.update({ panelSections: sections.map((s) => s.id === section.id ? { ...s, enabled: e.target.checked } : s) })} /><span>{panelSectionNames[section.id]}</span></label><div><IconButton label={`上移${panelSectionNames[section.id]}`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></IconButton><IconButton label={`下移${panelSectionNames[section.id]}`} disabled={index === sections.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></IconButton></div></li>)}</ol><button className="text-button" onClick={() => prefs.update({ panelSections: defaultPanelSections.map((s) => ({ ...s })) })}><RotateCcw size={14} />恢复默认布局</button></div>;
}
