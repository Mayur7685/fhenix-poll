import { defineChain } from 'viem'

export { arbitrumSepolia } from 'viem/chains'

/** Local cofhe dev node (hardhat). */
export const localCofhe = defineChain({
  id: 31337,
  name: 'LocalCofhe',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8545'] },
  },
  testnet: true,
})
