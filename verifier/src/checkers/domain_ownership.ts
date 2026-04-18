import { ethers } from "ethers"

export async function checkDomainOwnership(
  walletAddress: string,
  domain: string,
  rpcUrl: string,
): Promise<boolean> {
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const resolver = await provider.getResolver(domain)
  if (!resolver) return false
  const address = await resolver.getAddress()
  return address?.toLowerCase() === walletAddress.toLowerCase()
}
