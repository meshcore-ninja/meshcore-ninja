export default async function fetchOpenHopCoreChangelog({ fetch }) {
  const response = await fetch('https://pypi.org/pypi/openhop-core/json', {
    headers: { 'User-Agent': 'meshcore-ninja' }
  });
  if (!response.ok) throw new Error(`PyPI API ${response.status} for openhop-core`);

  const payload = await response.json();
  return Object.entries(payload.releases ?? {})
    .map(([version, files]) => {
      const published = (files ?? [])
        .map((file) => file.upload_time_iso_8601 ?? file.upload_time)
        .filter(Boolean)
        .sort()
        .at(-1);
      return {
        version,
        name: `openhop-core ${version}`,
        ...(published ? { datetime: published } : {}),
        url: `https://pypi.org/project/openhop-core/${version}/`,
        prerelease: /(?:a|b|rc|dev)\d*$/i.test(version)
      };
    })
    .filter((release) => release.datetime)
    .sort((a, b) => b.datetime.localeCompare(a.datetime))
    .slice(0, 20);
}
