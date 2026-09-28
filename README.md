# pi-deepseek-peak

[![npm version](https://img.shields.io/npm/v/pi-deepseek-peak?style=flat-square&logo=npm&logoColor=white)](https://www.npmjs.com/package/pi-deepseek-peak)
[![license MIT](https://img.shields.io/npm/l/pi-deepseek-peak?style=flat-square)](LICENSE)
[![pi extension](https://img.shields.io/badge/pi-extension-7B61FF?style=flat-square)](https://github.com/earendil-works/pi)
[![node](https://img.shields.io/badge/node-%E2%89%A5%2022.18-339933?style=flat-square&logo=node.js&logoColor=white)](#development)

Pi extension that shows DeepSeek peak hours in the TUI status bar.

![Screenshot](screenshot.png)

## Features

- Status bar indicator: "DS Peak" or "DS Normal", with a countdown to the next price change ("DS Peak for 1h30m") — shown only when the selected model's provider is DeepSeek; hidden for other providers; toggle via `/dsp-countdown`
- Auto-refresh at 30s / 1m / 5m (default 5m) via `/dsp-refresh`
- Uses theme colors (warning for peak, success for normal)
- Thats it

## Install

```sh
pi install npm:pi-deepseek-peak
```

Restart pi or run `/reload` to activate.

## Usage

Once installed, the status bar shows the current DeepSeek peak period only while the active model's provider is `deepseek`. Switching to another provider hides the indicator; switching back restores it. Peak hours are Mon-Fri 01:00-04:00 and 06:00-10:00 UTC; weekends (Beijing time) are off-peak all day.

### Commands

```sh
/dsp-countdown    # show or hide the countdown next to the dot (menu)
/dsp-refresh      # pick the status refresh interval: 30s, 1m or 5m (menu)
```

Settings are saved to `$PI_CODING_AGENT_DIR/deepseek-peak.json` (default `~/.pi/agent/deepseek-peak.json`) as `{ "countdown": true, "refresh": 300 }` and persist across restarts. Changing `PI_CODING_AGENT_DIR` starts from defaults at the new location.

## Development

```sh
npm test    # self-check for the peak/countdown logic
```

Requires Node ≥ 22.18 (built-in TypeScript type stripping; no build step).

To test a local branch, `pi install /absolute/path/to/pi-deepseek-peak` (it replaces the npm version), then `/reload`; `pi install npm:pi-deepseek-peak` to switch back.

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history.

## License

MIT
