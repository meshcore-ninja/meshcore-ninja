// Validates every YAML record against its JSON Schema (schema/*.yaml)
// and checks referential integrity between firmwares, devices and vendors.
// Run with: npm run validate
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';
import Ajv from 'ajv/dist/2020.js';
import { validateRouteSlugs } from './route-slugs.js';
import { validateAllTranslationSources } from './catalog-i18n/build-overlays.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ajv = new Ajv({ allErrors: true });

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

function isPlainObject(value) {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function stripOverlayMeta(value) {
  if (!isPlainObject(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => !key.startsWith('$')));
}

function deepMerge(base, overlay) {
  const out = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    out[key] = isPlainObject(out[key]) && isPlainObject(value) ? deepMerge(out[key], value) : value;
  }
  return out;
}

function loadSchema(name) {
  return ajv.compile(load(readFileSync(join(root, 'schema', `${name}.yaml`), 'utf8')));
}

// Read `data/<kind>/<id>/<file>`, returning { id, dir, data } records.
function readCollection(kind, file) {
  const base = join(root, 'data', kind);
  if (!existsSync(base)) return [];
  const out = [];
  for (const d of readdirSync(base, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const path = join(base, d.name, file);
    if (!existsSync(path)) {
      err(`${kind}/${d.name}`, `missing ${file}`);
      continue;
    }
    if (!/^[a-z0-9-]+$/.test(d.name)) {
      err(`${kind}/${d.name}`, 'directory name (used as id) must be kebab-case [a-z0-9-]');
    }
    let data;
    try {
      data = load(readFileSync(path, 'utf8'));
    } catch (e) {
      err(`${kind}/${d.name}`, `YAML parse error: ${e.message}`);
      continue;
    }
    const overlayPath = join(base, d.name, 'data.json');
    if (existsSync(overlayPath)) {
      try {
        data = deepMerge(
          data ?? {},
          stripOverlayMeta(JSON.parse(readFileSync(overlayPath, 'utf8')))
        );
      } catch (e) {
        err(`${kind}/${d.name}/data.json`, `JSON parse error: ${e.message}`);
      }
    }
    out.push({ id: d.name, where: `${kind}/${d.name}`, data: data ?? {} });
  }
  return out;
}

function validateAll(records, validate) {
  for (const r of records) {
    if (!validate(r.data)) {
      for (const e of validate.errors) {
        err(r.where, `${e.instancePath || '/'} ${e.message}`);
      }
    }
  }
}

const deviceSchema = loadSchema('device');
const firmwareSchema = loadSchema('firmware');
const vendorSchema = loadSchema('vendor');
const networkSchema = loadSchema('network');
const softwareSchema = loadSchema('software');
const changelogSchema = loadSchema('changelog');
const compatibilitySchema = loadSchema('compatibility');
const globalsSchema = loadSchema('globals');
const redirectsSchema = loadSchema('redirects');

const vendors = readCollection('vendors', 'vendor.yaml');
const devices = readCollection('devices', 'device.yaml');
const firmwares = readCollection('firmwares', 'firmware.yaml');
const networks = readCollection('networks', 'network.yaml');
const software = readCollection('software', 'software.yaml');
const compatibility = [];

validateAll(vendors, vendorSchema);
validateAll(devices, deviceSchema);
validateAll(firmwares, firmwareSchema);
validateAll(networks, networkSchema);
validateAll(software, softwareSchema);

const compatibilityBase = join(root, 'data', 'compatibility');
if (existsSync(compatibilityBase)) {
  for (const fwDir of readdirSync(compatibilityBase, { withFileTypes: true })) {
    if (!fwDir.isDirectory()) continue;
    for (const versionDir of readdirSync(join(compatibilityBase, fwDir.name), {
      withFileTypes: true
    })) {
      if (!versionDir.isDirectory()) continue;
      const versionPath = join(compatibilityBase, fwDir.name, versionDir.name);
      for (const file of readdirSync(versionPath, { withFileTypes: true })) {
        if (!file.isFile()) continue;
        if (!file.name.endsWith('.yaml')) {
          err(`compatibility/${fwDir.name}/${versionDir.name}/${file.name}`, 'must be a .yaml file');
          continue;
        }
        const deviceId = file.name.replace(/\.yaml$/, '');
        const where = `compatibility/${fwDir.name}/${versionDir.name}/${file.name}`;
        let data;
        try {
          data = load(readFileSync(join(versionPath, file.name), 'utf8'));
        } catch (e) {
          err(where, `YAML parse error: ${e.message}`);
          continue;
        }
        compatibility.push({
          firmwareId: fwDir.name,
          firmwareVersion: versionDir.name,
          deviceId,
          where,
          data: data ?? {}
        });
        if (!compatibilitySchema(data ?? {})) {
          for (const e of compatibilitySchema.errors) {
            err(where, `${e.instancePath || '/'} ${e.message}`);
          }
        }
      }
    }
  }
}

// Optional shared parts catalog (data/globals.yaml).
let globalsData = null;
const globalsPath = join(root, 'data', 'globals.yaml');
if (existsSync(globalsPath)) {
  try {
    globalsData = load(readFileSync(globalsPath, 'utf8'));
  } catch (e) {
    err('globals', `YAML parse error: ${e.message}`);
  }
  if (globalsData != null && !globalsSchema(globalsData)) {
    for (const e of globalsSchema.errors) {
      err('globals', `${e.instancePath || '/'} ${e.message}`);
    }
  }
}
const refIds = new Set(Object.keys(globalsData?.refs ?? {}));

// Optional changelog.yaml alongside each firmware or software record.
for (const [kind, records] of [
  ['firmwares', firmwares],
  ['software', software]
]) {
  for (const f of records) {
    const path = join(root, 'data', kind, f.id, 'changelog.yaml');
    if (!existsSync(path)) continue;
    let cl;
    try {
      cl = load(readFileSync(path, 'utf8'));
    } catch (e) {
      err(`${kind}/${f.id}/changelog`, `YAML parse error: ${e.message}`);
      continue;
    }
    if (!changelogSchema(cl)) {
      for (const e of changelogSchema.errors) {
        err(`${kind}/${f.id}/changelog`, `${e.instancePath || '/'} ${e.message}`);
      }
    }
    const derivesVersion = kind === 'firmwares' || f.data.changelog;
    if (derivesVersion && f.data.latest_version) {
      err(f.where, 'latest_version must not be set with configured changelog automation — it is computed at build time');
    }
    if (derivesVersion && f.data.released) {
      err(f.where, 'released must not be set with configured changelog automation — it is computed at build time');
    }
  }
}

// External-reference maps use keys registered in globals.refs. Software `refs`
// are instead internal catalog relationships defined by schema/software.yaml.
for (const r of [...vendors, ...devices, ...firmwares, ...networks]) {
  for (const key of Object.keys(r.data.refs ?? {})) {
    if (!refIds.has(key)) {
      err(r.where, `refs key "${key}" is not defined in data/globals.yaml refs`);
    }
  }
}

const internalCollections = {
  devices: new Set(devices.map((r) => r.id)),
  firmwares: new Set(firmwares.map((r) => r.id)),
  networks: new Set(networks.map((r) => r.id)),
  software: new Set(software.map((r) => r.id))
};
for (const r of software) {
  for (const [collection, ids] of Object.entries(r.data.refs ?? {})) {
    for (const id of ids) {
      if (!internalCollections[collection]?.has(id)) {
        err(r.where, `refs.${collection} id "${id}" has no data/${collection}/ entry`);
      }
    }
  }
}

// A network's radio.frequency / radios[].frequency must be a band key registered
// in globals.frequency (it's how compatible devices are matched).
const frequencyKeys = new Set(Object.keys(globalsData?.frequency ?? {}));
const networkIds = new Set(networks.map((n) => n.id));
for (const n of networks) {
  for (const parentId of n.data.part_of ?? []) {
    if (parentId === n.id) {
      err(n.where, 'part_of must not include this network itself');
    } else if (!networkIds.has(parentId)) {
      err(n.where, `part_of "${parentId}" has no data/networks/ entry`);
    }
  }
  const radios = Array.isArray(n.data.radios) && n.data.radios.length ? n.data.radios : [n.data.radio].filter(Boolean);
  for (const [index, radio] of radios.entries()) {
    const band = radio?.frequency;
    if (band != null && !frequencyKeys.has(String(band))) {
      const path = Array.isArray(n.data.radios) && n.data.radios.length ? `radios[${index}].frequency` : 'radio.frequency';
      err(n.where, `${path} "${band}" is not a band key in data/globals.yaml frequency`);
    }
  }
  for (const analyzer of n.data.analyzers ?? []) {
    try {
      const url = new URL(analyzer.url);
      if (url.pathname !== '/' || url.search || url.hash) {
        err(n.where, `analyzer "${analyzer.name}" url must be a bare CoreScope domain without path/query/hash`);
      }
    } catch {
      // Schema reports malformed URLs.
    }
  }
  if (n.data.area) {
    const areaPath = join(root, 'data', 'networks', n.id, n.data.area);
    if (!existsSync(areaPath)) {
      err(n.where, `area "${n.data.area}" file not found`);
    } else {
      try {
        const area = JSON.parse(readFileSync(areaPath, 'utf8'));
        if (!['Feature', 'FeatureCollection', 'Polygon', 'MultiPolygon'].includes(area?.type)) {
          err(n.where, `area "${n.data.area}" must be GeoJSON Feature, FeatureCollection, Polygon, or MultiPolygon`);
        }
      } catch (e) {
        err(n.where, `area "${n.data.area}" JSON parse error: ${e.message}`);
      }
    }
  }
}

// Referential integrity.
const vendorIds = new Set(vendors.map((v) => v.id));
// A device radio's bands must all be band keys registered in globals.frequency
// — they are matched verbatim against a network's band. A variant SKU's bands
// must be from the catalog too, and a subset of what the radios support.
for (const d of devices) {
  const radioBands = new Set();
  for (const [index, radio] of (d.data.hardware?.radios ?? []).entries()) {
    for (const band of radio?.bands ?? []) {
      radioBands.add(String(band));
      if (!frequencyKeys.has(String(band))) {
        err(d.where, `hardware.radios[${index}].bands "${band}" is not a band key in data/globals.yaml frequency`);
      }
    }
  }
  for (const [index, variant] of (d.data.variants ?? []).entries()) {
    for (const band of variant?.bands ?? []) {
      if (!frequencyKeys.has(String(band))) {
        err(d.where, `variants[${index}].bands "${band}" is not a band key in data/globals.yaml frequency`);
      } else if (!radioBands.has(String(band))) {
        err(d.where, `variants[${index}] ("${variant.name}") band "${band}" is not in any radio's bands`);
      }
    }
  }
}

const deviceIds = new Set(devices.map((d) => d.id));
const firmwareIds = new Set(firmwares.map((f) => f.id));
const firmwareDeviceIds = new Map(
  firmwares.map((f) => [f.id, new Set((f.data.devices ?? []).map((d) => d.id))])
);

for (const d of devices) {
  if (d.data.vendorId && !vendorIds.has(d.data.vendorId)) {
    err(d.where, `vendorId "${d.data.vendorId}" has no data/vendors/ entry`);
  }
  if (d.data.variantOf && !deviceIds.has(d.data.variantOf)) {
    err(d.where, `variantOf "${d.data.variantOf}" has no data/devices/ entry`);
  }
  if (d.data.replaces && !deviceIds.has(d.data.replaces)) {
    err(d.where, `replaces "${d.data.replaces}" has no data/devices/ entry`);
  }
  if (d.data.image) {
    const imagePath = join(root, 'data', 'devices', d.id, d.data.image);
    if (!existsSync(imagePath)) {
      err(d.where, `image "${d.data.image}" file not found`);
    }
  }
  if (d.data.datasheet) {
    const datasheetPath = join(root, 'data', 'devices', d.id, d.data.datasheet);
    if (!existsSync(datasheetPath)) {
      err(d.where, `datasheet "${d.data.datasheet}" file not found`);
    }
  }
  const seenPrintUrls = new Set();
  for (const [index, print] of (d.data.prints ?? []).entries()) {
    const url = print?.url;
    if (!url) continue;
    if (seenPrintUrls.has(url)) {
      err(d.where, `prints[${index}].url duplicates another print on this device: ${url}`);
    }
    seenPrintUrls.add(url);
  }
}
for (const s of software) {
  if (s.data.image) {
    const imagePath = join(root, 'data', 'software', s.id, s.data.image);
    if (!existsSync(imagePath)) {
      err(s.where, `image "${s.data.image}" file not found`);
    }
  }
  for (const [index, shot] of (s.data.screenshots ?? []).entries()) {
    const file = shot?.file;
    if (file && !existsSync(join(root, 'data', 'software', s.id, file))) {
      err(s.where, `screenshots[${index}].file "${file}" file not found`);
    }
  }
}
for (const f of firmwares) {
  for (const ref of f.data.devices ?? []) {
    if (ref.id && !deviceIds.has(ref.id)) {
      err(f.where, `device "${ref.id}" has no data/devices/ entry`);
    }
  }
}
for (const c of compatibility) {
  if (!firmwareIds.has(c.firmwareId)) {
    err(c.where, `firmware "${c.firmwareId}" has no data/firmwares/ entry`);
  }
  if (!deviceIds.has(c.deviceId)) {
    err(c.where, `device "${c.deviceId}" has no data/devices/ entry`);
  }
  if (firmwareIds.has(c.firmwareId) && !firmwareDeviceIds.get(c.firmwareId)?.has(c.deviceId)) {
    err(c.where, `device "${c.deviceId}" is not listed in firmware "${c.firmwareId}" devices`);
  }
}

// data/redirects.yaml — old-slug → current-slug for renamed records. Each old
// slug is prerendered as a 301 to the record's current page, so the target must
// be a live record and the old slug must not shadow one.
const redirectsPath = join(root, 'data', 'redirects.yaml');
if (existsSync(redirectsPath)) {
  let redirectsData;
  try {
    redirectsData = load(readFileSync(redirectsPath, 'utf8'));
  } catch (e) {
    err('redirects', `YAML parse error: ${e.message}`);
  }
  if (redirectsData != null && !redirectsSchema(redirectsData)) {
    for (const e of redirectsSchema.errors) {
      err('redirects', `${e.instancePath || '/'} ${e.message}`);
    }
  }
  const idSets = {
    firmwares: firmwareIds,
    devices: deviceIds,
    vendors: vendorIds,
    networks: networkIds,
    software: new Set(software.map((s) => s.id))
  };
  for (const [collection, map] of Object.entries(redirectsData ?? {})) {
    const ids = idSets[collection];
    if (!ids) {
      err('redirects', `unknown collection "${collection}"`);
      continue;
    }
    if (!isPlainObject(map)) continue;
    for (const [from, to] of Object.entries(map)) {
      if (from === to) {
        err('redirects', `${collection}: "${from}" redirects to itself`);
      }
      if (ids.has(from)) {
        err('redirects', `${collection}: old slug "${from}" collides with an existing data/${collection}/ record — remove the redirect`);
      }
      if (!ids.has(to)) {
        err('redirects', `${collection}: target "${to}" has no data/${collection}/ entry`);
      }
    }
  }
}

validateRouteSlugs(err);
validateAllTranslationSources(root, err);

if (errors.length) {
  console.error(`✗ ${errors.length} validation error(s):\n`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `✓ valid — ${firmwares.length} firmware(s), ${devices.length} device(s), ${vendors.length} vendor(s), ${networks.length} network(s), ${software.length} software, ${compatibility.length} compatibility report(s).`
);
