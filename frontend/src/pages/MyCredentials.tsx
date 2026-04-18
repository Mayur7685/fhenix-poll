import ZKCredentialPanel from '../components/ZKCredentialPanel'

export default function MyCredentials() {
  return (
    <div className="max-w-md mx-auto w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">My Credentials</h1>
        <p className="text-sm text-gray-500 mt-1.5 leading-relaxed max-w-sm">
          On-chain credentials from communities you've joined on Fhenix.
          They gate voting access and track your decaying voting power.
        </p>
      </div>
      <ZKCredentialPanel />
    </div>
  )
}
