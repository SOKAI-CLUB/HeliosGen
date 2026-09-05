# Kie.ai credit estimates

Verified on **2026-09-05** against the live [Kie.ai pricing table](https://kie.ai/pricing), the source of truth linked by [Kie.ai's getting started documentation](https://docs.kie.ai/).

`lib/creditEstimate.ts` holds a client-side pricing snapshot. The gallery composer and workflow image/video nodes use the same calculator. Displayed totals cover all requested API calls (image count, node batch count, or non-empty multi-prompts). Estimating does not submit a generation or require an API key. Prices are estimates, not billing guarantees; the link next to Generate includes the verification date and calculation in its accessible description and tooltip.

## Image credits per API call

| Model | Credits |
| --- | --- |
| Nano Banana / Nano Banana 2 Lite | 4 |
| Nano Banana 2 | 1K: 8; 2K: 12; 4K: 18 |
| Nano Banana Pro | 1K/2K: 18; 4K: 24 |
| Z-Image | 0.8 |
| Seedream 5 Lite | 5.5 |
| Seedream 5 Pro | 1K: 7; 2K: 14; 0.5 for each reference after the first |
| Grok Imagine | 4 per call (text-to-image returns two images) |
| GPT Image 2 | 1K: 6; 2K: 10; 4K: 16 |

[Nano Banana 2](https://docs.kie.ai/market/google/nanobanana2) and [Nano Banana Pro](https://kie.ai/nano-banana-pro) accept `resolution: 1K/2K/4K`. Their model configuration sends that field so pricing and requested resolution agree. Azure and Codex do not receive a Kie estimate.

## Video billing

The calculator uses the same duration bounds and default settings as the model configuration. Kling 3.0 accounts for resolution and sound; Turbo, Grok, HappyHorse and Motion Control use per-second rates. Veo uses fixed per-video prices including the chosen resolution; Quality 4K distinguishes text and image inputs. Gemini Omni uses its duration table (4/6/8/10 seconds), a 4K surcharge, and a fixed video-input price.

[Seedance 2.0/Fast](https://kie.ai/seedance-2-0), [Mini](https://kie.ai/seedance-2-0-mini), and [2.5](https://kie.ai/seedance-2-5) use the output duration without a reference video. With video input they apply a different rate to **input seconds + output seconds**. Selected trims replace the full reference duration. Missing metadata is read using a browser video element with `preload=metadata`; failed metadata never becomes a zero-second reference.

Motion Control estimates whole reference seconds, rounded up. Seedance 2.5 Edit requests automatic output duration (`-1`), so its display gives a per-second rate with the billing formula. HappyHorse image-to-video inherits resolution from its input, so it shows a 720p–1080p cost range. Unpublished combinations (including Seedance Fast 1080p and Veo Quality reference mode) show an unavailable estimate.

## Maintenance and verification

Recheck the pricing page when adding models or changing model parameters. Keep the date, rates, billing rules and tests together. The current Seedance Fast and Mini rates are promotional until **2026-10-07 06:00 UTC**; the calculator stops quoting them after expiry until they are reverified. Do not infer an unpublished rate from another model or resolution.

Run `pnpm test:credits` with Node 22.6 or later. The tests cover fractional credits, batch/multi-prompt totals, reference surcharges, video input billing, trims, automatic duration, provider exclusions, unknown prices, and model-specific resolution/audio behavior.
