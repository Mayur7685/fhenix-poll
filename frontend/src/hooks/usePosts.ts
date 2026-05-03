import { useState, useCallback } from 'react'
import { useAccount } from 'wagmi'
import { useWriteContract } from './useWriteContract'
import { keccak256, toHex, encodePacked } from 'viem'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import { arbitrumSepolia } from '../lib/chains'
import { getGasFees } from '../lib/gas'
import type { PostMetadata } from '../types'

const VERIFIER = import.meta.env.VITE_VERIFIER_URL ?? 'http://localhost:3001'

export function usePosts(communityId: string) {
  const { address } = useAccount()
  const { writeContractAsync } = useWriteContract()
  const [posts, setPosts]     = useState<PostMetadata[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const fetchPosts = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${VERIFIER}/communities/${communityId}/posts`)
      setPosts(await res.json())
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [communityId])

  const createPost = useCallback(async (title: string, body: string) => {
    if (!address) throw new Error('Wallet not connected')

    // 1. Derive post ID
    const postId = keccak256(encodePacked(
      ['bytes32', 'address', 'uint256'],
      [communityId as `0x${string}`, address, BigInt(Date.now())]
    ))

    // 2. Pin content to IPFS via verifier
    const pinRes = await fetch(`${VERIFIER}/pin/post`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        post_id: postId, community_id: communityId, author: address,
        title, body, created_at_block: 0,
        content_hash: keccak256(toHex(title + body)),
      }),
    })
    const { cid } = await pinRes.json()
    const contentHash = keccak256(toHex(cid || (title + body)))

    // 3. Submit on-chain
    const fees = await getGasFees()
    const hash = await writeContractAsync({
      chain: arbitrumSepolia, account: address,
      address: CONTRACT_ADDRESS, abi: FHENIX_POLL_ABI,
      functionName: 'createPost',
      args: [postId, communityId as `0x${string}`, contentHash],
      ...fees,
    })

    // 4. Confirm with verifier after tx
    const post: PostMetadata = {
      post_id: postId, community_id: communityId, author: address,
      title, body, ipfs_cid: cid, content_hash: contentHash,
      created_at_block: 0,
    }
    await fetch(`${VERIFIER}/posts/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(post),
    })

    setPosts(prev => [post, ...prev])
    return hash
  }, [address, communityId, writeContractAsync])

  return { posts, loading, error, fetchPosts, createPost }
}
