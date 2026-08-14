<script>
  import { base } from '$app/paths';
  import { href } from '$lib/i18n.js';
  import { m } from '$lib/paraglide/messages.js';
  import RecordFooter from '$lib/RecordFooter.svelte';
  import BackLink from '$lib/BackLink.svelte';
  import {
    SOFTWARE_KIND_META,
    SOFTWARE_STATUS_META,
    LICENSE_TYPE_META,
    licenseType,
    licenseTypeLabel,
    softwareKindLabel,
    softwareStatusLabel,
    nodeRoleLabel,
    softwareCapabilityLabel,
    groupReleases,
    descriptionToPlain,
    getDevice
  } from '$lib/data.js';
  import { clampDescription, ogImageFor } from '$lib/seo.js';
  import Seo from '$lib/Seo.svelte';
  import ReleaseGroupList from '$lib/ReleaseGroupList.svelte';
  import ScreenshotGallery from '$lib/ScreenshotGallery.svelte';
  import RichText from '$lib/RichText.svelte';
  import SoftwareIcon from '$lib/SoftwareIcon.svelte';
  import PlatformIcon from '$lib/PlatformIcon.svelte';
  import ProgrammingLanguageIcon from '$lib/ProgrammingLanguageIcon.svelte';
  let { data } = $props();
  let s = $derived(data.software);
  let meta = $derived(SOFTWARE_KIND_META[s.kind]);

  const PREVIEW = 3;
  let releaseGroups = $derived(groupReleases(s.releases));
  let previewGroups = $derived(releaseGroups.slice(0, PREVIEW));

  const MATURITY_META = {
    experimental: { label: m.maturity_experimental(), tw: 'bg-bad/15 text-bad' },
    alpha: { label: m.maturity_alpha(), tw: 'bg-warn/15 text-warn' },
    beta: { label: m.maturity_beta(), tw: 'bg-accent2/15 text-accent2' },
    stable: { label: m.maturity_stable(), tw: 'bg-ok/15 text-ok' }
  };
  const INTERFACE_LABELS = { gui: 'GUI', mobile: 'Mobile', web: 'Web', cli: 'CLI', tui: 'TUI', api: 'API', headless: 'Headless' };
  const CONNECTION_LABELS = { ble: 'BLE', serial: 'Serial', usb: 'USB', tcp: 'TCP', udp: 'UDP', websocket: 'WebSocket', mqtt: 'MQTT', http: 'HTTP', ipc: 'IPC' };
  const INSTALL_LABELS = {
    'app-store': 'App Store', 'play-store': 'Play Store', zapstore: 'Zapstore', 'github-release': 'GitHub release',
    docker: 'Docker', 'docker-compose': 'Docker Compose', desktop: 'Desktop app', helm: 'Kubernetes / Helm',
    'proxmox-lxc': 'Proxmox LXC', nixos: 'NixOS Flake', 'bare-metal': 'Bare metal',
    aur: 'AUR', flatpak: 'Flatpak', homebrew: 'Homebrew', npm: 'npm', pypi: 'PyPI', cargo: 'Cargo',
    'go-install': 'go install', hacs: 'HACS', esphome: 'ESPHome', source: 'Source', web: 'Web', manual: 'Manual'
  };
  const POPULARITY_LABELS = {
    githubStars: m.spec_github_stars(),
    githubForks: m.spec_forks(),
    githubWatchers: m.spec_watchers(),
    githubOpenIssues: m.spec_open_issues(),
    githubContributors: m.spec_contributors(),
    releaseDownloads: m.spec_release_downloads(),
    latestReleaseDownloads: m.spec_latest_downloads()
  };
  const VERIFICATION_LABELS = {
    sourceAvailable: m.license_source_available(),
    releasesAvailable: m.spec_releases_available(),
    signedReleases: m.spec_signed_releases(),
    ciBuilds: m.spec_ci_builds(),
    hasDocumentation: m.spec_documentation()
  };
  const numberFmt = new Intl.NumberFormat();
  const formatNumber = (v) => numberFmt.format(v);
  const boolLabel = (v) => (v ? m.common_yes() : m.common_no());
  const boolTone = (v) => (v ? 'border-accent/40 bg-accent/10 text-accent' : 'border-edge bg-elev2 text-dim');

  let links = $derived(
    [
      s.repository ? { label: m.spec_repository(), url: s.repository } : null,
      s.website ? { label: m.spec_website(), url: s.website } : null,
      s.documentation ? { label: m.spec_documentation(), url: s.documentation } : null
    ].filter(Boolean)
  );

  let maintainers = $derived(s.maintainers ?? []);
  let licensing = $derived(licenseType(s));

  // Link the latest-version field to its release card when one is on the page.
  let latestReleaseId = $derived(
    s.latest_version && releaseGroups.some((g) => g.version === s.latest_version)
      ? `release-${s.latest_version}`
      : null
  );

  let specs = $derived(
    [
      meta ? { label: m.spec_kind(), value: softwareKindLabel(s.kind) } : null,
      s.maturity ? { label: m.spec_maturity(), value: MATURITY_META[s.maturity]?.label ?? s.maturity } : null,
      s.languages?.length
        ? { label: s.languages.length > 1 ? m.spec_languages() : m.spec_language(), languages: s.languages }
        : null,
      licensing ? { label: m.spec_licensing(), value: licenseTypeLabel(licensing), tw: LICENSE_TYPE_META[licensing]?.tw } : null,
      s.latest_version
        ? {
            label: m.spec_latest_version(),
            value: s.released ? `${s.latest_version} · ${s.released}` : s.latest_version,
            anchor: latestReleaseId ? `#${latestReleaseId}` : null
          }
        : null,
      s.license ? { label: m.spec_license(), value: s.license } : null,
      s.platforms?.length ? { label: m.spec_platforms(), platforms: s.platforms } : null
    ].filter(Boolean)
  );

  let chipGroups = $derived(
    [
      s.interfaces?.length ? { label: m.spec_interfaces(), items: s.interfaces.map((i) => INTERFACE_LABELS[i] ?? i) } : null,
      s.connections?.length ? { label: m.spec_connections(), items: s.connections.map((c) => CONNECTION_LABELS[c] ?? c) } : null,
      s.capabilities?.length ? { label: m.spec_capabilities(), items: s.capabilities.map((c) => softwareCapabilityLabel(c)) } : null,
      s.node_roles?.length ? { label: m.spec_node_roles(), items: s.node_roles.map((r) => nodeRoleLabel(r)) } : null
    ].filter(Boolean)
  );

  let screenshots = $derived((s.screenshotUrls ?? []).filter((shot) => shot.url));
  let supportedDevices = $derived((s.refs?.devices ?? []).map((id) => getDevice(id)).filter(Boolean));

  let popularityEntries = $derived(
    Object.entries(POPULARITY_LABELS)
      .map(([key, label]) => ({ key, label, value: s.popularity?.[key] }))
      .filter((item) => Number.isFinite(item.value))
  );
  let verificationEntries = $derived(
    Object.entries(VERIFICATION_LABELS)
      .map(([key, label]) => ({ key, label, value: s.verification?.[key] }))
      .filter((item) => typeof item.value === 'boolean')
  );

  let description = $derived(
    clampDescription(descriptionToPlain(s.description) || m.sw_meta_desc({ name: s.name, kind: softwareKindLabel(s.kind) }))
  );
</script>

<Seo title={s.name} description={description} type="article" image={ogImageFor('software', s.id)} />

<BackLink href={href('/software/')}>{m.back_software()}</BackLink>

<header class="mb-6 flex flex-wrap items-start gap-5">
  <SoftwareIcon src={s.imageUrl} name={s.name} kind={s.kind} class="h-24 w-24 rounded-2xl" />
  <div class="min-w-[260px] flex-1">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-[clamp(1.5rem,5vw,2rem)] font-bold">{s.name}</h1>
      {#if meta}
        <span class="rounded-md px-2 py-0.5 text-[0.72rem] font-bold tracking-wide uppercase {meta.tw}">
          {meta.singular}
        </span>
      {/if}
      {#if s.maturity}
        <span class="rounded-md px-2 py-0.5 text-[0.72rem] font-bold tracking-wide uppercase {MATURITY_META[s.maturity]?.tw ?? 'bg-elev2 text-dim'}">
          {MATURITY_META[s.maturity]?.label ?? s.maturity}
        </span>
      {/if}
      {#if s.status && s.status !== 'active'}
        <span class="text-[0.85rem] font-medium {SOFTWARE_STATUS_META[s.status]?.tw ?? 'text-dim'}">
          {softwareStatusLabel(s.status)}
        </span>
      {/if}
    </div>
    {#if s.short_name && s.short_name !== s.name}
      <p class="font-mono text-[0.85rem] text-dim">{s.short_name}</p>
    {/if}
    {#if s.also_known_as?.length}
      <p class="mt-0.5 text-[0.9rem] text-dim">{s.also_known_as.join(' · ')}</p>
    {/if}
    {#if s.description}<RichText class="mt-1 max-w-[70ch] text-dim" text={s.description} />{/if}
    {#if links.length}
      <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.92rem]">
        {#each links as link (link.label)}
          <a class="text-accent2 hover:underline" href={link.url} target="_blank" rel="noreferrer">{link.label} ↗</a>
        {/each}
      </div>
    {/if}
  </div>
</header>

{#if specs.length || maintainers.length}
  <dl class="mb-7 rounded-xl border border-edge bg-elev p-[1.1rem]">
    {#if maintainers.length}
      <!-- Maintainer can be a long list, so it gets its own row above the
           compact metadata grid instead of distorting the columns. -->
      <div class="mb-3 border-b border-edge pb-3">
        <dt class="text-[0.72rem] tracking-wide text-dim uppercase">{maintainers.length > 1 ? m.spec_maintainers() : m.spec_maintainer()}</dt>
        <dd class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.95rem]">
          {#each maintainers as m, i (m.name)}
            {#if i > 0}<span class="text-muted">·</span>{/if}
            {#if m.url}
              <a class="text-accent2 hover:underline" href={m.url} target="_blank" rel="noreferrer">{m.name} ↗</a>
            {:else}
              <span>{m.name}</span>
            {/if}
          {/each}
        </dd>
      </div>
    {/if}
    <div class="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
      {#each specs as spec (spec.label)}
        <div class={spec.platforms ? 'col-span-2' : ''}>
          <dt class="text-[0.72rem] tracking-wide text-dim uppercase">{spec.label}</dt>
          <dd class="mt-1 text-[0.95rem]">
            {#if spec.platforms}
              <span class="flex flex-wrap items-center gap-1.5">
                {#each spec.platforms as platform (platform)}
                  <span class="inline-flex items-center rounded-md bg-elev2 px-2 py-0.5">
                    <PlatformIcon {platform} showLabel size={16} />
                  </span>
                {/each}
              </span>
            {:else if spec.languages}
              <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
                {#each spec.languages as language (language)}
                  <ProgrammingLanguageIcon {language} showLabel size={16} />
                {/each}
              </span>
            {:else if spec.anchor}
              <a class="text-accent2 hover:underline" href={spec.anchor}>{spec.value}</a>
            {:else if spec.url}
              <a class="text-accent2 hover:underline" href={spec.url} target="_blank" rel="noreferrer">{spec.value}</a>
            {:else if spec.tw}
              <span class="inline-block rounded px-1.5 py-0.5 text-[0.78rem] font-medium {spec.tw}">{spec.value}</span>
            {:else}{spec.value}{/if}
          </dd>
        </div>
      {/each}
    </div>
  </dl>
{/if}

{#if screenshots.length}
  <section class="mb-7">
    <h2 class="mb-3 border-b border-edge pb-1.5 text-[1.1rem] font-semibold">{m.spec_screenshots()}</h2>
    <ScreenshotGallery shots={screenshots} alt={s.name} />
  </section>
{/if}

{#if supportedDevices.length}
  <section class="mb-7">
    <h2 class="mb-3 border-b border-edge pb-1.5 text-[1.1rem] font-semibold">
      {m.nd_compatible_devices({ count: supportedDevices.length })}
    </h2>
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {#each supportedDevices as device (device.id)}
        <a
          href={href(`/device/${device.id}/`)}
          class="rounded-lg border border-edge bg-elev px-3 py-2 text-[0.9rem] hover:border-accent hover:text-accent"
        >{device.name}</a>
      {/each}
    </div>
  </section>
{/if}

{#if chipGroups.length}
  <section class="mb-7">
    <h2 class="mb-3 border-b border-edge pb-1.5 text-[1.1rem] font-semibold">{m.spec_capabilities()}</h2>
    <!-- Grouped cards mirror the firmware CapabilityMatrix; each item is a
         capability the software has, so all entries render as present (✓). -->
    <div class="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
      {#each chipGroups as grp (grp.label)}
        <div class="rounded-xl border border-edge bg-elev p-3.5">
          <h3 class="mb-2 text-[0.72rem] font-semibold tracking-wide text-dim uppercase">{grp.label}</h3>
          <ul class="flex flex-col gap-1.5">
            {#each grp.items as item (item)}
              <li class="flex items-center gap-2 text-[0.88rem]">
                <span class="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ok/15 text-[0.7rem] text-ok">✓</span>
                <span>{item}</span>
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </section>
{/if}

{#if s.install?.length}
  <section class="mb-7">
    <h2 class="mb-3 border-b border-edge pb-1.5 text-[1.1rem] font-semibold">{m.spec_install()}</h2>
    <ul class="space-y-2">
      {#each s.install as inst (inst.type + (inst.package ?? '') + (inst.url ?? ''))}
        <li class="flex flex-wrap items-center gap-2 rounded-lg border border-edge bg-elev px-3 py-2">
          <span class="rounded-md bg-elev2 px-2 py-0.5 text-[0.72rem] font-semibold">{INSTALL_LABELS[inst.type] ?? inst.type}</span>
          {#if inst.package}<code class="font-mono text-[0.82rem]">{inst.package}</code>{/if}
          {#if inst.command}<code class="rounded bg-elev2 px-1.5 py-0.5 font-mono text-[0.78rem] text-dim">{inst.command}</code>{/if}
          {#if inst.url}
            <a class="ml-auto text-[0.85rem] text-accent2 hover:underline" href={inst.url} target="_blank" rel="noreferrer">{m.detail_open()}</a>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}

{#if releaseGroups.length}
  <section class="mb-7">
    <div class="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b border-edge pb-1.5">
      <h2 class="text-[1.1rem] font-semibold">{m.spec_releases()}</h2>
      {#if s.changelogUpdatedAt}
        <span class="text-[0.72rem] text-dim">
          {s.changelogSource === 'github' ? m.detail_from_github() : ''}{m.detail_updated({ date: s.changelogUpdatedAt.slice(0, 10) })}
        </span>
      {/if}
    </div>
    <ReleaseGroupList groups={previewGroups} openFirst={false} markFirstLatest={true} />
    {#if releaseGroups.length > PREVIEW}
      <a class="mt-3 inline-block text-[0.88rem] text-accent2 hover:underline" href={href(`/software/${s.id}/releases/`)}>
        {m.detail_show_all_releases({ count: releaseGroups.length })}
      </a>
    {/if}
  </section>
{/if}

{#if popularityEntries.length || verificationEntries.length || s.verification?.notes?.length}
  <section class="mb-7 rounded-xl border border-edge bg-elev/60 px-3 py-2.5">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <h2 class="text-[0.72rem] font-semibold tracking-wide text-dim uppercase">{m.detail_project_signals()}</h2>
      <div class="flex flex-wrap gap-x-3 gap-y-1 text-[0.7rem] text-muted">
        {#if s.popularity?.lastChecked}<span>{m.spec_popularity_checked({ date: s.popularity.lastChecked })}</span>{/if}
        {#if s.verification?.lastChecked}<span>{m.spec_verification_checked_label({ date: s.verification.lastChecked })}</span>{/if}
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
      {#if popularityEntries.length}
        <dl class="flex flex-wrap gap-x-4 gap-y-1.5">
          {#each popularityEntries as item (item.key)}
            <div class="inline-flex items-baseline gap-1.5">
              <dt class="text-[0.68rem] tracking-wide text-dim uppercase">{item.label}</dt>
              <dd class="text-[0.84rem] font-semibold">{formatNumber(item.value)}</dd>
            </div>
          {/each}
        </dl>
      {/if}

      {#if verificationEntries.length}
        <dl class="flex flex-wrap gap-1">
          {#each verificationEntries as item (item.key)}
            <div class="rounded-md border px-1.5 py-0.5 text-[0.68rem] {boolTone(item.value)}">
              <dt class="inline">{item.label}</dt>
              <dd class="ml-1 inline font-semibold">{boolLabel(item.value)}</dd>
            </div>
          {/each}
        </dl>
      {/if}
    </div>

    {#if s.verification?.notes?.length}
      <ul class="mt-2 space-y-1 border-t border-edge pt-2 text-[0.76rem] text-dim">
        {#each s.verification.notes as note (note)}
          <li>{note}</li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

{#if s.tags?.length}
  <section class="mb-7">
    <h2 class="mb-3 border-b border-edge pb-1.5 text-[1.1rem] font-semibold">{m.spec_tags()}</h2>
    <div class="flex flex-wrap gap-2">
      {#each s.tags as t (t)}
        <a
          href={href('/software/')}
          class="rounded-full border border-edge bg-elev px-2.5 py-1 font-mono text-[0.8rem] text-dim hover:border-accent hover:text-ink"
        >#{t}</a>
      {/each}
    </div>
  </section>
{/if}

<RecordFooter source={s.source} jsonPath="{base}/software/{s.id}.json" />
