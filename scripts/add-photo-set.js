#!/usr/bin/env node
/**
 * Batch-add a photo set.
 *
 * Decap CMS's built-in media picker only ever uploads/inserts one file at a
 * time (verified against its source — handlePersist() takes files[0] and
 * discards the rest, even on a multi-file drop). For a whole shoot, it's
 * much faster to drop the folder straight into the repo and generate the
 * frontmatter here instead of clicking "+ Add Image" N times in the browser.
 *
 * Copies every image in <source-folder> into the shared src/assets/photo-sets/
 * folder (same flat folder the Decap admin's Photo Sets fields use — see
 * public/admin/config.yml) and writes src/content/photoSets/<slug>.mdx with
 * matching frontmatter. Files are renamed <slug>--<original-name> on copy so
 * two shoots can never collide in the shared folder.
 *
 * Usage:
 *   node scripts/add-photo-set.js <source-folder> --title "My Title" [options]
 *
 * Options:
 *   --slug <slug>        URL segment + filename (/photos/<slug>). Defaults to a
 *                         slugified --title.
 *   --date <YYYY-MM-DD>  Defaults to today.
 *   --location <text>    Optional.
 *   --note <text>        Optional — short blurb shown on the set page.
 *   --cover <filename>   Filename (within the source folder) to use as the cover.
 *                         Defaults to the first photo in sort order.
 *   --order name|mtime   Gallery sort order. Defaults to "name" (natural sort).
 *   --include-cover      Also include the cover photo in the gallery grid
 *                         (by default the cover is only used as the hero image).
 *   --force              Overwrite an existing entry/asset folder for this slug.
 *
 * Example:
 *   node scripts/add-photo-set.js ~/Photos/rainier --title "Mount Rainier" \
 *     --location "Mount Rainier, WA" --note "Labor Day backpacking trip."
 */

import { readdirSync, statSync, mkdirSync, copyFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '..', '..');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (key === 'include-cover' || key === 'force') {
        args[key] = true;
      } else {
        args[key] = argv[++i];
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function fail(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// JSON strings are valid YAML scalars, so this gives us safe quoting/escaping
// for free without pulling in a YAML library.
const yamlString = (value) => JSON.stringify(value);

const args = parseArgs(process.argv.slice(2));
const sourceDir = args._[0];

if (!sourceDir) {
  fail(
    'Usage: node scripts/add-photo-set.js <source-folder> --title "My Title" [--slug ...] [--location ...] [--note ...] [--date YYYY-MM-DD] [--cover file.jpg] [--order name|mtime] [--include-cover] [--force]'
  );
}
if (!args.title) {
  fail('--title is required.');
}

const resolvedSource = path.resolve(sourceDir);
if (!existsSync(resolvedSource) || !statSync(resolvedSource).isDirectory()) {
  fail(`Source folder not found: ${resolvedSource}`);
}

const slug = args.slug ? slugify(args.slug) : slugify(args.title);
if (!slug) {
  fail('Could not derive a valid slug from --title — pass --slug explicitly.');
}

const date = args.date || new Date().toISOString().slice(0, 10);

const order = args.order === 'mtime' ? 'mtime' : 'name';
let files = readdirSync(resolvedSource).filter((f) => IMAGE_EXTENSIONS.has(path.extname(f).toLowerCase()));

if (files.length === 0) {
  fail(`No image files (${[...IMAGE_EXTENSIONS].join(', ')}) found in ${resolvedSource}`);
}

if (order === 'mtime') {
  files = files
    .map((f) => ({ f, mtime: statSync(path.join(resolvedSource, f)).mtimeMs }))
    .sort((a, b) => a.mtime - b.mtime)
    .map(({ f }) => f);
} else {
  files.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
}

const coverFile = args.cover || files[0];
if (!files.includes(coverFile)) {
  fail(`--cover "${coverFile}" was not found among the images in ${resolvedSource}`);
}

const galleryFiles = args['include-cover'] ? files : files.filter((f) => f !== coverFile);

const assetDir = path.join(ROOT, 'src', 'assets', 'photo-sets');
const contentFile = path.join(ROOT, 'src', 'content', 'photoSets', `${slug}.mdx`);
const destName = (file) => `${slug}--${file}`;

if (!args.force) {
  if (existsSync(contentFile)) fail(`${path.relative(ROOT, contentFile)} already exists — pass --force to overwrite.`);
  const collision = files.find((f) => existsSync(path.join(assetDir, destName(f))));
  if (collision) {
    fail(`${path.relative(ROOT, path.join(assetDir, destName(collision)))} already exists — pass --force to overwrite.`);
  }
}

mkdirSync(assetDir, { recursive: true });
for (const file of files) {
  copyFileSync(path.join(resolvedSource, file), path.join(assetDir, destName(file)));
}

const relImagePath = (file) => `../../assets/photo-sets/${destName(file)}`;

const lines = [
  '---',
  `title: ${yamlString(args.title)}`,
  `date: ${yamlString(date)}`,
  args.location ? `location: ${yamlString(args.location)}` : null,
  args.note ? `note: ${yamlString(args.note)}` : null,
  `cover: ${yamlString(relImagePath(coverFile))}`,
  'images:',
  ...galleryFiles.map((file) => `  - ${yamlString(relImagePath(file))}`),
  '---',
  ''
].filter((line) => line !== null);

mkdirSync(path.dirname(contentFile), { recursive: true });
writeFileSync(contentFile, lines.join('\n'));

console.log(`\nAdded photo set "${args.title}" (${slug})`);
console.log(`  ${files.length} photo${files.length === 1 ? '' : 's'} copied to ${path.relative(ROOT, assetDir)} (prefixed "${slug}--")`);
console.log(`  Cover:   ${destName(coverFile)}`);
console.log(
  `  Gallery: ${galleryFiles.length} photo${galleryFiles.length === 1 ? '' : 's'}${
    args['include-cover'] ? ' (cover included)' : ''
  }`
);
console.log(`  Entry:   ${path.relative(ROOT, contentFile)}`);
console.log(
  `\nPreview with \`npm run dev\`, then publish:\n  git add ${path.relative(ROOT, assetDir)} ${path.relative(
    ROOT,
    contentFile
  )}\n  git commit -m "Add photo set: ${args.title}"\n  git push\n`
);
