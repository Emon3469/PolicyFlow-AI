import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-4 py-24 text-center">
      <p className="text-[13px] font-medium text-subtle">404</p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight">Page not found</h2>
      <p className="mt-2 text-[13px] text-muted">The page you are looking for doesn&apos;t exist or was moved.</p>
      <Link href="/" className="btn-primary mt-6 inline-flex h-9 items-center rounded-lg px-4 text-[13px] font-medium">
        Back to overview
      </Link>
    </div>
  );
}
