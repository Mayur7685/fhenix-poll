// Skeleton loading placeholders — shimmer via CSS .skeleton class.

interface Props {
  className?: string
}

export function Skeleton({ className = '' }: Props) {
  return <div className={`skeleton rounded-md ${className}`} />
}

export function SkeletonCard() {
  return (
    <div className="border border-gray-100 bg-white rounded-[1.25rem] p-5 flex flex-col gap-3 min-h-[160px]">
      <div className="flex justify-between items-start">
        <div className="skeleton h-4 w-2/3 rounded" />
        <div className="skeleton h-6 w-12 rounded-lg" />
      </div>
      <div className="skeleton h-3 w-full rounded" />
      <div className="skeleton h-3 w-4/5 rounded" />
      <div className="mt-auto flex gap-1.5">
        <div className="skeleton h-5 w-16 rounded-full" />
        <div className="skeleton h-5 w-20 rounded-full" />
        <div className="skeleton h-5 w-14 rounded-full" />
      </div>
    </div>
  )
}

export function SkeletonCommunityCard() {
  return (
    <div className="flex items-center justify-between p-3.5 border border-gray-100 rounded-xl bg-white">
      <div className="flex items-center gap-3.5">
        <div className="skeleton w-8 h-8 rounded-full" />
        <div className="flex flex-col gap-1.5">
          <div className="skeleton h-3.5 w-28 rounded" />
          <div className="skeleton h-3 w-20 rounded" />
        </div>
      </div>
    </div>
  )
}
