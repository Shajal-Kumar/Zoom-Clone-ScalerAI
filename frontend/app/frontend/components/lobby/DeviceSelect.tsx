"use client";

import { inputCls } from "@/components/ui/Modal";

interface DeviceSelectProps {
  id: string;
  label: string;
  devices: MediaDeviceInfo[];
  value: string;
  onChange: (deviceId: string) => void;
}

export function DeviceSelect({ id, label, devices, value, onChange }: DeviceSelectProps) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-xs font-medium text-[var(--muted)]">
        {label}
      </label>
      <select
        id={id}
        className={inputCls}
        value={devices.some((d) => d.deviceId === value) ? value : ""}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        disabled={devices.length === 0}
      >
        {devices.length === 0 && <option value="">No device found</option>}
        {!devices.some((d) => d.deviceId === value) && devices.length > 0 && <option value="">Default</option>}
        {devices.map((d, i) => (
          <option key={d.deviceId || i} value={d.deviceId}>
            {d.label || `${label} ${i + 1}`}
          </option>
        ))}
      </select>
    </div>
  );
}
