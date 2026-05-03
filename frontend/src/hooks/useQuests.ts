import { useState, useCallback } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { useWriteContract } from './useWriteContract'
import { keccak256, toHex, encodePacked } from 'viem'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import { arbitrumSepolia } from '../lib/chains'
import { getGasFees } from '../lib/gas'
import type { QuestInfo, QuestProgress } from '../types'

const VERIFIER = import.meta.env.VITE_VERIFIER_URL ?? 'http://localhost:3001'

// QuestType enum matches contract: 0=VOTE_COUNT, 1=REFERRAL_COUNT, 2=CREDENTIAL_AGE
const QUEST_TYPE_MAP = { VOTE_COUNT: 0, REFERRAL_COUNT: 1, CREDENTIAL_AGE: 2 } as const

export function useQuests(communityId: string) {
  const { address }            = useAccount()
  const publicClient           = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [quests, setQuests]    = useState<QuestInfo[]>([])
  const [loading, setLoading]  = useState(false)
  const [error, setError]      = useState<string | null>(null)

  const fetchQuests = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${VERIFIER}/communities/${communityId}/quests`)
      setQuests(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [communityId])

  const getProgress = useCallback(async (questId: string): Promise<QuestProgress> => {
    if (!address) return { quest_id: questId, participant: '', progress: 0, completed: false }
    const res = await fetch(`${VERIFIER}/quests/${questId}/progress/${address}`)
    return res.json()
  }, [address])

  const createQuest = useCallback(async (quest: Omit<QuestInfo, 'quest_id' | 'community_id'>) => {
    if (!address) throw new Error('Wallet not connected')

    const questId = keccak256(encodePacked(
      ['bytes32', 'address', 'uint256'],
      [communityId as `0x${string}`, address, BigInt(Date.now())]
    ))
    const rewardHash = keccak256(toHex(quest.reward_description))

    // Pin metadata
    const pinRes = await fetch(`${VERIFIER}/pin/quest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...quest, quest_id: questId, community_id: communityId }),
    })
    const { cid } = await pinRes.json()

    const fees = await getGasFees()
    const hash = await writeContractAsync({
      chain: arbitrumSepolia, account: address,
      address: CONTRACT_ADDRESS, abi: FHENIX_POLL_ABI,
      functionName: 'createQuest',
      args: [
        questId,
        communityId as `0x${string}`,
        QUEST_TYPE_MAP[quest.quest_type],
        quest.target,
        rewardHash,
        quest.expiry_block,
      ],
      ...fees,
    })

    const full: QuestInfo = {
      ...quest, quest_id: questId, community_id: communityId,
      reward_hash: rewardHash, ipfs_cid: cid, creator_address: address,
    }
    await fetch(`${VERIFIER}/quests/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full),
    })

    setQuests(prev => [...prev, full])
    return hash
  }, [address, communityId, writeContractAsync])

  /** Request on-chain progress reveal then wait for tx */
  const requestReveal = useCallback(async (questId: string) => {
    if (!address) throw new Error('Wallet not connected')
    const fees = await getGasFees()
    const hash = await writeContractAsync({
      chain: arbitrumSepolia, account: address,
      address: CONTRACT_ADDRESS, abi: FHENIX_POLL_ABI,
      functionName: 'requestProgressReveal',
      args: [questId as `0x${string}`, address],
      ...fees,
    })
    if (publicClient) await publicClient.waitForTransactionReceipt({ hash })
    return hash
  }, [address, writeContractAsync, publicClient])

  return { quests, loading, error, fetchQuests, getProgress, createQuest, requestReveal }
}
