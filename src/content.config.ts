import { defineCollection, z } from 'astro:content';

const linkSchema = z
  .string()
  .refine((value) => value.startsWith('/') || /^https?:\/\//i.test(value), {
    message: 'Expected an absolute URL (https://...) or a root-relative path (/...)'
  });

const projects = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    pitch: z.string(),
    tags: z.array(z.string()),
    status: z.enum(['planning', 'active', 'paused', 'archived']),
    screenshots: z.array(z.string()).default([]),
    repoUrl: z.string().url().optional(),
    demoUrl: linkSchema.optional(),
    downloadUrl: linkSchema.optional(),
    downloadLabel: z.string().optional(),
    secondaryDownloadUrl: linkSchema.optional(),
    secondaryDownloadLabel: z.string().optional(),
    platform: z.array(z.enum(['web', 'windows', 'mac', 'linux', 'android', 'ios'])),
    updatedAt: z.coerce.date(),
    usesMicAudio: z.boolean().default(false),
    featured: z.boolean().default(false)
  })
});

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    updatedAt: z.coerce.date(),
    tags: z.array(z.string()).default([])
  })
});

const tools = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    summary: z.string(),
    updatedAt: z.coerce.date(),
    tags: z.array(z.string()).default([])
  })
});

const site = defineCollection({
  type: 'data',
  schema: z.object({
    heroHeading: z.string(),
    heroSubtext: z.string(),
    siteTagline: z.string(),
    defaultOgDescription: z.string(),
    defaultTitleSuffix: z.string().default('SqualieC | Projects')
  })
});

// Photo sets live under src/content/photoSets/<slug>.mdx with their images
// stored under src/assets/photo-sets/<slug>/. Using the image() schema
// helper means every cover + gallery photo is imported through Vite and run
// through Astro's build-time image pipeline (resize/format/optimize) instead
// of being served as-is from /public.
const photoSets = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      date: z.coerce.date(),
      location: z.string().optional(),
      note: z.string().optional(),
      cover: image(),
      // Decap's list widget stores each selected image as a bare array item
      // (not an object) when the list uses `field:` instead of `fields:` —
      // that's what lets the media library batch-add many photos at once
      // instead of one item at a time. Alt text is auto-generated from the
      // set title on the page rather than edited per photo.
      images: z.array(image()).default([])
    })
});

// Single editable About page. Body markdown holds the bio copy; frontmatter
// holds the small structured bits (tagline + optional portrait).
const about = defineCollection({
  type: 'content',
  schema: ({ image }) =>
    z.object({
      title: z.string().default('About'),
      tagline: z.string().optional(),
      photo: image().optional(),
      updatedAt: z.coerce.date().optional()
    })
});

export const collections = { projects, blog, tools, site, photoSets, about };
