import './filter-pills.css';

export function FilterPills<Value extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly (readonly [Value, string])[];
  value: Value;
  onChange: (value: Value) => void;
}) {
  return <div className="filter-pills" role="group" aria-label={label}>
    {options.map(([id, name]) => <button type="button" key={id} aria-pressed={value === id} onClick={() => onChange(id)}>{name}</button>)}
  </div>;
}
