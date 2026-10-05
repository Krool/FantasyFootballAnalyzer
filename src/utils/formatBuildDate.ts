// One format for the pool build stamp on every page ("Oct 5"). Explicit locale
// and UTC so the prerendered HTML (HomeHero) and the live pages agree and don't
// depend on the build machine's or viewer's timezone.
export function formatBuildDate(iso: string | number | Date): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}
