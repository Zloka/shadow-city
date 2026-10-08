export type WikipediaSummary = {
  title: string
  extract: string
  thumbnail: string | null
  url: string
}

// Wikipedia language editions to try, in order, when a place only has a Wikidata id.
const LANGUAGES = ['en', 'fi', 'sv']

/**
 * A short Wikipedia summary and photo for a place tagged with `wikipedia` ("fi:Title") or
 * `wikidata` ("Q123"). Both APIs allow browser requests without a key. Resolves to null when
 * there is no article or it is only a disambiguation page.
 */
export async function fetchWikipediaSummary(
  wikipedia: string | null,
  wikidata: string | null,
  signal: AbortSignal,
): Promise<WikipediaSummary | null> {
  let article = wikipedia ? parseWikipediaTag(wikipedia) : null
  if (!article && wikidata) article = await articleFromWikidata(wikidata, signal)
  if (!article) return null

  const response = await fetch(
    `https://${article.language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(article.title)}`,
    { signal },
  )
  if (!response.ok) return null
  const summary = (await response.json()) as {
    type: string
    title: string
    extract?: string
    thumbnail?: { source: string }
    content_urls?: { desktop?: { page?: string } }
  }
  if (summary.type === 'disambiguation' || !summary.extract) return null
  return {
    title: summary.title,
    extract: summary.extract,
    thumbnail: summary.thumbnail?.source ?? null,
    url: summary.content_urls?.desktop?.page ?? `https://${article.language}.wikipedia.org/wiki/${article.title}`,
  }
}

function parseWikipediaTag(tag: string): { language: string; title: string } | null {
  const match = tag.match(/^([a-z-]+):(.+)$/)
  return match ? { language: match[1], title: match[2].replaceAll(' ', '_') } : null
}

async function articleFromWikidata(
  id: string,
  signal: AbortSignal,
): Promise<{ language: string; title: string } | null> {
  if (!/^Q\d+$/.test(id)) return null
  const response = await fetch(`https://www.wikidata.org/wiki/Special:EntityData/${id}.json`, { signal })
  if (!response.ok) return null
  const json = (await response.json()) as {
    entities: Record<string, { sitelinks?: Record<string, { title: string }> }>
  }
  const sitelinks = Object.values(json.entities)[0]?.sitelinks ?? {}
  for (const language of LANGUAGES) {
    const link = sitelinks[`${language}wiki`]
    if (link) return { language, title: link.title.replaceAll(' ', '_') }
  }
  return null
}
