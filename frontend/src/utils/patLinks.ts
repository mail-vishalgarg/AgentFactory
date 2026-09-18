export interface PatInfo {
  serviceName: string
  url: string
  label: string
  instructions: string
  scopes?: string
}

export const KNOWN_PAT_SERVICES: Record<string, PatInfo> = {
  github: {
    serviceName: 'GitHub',
    url: 'https://github.com/settings/tokens/new?description=AgentFactory&scopes=repo,read:org,workflow',
    label: 'GitHub PAT Settings',
    instructions: 'Create a Personal Access Token with repo and workflow scopes.',
    scopes: 'repo, read:org, workflow',
  },
  slack: {
    serviceName: 'Slack',
    url: 'https://api.slack.com/apps',
    label: 'Slack Apps Console',
    instructions: 'Create an app & obtain a Bot User OAuth Token (xoxb-...) under OAuth & Permissions.',
    scopes: 'channels:read, chat:write, chat:write.public',
  },
  tavily: {
    serviceName: 'Tavily',
    url: 'https://app.tavily.com/home',
    label: 'Tavily Search Dashboard',
    instructions: 'Get your API Key from the Tavily dashboard (1,000 free searches/month).',
  },
  gitlab: {
    serviceName: 'GitLab',
    url: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    label: 'GitLab Access Tokens',
    instructions: 'Generate a Personal Access Token with api or read_api scopes.',
  },
}

export function getPatInfo(serverName: string, endpoint?: string, tokenGuide?: string): PatInfo {
  // If tokenGuide has an explicit URL, prefer that URL
  if (tokenGuide) {
    const urlMatch = tokenGuide.match(/https?:\/\/[^\s\)]+/)
    if (urlMatch) {
      const matchedUrl = urlMatch[0]
      const cleanGuide = tokenGuide.replace(matchedUrl, '').replace(/[()]/g, '').trim()
      return {
        serviceName: serverName,
        url: matchedUrl,
        label: `${serverName} PAT Page`,
        instructions: cleanGuide || `Generate your access token for ${serverName}`,
      }
    }
  }

  const norm = serverName.toLowerCase().replace(/[-_ ]+/g, '_')

  for (const [key, info] of Object.entries(KNOWN_PAT_SERVICES)) {
    if (norm === key || norm.includes(key) || key.includes(norm)) {
      return info
    }
  }

  // Fallback to endpoint if it is a remote website
  if (
    endpoint &&
    (endpoint.startsWith('http://') || endpoint.startsWith('https://')) &&
    !endpoint.includes('localhost') &&
    !endpoint.includes('127.0.0.1')
  ) {
    try {
      const parsed = new URL(endpoint)
      return {
        serviceName: parsed.hostname,
        url: `${parsed.protocol}//${parsed.hostname}`,
        label: `${parsed.hostname} Portal`,
        instructions: `Visit ${parsed.hostname} to obtain API credentials for ${serverName}.`,
      }
    } catch {
      // ignore
    }
  }

  return {
    serviceName: serverName,
    url: `https://www.google.com/search?q=${encodeURIComponent(serverName + ' API key PAT token generate documentation')}`,
    label: `${serverName} Docs / Key Search`,
    instructions: `Obtain your API Key or Personal Access Token from the ${serverName} provider portal.`,
  }
}
