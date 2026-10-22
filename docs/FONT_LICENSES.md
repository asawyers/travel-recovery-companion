# Bundled fonts

The interface serves these unmodified Google Fonts WOFF2 builds locally from `public/fonts`. No browser request to Google Fonts is required. Both are variable upright builds covering weights 400–700. DM Sans is the body face; Sora is used for headings and prices.

| Family | Local font | Official download | Copyright and license |
| --- | --- | --- | --- |
| DM Sans | `public/fonts/dm-sans-latin.woff2` | [Google Fonts WOFF2](https://fonts.gstatic.com/s/dmsans/v17/rP2Yp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff2) | Copyright 2014 The DM Sans Project Authors. [Bundled SIL OFL 1.1](../public/fonts/DM-Sans-OFL.txt); [official license source](https://github.com/google/fonts/blob/main/ofl/dmsans/OFL.txt). |
| Sora | `public/fonts/sora-latin.woff2` | [Google Fonts WOFF2](https://fonts.gstatic.com/s/sora/v17/xMQ9uFFYT72X5wkB_18qmnndmSdSnh2BAfO5mnuyOo1lfiQwV6-x.woff2) | Copyright 2019 The Sora Project Authors. [Bundled SIL OFL 1.1](../public/fonts/Sora-OFL.txt); [official license source](https://github.com/google/fonts/blob/main/ofl/sora/OFL.txt). |

Downloaded October 22, 2026 from the Latin sections of the [official Google Fonts CSS response](https://fonts.googleapis.com/css2?family=DM+Sans:wght@400..700&family=Sora:wght@400..700&display=swap), using a current Chrome user agent to request WOFF2. Files retain the upstream font family names. Their complete copyright notices and licenses are distributed beside the fonts.

`src/index.css` declares the corresponding Latin Unicode ranges and `font-display: swap`. The system sans-serif fallback handles characters outside those ranges, including other scripts in city and traveler names.
