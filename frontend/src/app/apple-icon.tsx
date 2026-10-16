import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(180deg, #3b3b42 0%, #111114 100%)",
        }}
      >
        <svg width="120" height="120" viewBox="0 0 32 32">
          <path d="M9 9.5h9.5a4.5 4.5 0 0 1 0 9H13" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <path d="M9 9.5V23" fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" />
          <circle cx="21.5" cy="22.5" r="2.2" fill="#7fb6e6" />
        </svg>
      </div>
    ),
    size,
  );
}
