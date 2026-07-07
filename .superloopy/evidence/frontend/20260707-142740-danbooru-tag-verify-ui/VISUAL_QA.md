# Danbooru Tag Verify UI Visual QA

Run: 20260707-142740-danbooru-tag-verify-ui
Route: http://127.0.0.1:4174/prompts
Backend: local mock sidecar on 127.0.0.1:8002 with OK/LOW/GHOST/ERROR/SKIPPED fixture statuses.

## Assertions

| Viewport | Dialog | Summary | Suggestions | Replacement | Footer | Toast clear | H-overflow | Screenshot |
| --- | --- | --- | --- | --- | --- | --- | ---: | --- |
| desktop-1280 (1280x900) | pass | pass | pass | pass | pass | pass | 0 | desktop-1280.png |
| tablet-768 (768x900) | pass | pass | pass | pass | pass | pass | 0 | tablet-768.png |
| mobile-390 (390x844) | pass | pass | pass | pass | pass | pass | 0 | mobile-390.png |

## Notes

- Screenshots exercise the real React route and the actual DanbooruTagVerifyDialog component.
- Live Danbooru HTTP was intentionally not called during visual QA; API behavior is covered by service/build checks and this pass isolates layout behavior.
- Mobile overlap found in the first pass was fixed by making the dialog body scroll independently and reducing mobile panel heights.
- Suggestion clicks update the preview inline; final editor/generator integrations keep the success toast on final apply only.
- No page errors were recorded in the tested viewports.

## Raw Checks

```json
[
  {
    "name": "desktop-1280",
    "width": 1280,
    "height": 900,
    "screenshotPath": "C:\\Users\\User\\OneDrive\\图片\\NAIS\\NAIS2-main\\.superloopy\\evidence\\frontend\\20260707-142740-danbooru-tag-verify-ui\\desktop-1280.png",
    "screenshotBytes": 77746,
    "checks": {
      "dialogVisible": true,
      "summaryVisible": true,
      "suggestionsVisible": true,
      "previewReplaced": true,
      "toastVisible": false,
      "horizontalOverflow": 0,
      "viewport": {
        "width": 1280,
        "height": 900
      },
      "dialogBounds": {
        "left": 256,
        "top": 152,
        "right": 1024,
        "bottom": 748,
        "width": 768,
        "height": 596
      },
      "footerWithinViewport": true
    },
    "consoleErrors": [],
    "pageErrors": []
  },
  {
    "name": "tablet-768",
    "width": 768,
    "height": 900,
    "screenshotPath": "C:\\Users\\User\\OneDrive\\图片\\NAIS\\NAIS2-main\\.superloopy\\evidence\\frontend\\20260707-142740-danbooru-tag-verify-ui\\tablet-768.png",
    "screenshotBytes": 61745,
    "checks": {
      "dialogVisible": true,
      "summaryVisible": true,
      "suggestionsVisible": true,
      "previewReplaced": true,
      "toastVisible": false,
      "horizontalOverflow": 0,
      "viewport": {
        "width": 768,
        "height": 900
      },
      "dialogBounds": {
        "left": 16,
        "top": 152,
        "right": 752,
        "bottom": 748,
        "width": 736,
        "height": 596
      },
      "footerWithinViewport": true
    },
    "consoleErrors": [],
    "pageErrors": []
  },
  {
    "name": "mobile-390",
    "width": 390,
    "height": 844,
    "screenshotPath": "C:\\Users\\User\\OneDrive\\图片\\NAIS\\NAIS2-main\\.superloopy\\evidence\\frontend\\20260707-142740-danbooru-tag-verify-ui\\mobile-390.png",
    "screenshotBytes": 44568,
    "checks": {
      "dialogVisible": true,
      "summaryVisible": true,
      "suggestionsVisible": true,
      "previewReplaced": true,
      "toastVisible": false,
      "horizontalOverflow": 0,
      "viewport": {
        "width": 390,
        "height": 844
      },
      "dialogBounds": {
        "left": 16,
        "top": 16,
        "right": 374,
        "bottom": 828,
        "width": 358,
        "height": 812
      },
      "footerWithinViewport": true
    },
    "consoleErrors": [],
    "pageErrors": []
  }
]
```