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
  brave_search: {
    serviceName: 'Brave Search',
    url: 'https://brave.com/search/api/',
    label: 'Brave Search API',
    instructions: 'Sign up at Brave Search API, then go to Dashboard → API Keys to get your key (2,000 free/month).',
  },
  brave: {
    serviceName: 'Brave Search',
    url: 'https://brave.com/search/api/',
    label: 'Brave Search API',
    instructions: 'Sign up at Brave Search API, then go to Dashboard → API Keys to get your key (2,000 free/month).',
  },
  openai: {
    serviceName: 'OpenAI',
    url: 'https://platform.openai.com/api-keys',
    label: 'OpenAI API Keys',
    instructions: 'Create a Secret API Key in your OpenAI developer dashboard.',
  },
  groq: {
    serviceName: 'Groq',
    url: 'https://console.groq.com/keys',
    label: 'Groq Console Keys',
    instructions: 'Get an instant free-tier API Key for fast LLM inference.',
  },
  tavily: {
    serviceName: 'Tavily',
    url: 'https://app.tavily.com/home',
    label: 'Tavily Search Dashboard',
    instructions: 'Get your API Key from the Tavily dashboard (1,000 free searches/month).',
  },
  huggingface: {
    serviceName: 'Hugging Face',
    url: 'https://huggingface.co/settings/tokens/new?tokenType=read',
    label: 'Hugging Face Tokens',
    instructions: 'Generate a User Access Token with Read permissions.',
  },
  hf: {
    serviceName: 'Hugging Face',
    url: 'https://huggingface.co/settings/tokens/new?tokenType=read',
    label: 'Hugging Face Tokens',
    instructions: 'Generate a User Access Token with Read permissions.',
  },
  postgres: {
    serviceName: 'PostgreSQL / Supabase',
    url: 'https://supabase.com/dashboard/account/tokens',
    label: 'Supabase Access Tokens',
    instructions: 'Generate a Supabase Access Token, or copy your project API keys from Project Settings → API.',
  },
  postgresql: {
    serviceName: 'PostgreSQL / Supabase',
    url: 'https://supabase.com/dashboard/account/tokens',
    label: 'Supabase Access Tokens',
    instructions: 'Generate a Supabase Access Token, or copy your project API keys from Project Settings → API.',
  },
  sqlite: {
    serviceName: 'Turso SQLite',
    url: 'https://app.turso.tech',
    label: 'Turso Cloud Console',
    instructions: 'Log in, go to your database, and generate an Auth Token.',
  },
  turso: {
    serviceName: 'Turso SQLite',
    url: 'https://app.turso.tech',
    label: 'Turso Cloud Console',
    instructions: 'Log in, go to your database, and generate an Auth Token.',
  },
  airtable: {
    serviceName: 'Airtable',
    url: 'https://airtable.com/create/tokens',
    label: 'Airtable Token Creator',
    instructions: 'Create a Personal Access Token with data.records:read & write scopes.',
  },
  google_maps: {
    serviceName: 'Google Maps',
    url: 'https://console.cloud.google.com/google/maps-apis/credentials',
    label: 'Google Cloud Credentials',
    instructions: 'Create an API key with Google Maps Platform APIs enabled.',
  },
  maps: {
    serviceName: 'Google Maps',
    url: 'https://console.cloud.google.com/google/maps-apis/credentials',
    label: 'Google Cloud Credentials',
    instructions: 'Create an API key with Google Maps Platform APIs enabled.',
  },
  notion: {
    serviceName: 'Notion',
    url: 'https://www.notion.so/my-integrations',
    label: 'Notion My Integrations',
    instructions: 'Create an internal integration and copy the Internal Integration Secret.',
  },
  linear: {
    serviceName: 'Linear',
    url: 'https://linear.app/settings/api',
    label: 'Linear API Settings',
    instructions: 'Generate a Personal API Key in your Linear account settings.',
  },
  gitlab: {
    serviceName: 'GitLab',
    url: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    label: 'GitLab Access Tokens',
    instructions: 'Generate a Personal Access Token with api or read_api scopes.',
  },
  sentry: {
    serviceName: 'Sentry',
    url: 'https://sentry.io/settings/account/api/auth-tokens/',
    label: 'Sentry Auth Tokens',
    instructions: 'Create a User Auth Token with project:read and project:write scopes.',
  },
  anthropic: {
    serviceName: 'Anthropic',
    url: 'https://console.anthropic.com/settings/keys',
    label: 'Anthropic Console',
    instructions: 'Generate an API key in the Anthropic Console.',
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
