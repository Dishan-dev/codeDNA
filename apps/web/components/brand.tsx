import Link from 'next/link';
export function Brand() {
  return (
    <Link href="/" className="brand" aria-label="CodeDNA home">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
      </span>
      <span>
        code<span className="brand-dna">dna</span>
        <span className="brand-dot">.</span>
      </span>
    </Link>
  );
}
