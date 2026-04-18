import { ethers } from "ethers"

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
]

/**
 * Check whether a wallet holds at least `minAmount` of an ERC-20 token.
 *
 * `minAmount` can be either:
 *   - A human-readable decimal string: "10", "100.5", "1000"  (converted using token decimals)
 *   - A raw integer string with no decimal: already treated as the smallest unit if it's very large
 *
 * The function fetches the token's `decimals()` on-chain so community creators
 * don't need to know the raw unit (USDC = 6 decimals, USDT = 6, WETH = 18, etc.)
 */
export async function checkTokenBalance(
  walletAddress: string,
  tokenAddress: string,
  minAmount: string,
  rpcUrl: string,
): Promise<boolean> {
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider)

  const [balance, decimals]: [bigint, number] = await Promise.all([
    contract.balanceOf(walletAddress),
    contract.decimals().catch(() => 18),   // default 18 if decimals() not implemented
  ])

  // Convert human-readable minAmount to raw units using the token's decimals
  const minRaw = ethers.parseUnits(minAmount, decimals)
  return balance >= minRaw
}
