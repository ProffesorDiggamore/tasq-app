/** "$25", "$12.50" — whole dollars lose the cents, because most bounties are round. */
export function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}
