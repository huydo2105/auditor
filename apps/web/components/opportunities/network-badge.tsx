export function NetworkBadge({ ecosystem }: { ecosystem: string }) {
  if (ecosystem === "solana") return <span className="directory-network directory-network-solana"><svg width="15" height="15" viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M7 6h22l-5 5H2l5-5Zm0 8h22l-5 5H2l5-5Zm-5 13 5-5h22l-5 5H2Z" fill="currentColor" /></svg>Solana</span>;
  return <span className="directory-network directory-network-ethereum"><svg width="13" height="17" viewBox="0 0 32 40" fill="none" aria-hidden="true"><path d="m16 1 14 20-14 8L2 21 16 1Zm0 38L2 24l14 8 14-8-14 15Z" fill="currentColor" /></svg>Ethereum</span>;
}
