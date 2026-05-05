// Convert resolution labels (720p, 1080p, 4k) to the WxH format the
// AI SDK's experimental_generateVideo and most provider gateways
// require. Labels alone are convenient at the CLI but providers
// reject them with messages like "Expected WIDTHxHEIGHT".

const LABEL_TO_DIMENSIONS_16_9: Record<string, { width: number; height: number }> = {
  '480p': { width: 854, height: 480 },
  '720p': { width: 1280, height: 720 },
  '768p': { width: 1366, height: 768 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 },
};

/**
 * Normalize a resolution input to a `WIDTHxHEIGHT` string. Accepts:
 *   - Already-formatted `1280x720` (passes through)
 *   - Labels like `720p`, `1080p`, `4k` (converted assuming the given
 *     aspect ratio; defaults to 16:9 if no aspect provided)
 *
 * Returns undefined when the input is undefined, so callers can pass
 * `normalizeResolution(input.resolution, input.aspectRatio)` directly
 * to the SDK without an extra null check.
 */
export function normalizeResolution(
  resolution: string | undefined,
  aspectRatio?: string,
): `${number}x${number}` | undefined {
  if (!resolution) return undefined;

  // Already in WxH form -- pass through with the SDK template-literal cast.
  const wxh = resolution.match(/^(\d+)x(\d+)$/);
  if (wxh) {
    return resolution as `${number}x${number}`;
  }

  const label = resolution.toLowerCase();
  const dims = LABEL_TO_DIMENSIONS_16_9[label];
  if (!dims) {
    // Unknown label -- pass through and let the provider reject. Better
    // to surface the provider's error than to silently substitute.
    return resolution as `${number}x${number}`;
  }

  // Apply aspect ratio. Labels are nominally horizontal (16:9). If the
  // user requested a different aspect, recompute dimensions so the
  // longer edge matches the label's nominal pixel count.
  const aspect = parseAspect(aspectRatio);
  if (!aspect || aspect.w === aspect.h) {
    if (aspect && aspect.w === aspect.h) {
      // Square: use the smaller of the two horizontal dims.
      const side = Math.min(dims.width, dims.height);
      return `${side}x${side}` as `${number}x${number}`;
    }
    return `${dims.width}x${dims.height}`;
  }

  // For non-16:9 aspects, scale relative to the longest edge of the
  // horizontal label. e.g. 720p portrait at 9:16 -> 720x1280.
  const long = Math.max(dims.width, dims.height);
  if (aspect.w > aspect.h) {
    const width = long;
    const height = Math.round((long * aspect.h) / aspect.w);
    return `${width}x${height}` as `${number}x${number}`;
  }
  const height = long;
  const width = Math.round((long * aspect.w) / aspect.h);
  return `${width}x${height}` as `${number}x${number}`;
}

function parseAspect(aspect: string | undefined): { w: number; h: number } | null {
  if (!aspect) return null;
  const match = aspect.match(/^(\d+):(\d+)$/);
  if (!match) return null;
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return { w, h };
}
