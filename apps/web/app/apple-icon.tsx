import { ImageResponse } from 'next/og';

/** The home-screen icon for phones: the CodeDNA helix on the brand gradient, drawn at build time. */
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #4f46e5, #8b7cf8)' }}>
        <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
          <path d="M7 3c0 6 10 6 10 12s-10 3-10 6" />
          <path d="M17 3c0 6-10 6-10 12" opacity=".6" />
          <path d="M8.5 7h7M8.5 17h7" />
        </svg>
      </div>
    ),
    size,
  );
}
