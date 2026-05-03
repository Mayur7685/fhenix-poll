import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { usePosts } from '../hooks/usePosts'
import CreatePostModal from '../components/CreatePostModal'

export default function CommunityPosts() {
  const { id = '' } = useParams<{ id: string }>()
  const { address } = useAccount()
  const { posts, loading, error, fetchPosts, createPost } = usePosts(id)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => { fetchPosts() }, [fetchPosts])

  return (
    <div className="max-w-2xl mx-auto w-full space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Link to={`/communities/${id}`} className="text-sm text-gray-500 hover:text-gray-900">← Community</Link>
          <span className="text-gray-300">/</span>
          <h1 className="text-sm font-semibold text-gray-900">Posts</h1>
        </div>
        {address && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 text-xs font-medium bg-gray-900 text-white px-3.5 py-2 rounded-full hover:bg-gray-800 transition-colors"
          >
            + New Post
          </button>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-[#0070F3] border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {error && <p className="text-sm text-red-500 text-center">{error}</p>}

      {!loading && posts.length === 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl p-10 text-center">
          <p className="text-sm text-gray-500 mb-3">No posts yet.</p>
          {address && (
            <button onClick={() => setShowModal(true)}
              className="text-sm font-medium text-[#0070F3] hover:underline">
              Be the first to post →
            </button>
          )}
        </div>
      )}

      <div className="space-y-4">
        {posts.map(post => (
          <div key={post.post_id} className="bg-white border border-gray-100 rounded-2xl p-5 shadow-sm">
            <div className="flex items-start justify-between gap-3 mb-2">
              <h2 className="text-sm font-semibold text-gray-900">{post.title}</h2>
              <span className="text-xs text-gray-400 shrink-0">
                {post.author.slice(0, 6)}…{post.author.slice(-4)}
              </span>
            </div>
            <p className="text-sm text-gray-600 whitespace-pre-wrap leading-relaxed">{post.body}</p>
            {post.ipfs_cid && (
              <a
                href={`https://ipfs.io/ipfs/${post.ipfs_cid}`}
                target="_blank" rel="noreferrer"
                className="text-xs text-[#0070F3] hover:underline mt-2 inline-block"
              >
                View on IPFS ↗
              </a>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <CreatePostModal
          onSubmit={createPost}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  )
}
