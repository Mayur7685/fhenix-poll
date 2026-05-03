// RequirementsPanel — shows community requirement groups, lets the user verify
// eligibility off-chain, then submits the EIP-712 attestation on-chain.

import { useState } from 'react'
import { useWriteContract } from '../hooks/useWriteContract'
import { useConnection } from 'wagmi'
import { arbitrumSepolia } from '../lib/chains'
import { getGasFees } from '../lib/gas'
import { getCredentialParams } from '../lib/verifier'
import { FHENIX_POLL_ABI, CONTRACT_ADDRESS } from '../lib/abi'
import { publicClient } from '../lib/fhenix'
import ConnectorSelector from './ConnectorSelector'
import type { RequirementGroup, ConnectedAccount, CheckResult } from '../types'

interface Props {
  groups:            RequirementGroup[]
  communityId:       string
  evmAddress:        string
  isConnected:       boolean
  connectedAccounts: ConnectedAccount[]
  onAccountsChange:  (a: ConnectedAccount[]) => void
  onCredentialIssued: () => void
}

const REQ_LABELS: Record<string, string> = {
  FREE:             'Open to everyone',
  ALLOWLIST:        'Allowlist',
  TOKEN_BALANCE:    'Token Balance',
  NFT_OWNERSHIP:    'NFT Ownership',
  ONCHAIN_ACTIVITY: 'On-chain Activity',
  DOMAIN_OWNERSHIP: 'Domain Ownership',
  X_FOLLOW:         'X / Twitter Follow',
  DISCORD_MEMBER:   'Discord Member',
  DISCORD_ROLE:     'Discord Role',
  GITHUB_ACCOUNT:   'GitHub Account',
  TELEGRAM_MEMBER:  'Telegram Member',
}

export default function RequirementsPanel({
  groups,
  communityId,
  evmAddress,
  isConnected,
  connectedAccounts,
  onAccountsChange,
  onCredentialIssued,
}: Props) {
  const { address } = useConnection()
  const { writeContractAsync } = useWriteContract()

  const [results, setResults]     = useState<CheckResult[] | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [status, setStatus]       = useState<'idle' | 'issuing' | 'done' | 'error'>('idle')
  const [txHash, setTxHash]       = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)

  const allReqs      = groups.flatMap(g => g.requirements)
  const needsEVM     = allReqs.some(r => ['TOKEN_BALANCE','NFT_OWNERSHIP','ONCHAIN_ACTIVITY','DOMAIN_OWNERSHIP','ALLOWLIST'].includes(r.type))
  const needsTwitter = allReqs.some(r => r.type === 'X_FOLLOW')
  const needsDiscord = allReqs.some(r => ['DISCORD_MEMBER','DISCORD_ROLE'].includes(r.type))
  const needsGitHub  = allReqs.some(r => r.type === 'GITHUB_ACCOUNT')
  const needsTelegram= allReqs.some(r => r.type === 'TELEGRAM_MEMBER')
  const needsConnectors = needsEVM || needsTwitter || needsDiscord || needsGitHub || needsTelegram
  const isFreeOnly   = allReqs.every(r => r.type === 'FREE')

  const handleVerifyAndIssue = async () => {
    if (!isConnected || !evmAddress || !address) return
    setVerifying(true); setError(null); setResults(null); setStatus('idle'); setTxHash(null)

    try {
      // Step 1: verifier checks requirements and returns EIP-712 attestation
      const res = await getCredentialParams(communityId, evmAddress, connectedAccounts)

      if (!res.passed) {
        setResults(res.results)
        setStatus('error')
        setError('Requirements not met. Check the items above.')
        setVerifying(false)
        return
      }

      setStatus('issuing')
      setVerifying(false)

      // Step 2: submit attestation on-chain — wallet pays gas
      const { attestation, signature } = res
      const { maxFeePerGas, maxPriorityFeePerGas } = await getGasFees()
      const hash = await writeContractAsync({
        chain:   arbitrumSepolia,
        account: address,
        maxFeePerGas,
        maxPriorityFeePerGas,
        address: CONTRACT_ADDRESS,
        abi:     FHENIX_POLL_ABI,
        functionName: 'issueCredential',
        args: [
          {
            recipient:    attestation.recipient,
            communityId:  attestation.communityId,
            nullifier:    attestation.nullifier,
            credType:     attestation.credType,
            votingWeight: attestation.votingWeight,
            expiryBlock:  attestation.expiryBlock,
            issuedAt:     attestation.issuedAt,
            nonce:        attestation.nonce,
          },
          signature,
        ],
      })

      setTxHash(hash)
      await publicClient.waitForTransactionReceipt({ hash })
      setStatus('done')
      onCredentialIssued()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('error')
      setVerifying(false)
    }
  }

  return (
    <div className="border-[1.5px] border-[#0070F3] rounded-xl overflow-hidden bg-white shadow-sm">
      {/* Requirement groups */}
      <div className="p-4 space-y-3">
        {groups.map((group, gi) => (
          <div key={group.id}>
            {groups.length > 1 && (
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                Group {gi + 1} · {group.logic}
              </p>
            )}
            <div className="space-y-1.5">
              {group.requirements.map(req => {
                const result = results?.find(r => r.requirementId === req.id)
                return (
                  <div
                    key={req.id}
                    className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-sm transition-colors
                      ${result?.passed === true  ? 'bg-green-50 border-green-200' :
                        result?.passed === false ? 'bg-red-50 border-red-200' :
                        'bg-gray-50 border-gray-100'}
                    `}
                  >
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0
                        ${result?.passed === true  ? 'bg-[#10B981]' :
                          result?.passed === false ? 'bg-red-400' :
                          'bg-gray-300'}
                      `} />
                      <span className="font-medium text-gray-700">
                        {REQ_LABELS[req.type] ?? req.type}
                      </span>
                      {req.chain && (
                        <span className="text-xs text-gray-400 bg-white border border-gray-100 px-2 py-0.5 rounded-full">
                          {req.chain}
                        </span>
                      )}
                    </div>
                    {result && (
                      <div className="flex flex-col items-end gap-0.5 min-w-0 max-w-[55%]">
                        <span className={`text-xs font-semibold shrink-0 ${result.passed ? 'text-[#10B981]' : 'text-red-500'}`}>
                          {result.passed ? '✓ PASS' : '✕ FAIL'}
                        </span>
                        {result.error && (
                          <span className="text-[10px] text-red-400 text-right leading-tight">
                            {result.error}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {/* Account connectors */}
        {needsConnectors && status !== 'done' && (
          <div className="pt-2">
            <ConnectorSelector accounts={connectedAccounts} onChange={onAccountsChange} />
          </div>
        )}

        {/* Issuing spinner */}
        {status === 'issuing' && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <div className="w-4 h-4 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin shrink-0" />
            <p className="text-sm text-blue-700 font-medium">Submitting credential on Fhenix…</p>
          </div>
        )}

        {/* Success */}
        {status === 'done' && (
          <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl p-3.5">
            <div className="w-6 h-6 rounded-full bg-[#10B981] flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-green-800">Credential issued on-chain!</p>
              <p className="text-xs text-green-600 mt-0.5">Stored on Fhenix. Refresh to see it active.</p>
              {txHash && (
                <a
                  href={`https://sepolia.arbiscan.io/tx/${txHash}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-xs text-green-600 hover:underline mt-0.5 block"
                >
                  View transaction ↗
                </a>
              )}
            </div>
          </div>
        )}

        {/* Requirements failure */}
        {status === 'error' && results && results.some(r => !r.passed) && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3.5">
            <p className="text-sm font-semibold text-red-700">Requirements not met.</p>
            <p className="text-xs text-red-500 mt-0.5">Check the items above and connect the required accounts.</p>
          </div>
        )}

        {error && status === 'error' && !(results && results.some(r => !r.passed)) && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
      </div>

      {/* Action footer */}
      <div className={`px-4 py-4 border-t border-gray-100 ${status === 'done' ? 'bg-[#f0fdf4]' : 'bg-white'}`}>
        {!isConnected ? (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5 text-center">
            Connect your EVM wallet to get a credential.
          </p>
        ) : status !== 'done' ? (
          <button
            onClick={() => void handleVerifyAndIssue()}
            disabled={verifying || status === 'issuing'}
            className="w-full py-3 bg-[#0070F3] hover:bg-blue-600 text-white font-medium rounded-xl text-sm transition-colors shadow-sm disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {(verifying || status === 'issuing') && (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            )}
            {status === 'issuing'
              ? 'Waiting for wallet…'
              : verifying
              ? 'Verifying…'
              : isFreeOnly
              ? 'Get Free Credential'
              : 'Verify & Get Credential'}
          </button>
        ) : (
          <p className="text-sm text-center text-green-700 font-medium">
            ✓ Credential active on-chain
          </p>
        )}
      </div>

      {/* Info footer */}
      <div className="bg-[#0070F3] text-white px-5 py-3.5 text-sm font-medium">
        {isFreeOnly
          ? 'Open to everyone — your wallet submits the credential on Fhenix.'
          : 'Verifier checks eligibility off-chain. Your wallet submits the signed attestation on-chain.'}
      </div>
    </div>
  )
}
