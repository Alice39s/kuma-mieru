import { check, object, parse, picklist, pipe, string, url } from 'valibot';
import type { InferOutput } from 'valibot';

export const backgroundPhotoSchema = object({
  url: pipe(string(), url()),
  source: picklist(['unsplash', 'pexels']),
  photographer: string(),
  photographerUrl: pipe(string(), url()),
  photoUrl: pipe(string(), url()),
});

export type BackgroundPhoto = InferOutput<typeof backgroundPhotoSchema>;

const httpsUrlOn = (hostname: string) =>
  pipe(
    string(),
    url(),
    check(value => {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && parsed.hostname === hostname && !parsed.username;
    }, `Expected an HTTPS URL on ${hostname}`)
  );

const unsplashPhotoSchema = object({
  urls: object({ raw: httpsUrlOn('images.unsplash.com') }),
  links: object({
    html: httpsUrlOn('unsplash.com'),
    download_location: httpsUrlOn('api.unsplash.com'),
  }),
  user: object({ name: string(), links: object({ html: httpsUrlOn('unsplash.com') }) }),
});

export const pexelsPhotoSchema = object({
  url: httpsUrlOn('www.pexels.com'),
  photographer: string(),
  photographer_url: httpsUrlOn('www.pexels.com'),
  src: object({ large2x: httpsUrlOn('images.pexels.com') }),
});

const referralUrl = (value: string) => {
  const result = new URL(value);
  result.searchParams.set('utm_source', 'kuma_mieru');
  result.searchParams.set('utm_medium', 'referral');
  return result.href;
};

export function parseUnsplashPhoto(input: unknown) {
  const photo = parse(unsplashPhotoSchema, input);
  const image = new URL(photo.urls.raw);
  image.searchParams.set('w', '1920');
  image.searchParams.set('q', '85');
  image.searchParams.set('fit', 'max');
  image.searchParams.set('auto', 'format');
  return {
    photo: {
      url: image.href,
      source: 'unsplash',
      photographer: photo.user.name,
      photographerUrl: referralUrl(photo.user.links.html),
      photoUrl: referralUrl(photo.links.html),
    } satisfies BackgroundPhoto,
    downloadUrl: photo.links.download_location,
  };
}

export function parsePexelsPhoto(input: InferOutput<typeof pexelsPhotoSchema>): BackgroundPhoto {
  return {
    url: input.src.large2x,
    source: 'pexels',
    photographer: input.photographer,
    photographerUrl: input.photographer_url,
    photoUrl: input.url,
  };
}
