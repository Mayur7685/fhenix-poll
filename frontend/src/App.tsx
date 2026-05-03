import { Navigate, Routes, Route } from 'react-router-dom'
import { useWallet } from './hooks/useWallet'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import PollFeed from './pages/PollFeed'
import CommunityFeed from './pages/CommunityFeed'
import CommunityDetail from './pages/CommunityDetail'
import CommunityPosts from './pages/CommunityPosts'
import CommunityQuests from './pages/CommunityQuests'
import PollDetail from './pages/PollDetail'
import PollResults from './pages/PollResults'
import CreateCommunity from './pages/CreateCommunity'
import CreatePoll from './pages/CreatePoll'
import MyCredentials from './pages/MyCredentials'
import CredentialsHub from './pages/CredentialsHub'
import MyVotes from './pages/MyVotes'

function HomeGate() {
  const { isConnected } = useWallet()
  return isConnected ? <Navigate to="/polls" replace /> : <LandingPage />
}

export default function App() {
  return (
    <Routes>
      <Route index element={<HomeGate />} />
      <Route element={<Layout />}>
        <Route path="polls" element={<PollFeed />} />
        <Route path="communities" element={<CommunityFeed />} />
        <Route path="communities/:id" element={<CommunityDetail />} />
        <Route path="communities/:id/posts" element={<CommunityPosts />} />
        <Route path="communities/:id/quests" element={<CommunityQuests />} />
        <Route path="communities/:communityId/polls/:pollId" element={<PollDetail />} />
        <Route path="communities/:communityId/polls/:pollId/results" element={<PollResults />} />
        <Route path="create" element={<CreateCommunity />} />
        <Route path="create-poll" element={<CreatePoll />} />
        <Route path="credentials" element={<CredentialsHub />} />
        <Route path="my-credentials" element={<MyCredentials />} />
        <Route path="my-votes" element={<MyVotes />} />
      </Route>
    </Routes>
  )
}
