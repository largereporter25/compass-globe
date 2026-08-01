export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-label="Compass Globe"
      role="img"
    >
      <circle cx="16" cy="16" r="13" stroke="currentColor" strokeWidth="1.4" opacity="0.85" />
      <ellipse cx="16" cy="16" rx="6" ry="13" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M3 16h26" stroke="currentColor" strokeWidth="1" opacity="0.4" />
      <path d="M21.5 10.5 17.6 17.6 10.5 21.5l3.9-7.1z" fill="currentColor" />
    </svg>
  );
}
