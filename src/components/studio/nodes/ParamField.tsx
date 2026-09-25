"use client";

import type { ParamSpec, ParamValue } from "@/lib/models/types";

interface Props {
  spec: ParamSpec;
  value: ParamValue | undefined;
  onChange: (v: ParamValue) => void;
}

export function ParamField({ spec, value, onChange }: Props) {
  if (spec.type === "boolean") {
    const on = value === true;
    return (
      <label className="param param-toggle nodrag">
        <span className="param-label">{spec.label}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          className={`switch${on ? " is-on" : ""}`}
          onClick={() => onChange(!on)}
        ><span /></button>
      </label>
    );
  }

  if (spec.type === "text") {
    return (
      <label className="param param-wide">
        <span className="param-label">{spec.label}</span>
        <textarea
          className="field nodrag nowheel"
          rows={2}
          value={String(value ?? "")}
          placeholder={spec.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
    );
  }

  if (spec.type === "seed") {
    return (
      <label className="param">
        <span className="param-label">{spec.label}</span>
        <input
          className="field nodrag"
          inputMode="numeric"
          placeholder="случайный"
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, "").slice(0, 10))}
        />
      </label>
    );
  }

  return (
    <label className="param">
      <span className="param-label">{spec.label}</span>
      <span className="select nodrag">
        <select value={String(value ?? spec.default)} onChange={(e) => onChange(e.target.value)}>
          {spec.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </span>
    </label>
  );
}
