import axios from "axios"

interface GitHubParams {
  minRepos?:     number
  minFollowers?: number
  orgName?:      string
  /** "owner/repo" — user must have at least minCommits commits here */
  commitsRepo?:  string
  minCommits?:   number
  /** "owner/repo" — user must have starred this repo (requires userToken) */
  starredRepo?:  string
}

/**
 * Check whether a GitHub user meets optional criteria.
 *
 * Public checks (no token needed): minRepos, minFollowers, orgName, commits to a repo.
 * Auth-required checks: starredRepo  — pass the user's OAuth access token.
 */
export async function checkGitHubAccount(
  username: string,
  params: GitHubParams = {},
  userToken?: string | null,
): Promise<boolean> {
  if (!username) return false

  const headers: Record<string, string> = {
    Accept:               'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
  if (userToken) headers['Authorization'] = `Bearer ${userToken}`

  try {
    // ── Basic profile (public repos + followers) ──────────────────────────────
    const res = await axios.get(`https://api.github.com/users/${encodeURIComponent(username)}`, { headers })
    if (res.status !== 200) return false
    const user = res.data as { public_repos: number; followers: number }

    if (params.minRepos     !== undefined && user.public_repos < params.minRepos)     return false
    if (params.minFollowers !== undefined && user.followers    < params.minFollowers)  return false

    // ── Org membership ────────────────────────────────────────────────────────
    if (params.orgName) {
      try {
        await axios.get(
          `https://api.github.com/orgs/${encodeURIComponent(params.orgName)}/members/${encodeURIComponent(username)}`,
          { headers },
        )
      } catch {
        return false  // 404 = not a member
      }
    }

    // ── Commits to a specific repo ────────────────────────────────────────────
    // Uses ?per_page=1 — if the response is non-empty the user has committed.
    // Link header "last" page number gives total count without fetching everything.
    if (params.commitsRepo) {
      const [owner, repo] = params.commitsRepo.split('/')
      if (!owner || !repo) return false

      let commitCount = 0
      try {
        const cr = await axios.get(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits`,
          { headers, params: { author: username, per_page: 1 } },
        )
        if ((cr.data as unknown[]).length === 0) {
          return false  // No commits at all
        }
        // Parse Link header to get total count
        const link = cr.headers['link'] as string | undefined
        if (link) {
          const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/)
          commitCount = match ? parseInt(match[1], 10) : 1
        } else {
          commitCount = (cr.data as unknown[]).length  // Only 1 page
        }
      } catch {
        return false
      }

      const required = params.minCommits ?? 1
      if (commitCount < required) return false
    }

    // ── Starred repo ──────────────────────────────────────────────────────────
    if (params.starredRepo) {
      if (!userToken) {
        throw new Error("GitHub user token required to check starred repos — reconnect your GitHub account")
      }
      const [sOwner, sRepo] = params.starredRepo.split('/')
      if (!sOwner || !sRepo) return false

      // List starred repos and search — more reliable than /user/starred/{owner}/{repo}
      let starred = false
      let page = 1
      outer: while (page <= 10) {  // cap at 1000 stars
        const listRes = await axios.get('https://api.github.com/user/starred', {
          headers,
          params: { per_page: 100, page },
        })
        const repos = listRes.data as { full_name: string }[]
        if (repos.length === 0) break
        for (const r of repos) {
          if (r.full_name.toLowerCase() === `${sOwner}/${sRepo}`.toLowerCase()) {
            starred = true; break outer
          }
        }
        page++
      }
      if (!starred) return false
    }

    return true
  } catch (e: any) {
    if (e.message?.includes("GitHub user token required")) throw e
    return false
  }
}
