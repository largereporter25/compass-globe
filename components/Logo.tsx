export default function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-label="Compass Globe" role="img">
      <rect x="1" y="1" width="30" height="30" fill="#FF5A1F" />
      <path d="M23 8 17.6 17.6 8 23l5.4-9.6z" fill="#000" />
      <path d="M16 1v30M1 16h30" stroke="#000" strokeWidth="1" opacity="0.28" />
    </svg>
  );
}
