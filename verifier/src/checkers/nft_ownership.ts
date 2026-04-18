import { ethers } from "ethers"

const ERC721_ABI = ["function balanceOf(address) view returns (uint256)"]

export async function checkNFTOwnership(
  walletAddress: string,
  contractAddress: string,
  rpcUrl: string,
): Promise<boolean> {
  const provider = new ethers.JsonRpcProvider(rpcUrl)
  const contract = new ethers.Contract(contractAddress, ERC721_ABI, provider)
  const balance: bigint = await contract.balanceOf(walletAddress)
  return balance > 0n
}
