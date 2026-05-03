import { createCofheConfig, createCofheClient } from '@cofhe/sdk/web'
import { arbSepolia, localcofhe } from '@cofhe/sdk/chains'

const chainId = Number(import.meta.env.VITE_CHAIN_ID ?? '31337')
const chain = chainId === 421614 ? arbSepolia : localcofhe

export const cofheConfig = createCofheConfig({ supportedChains: [chain] })
export const cofheClient = createCofheClient(cofheConfig)
