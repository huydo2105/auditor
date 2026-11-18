type BrandMarkProps = {
  size?: number;
  className?: string;
};

/** Two participants converge on one evidence point. Colors follow the active theme. */
export function BrandMark({ size = 40, className }: BrandMarkProps) {
  return <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" width={size} height={size} className={className} aria-hidden="true" focusable="false">
    <path d="M18 23 39 48 18 73" fill="none" stroke="var(--ink)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M78 23 57 48 78 73" fill="none" stroke="var(--accent)" strokeWidth="11" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M48 38 58 48 48 58 38 48Z" fill="var(--accent)" stroke="var(--page)" strokeWidth="3" />
  </svg>;
}
