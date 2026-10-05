import { Select } from './ui';

const COMMON = [
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
  'America/Anchorage', 'Pacific/Honolulu', 'America/Toronto', 'America/Vancouver', 'Europe/London',
  'Europe/Dublin', 'Europe/Paris', 'Europe/Berlin', 'Australia/Sydney', 'Asia/Kolkata', 'Asia/Singapore',
];

function allZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (k: string) => string[] };
  return intl.supportedValuesOf?.('timeZone') ?? COMMON;
}

export function TimeZoneSelect({ value, onChange, id }: { value: string; onChange(v: string): void; id?: string }) {
  const zones = allZones();
  const rest = zones.filter((z) => !COMMON.includes(z));
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Common">{COMMON.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</optgroup>
      <optgroup label="All">{rest.map((z) => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}</optgroup>
    </Select>
  );
}
