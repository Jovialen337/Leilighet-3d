/**
 * Hvor apartment.json bor på GitHub. Utledes fra GitHub Pages-adressen
 * (<eier>.github.io/<repo>/); ellers brukes standardrepoet.
 */
export const DEFAULT_REPO = { owner: 'Jovialen337', repo: 'Leilighet-3d', branch: 'main' } as const;

export interface RepoRef {
  owner: string;
  repo: string;
  branch: string;
}

export function repoFromLocation(loc: { hostname: string; pathname: string } = location): RepoRef {
  const host = /^([^.]+)\.github\.io$/i.exec(loc.hostname);
  const first = loc.pathname.split('/').filter(Boolean)[0];
  if (host?.[1] && first) return { owner: host[1], repo: first, branch: DEFAULT_REPO.branch };
  return { ...DEFAULT_REPO };
}

/** Opplastingssiden for public/-mappa (dra inn apartment.json og trykk «Commit changes»). */
export const uploadUrl = (r: RepoRef): string =>
  `https://github.com/${r.owner}/${r.repo}/upload/${r.branch}/public`;
