export function formatCompactNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";

  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);

  const units = [
    { value: 1_000_000_000_000, suffix: "T" },
    { value: 1_000_000_000, suffix: "B" },
    { value: 1_000_000, suffix: "M" },
    { value: 1_000, suffix: "K" },
  ];

  const unit = units.find((item) => abs >= item.value);
  if (!unit) return `${sign}${Math.round(abs).toLocaleString()}`;

  const scaled = abs / unit.value;
  const decimals = scaled >= 10 ? 0 : 1;
  const formatted = scaled.toFixed(decimals).replace(/\.0$/, "");
  return `${sign}${formatted}${unit.suffix}`;
}
