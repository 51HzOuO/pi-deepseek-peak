// Self-check for the peak/countdown logic. Zero deps: run with
//   node scripts/selfcheck.ts   (Node >= 22.18; type stripping built in)
import assert from "node:assert/strict";
import { homedir } from "node:os";
import { join } from "node:path";
import { isOffPeak, nextStatusChange, formatCountdown, statusText, configPath, isDeepSeekModel, HOLIDAY_YEARS } from "../extensions/deepseek-peak.ts";

const H = 3600e3;
// Fixed clock: 2026-08-21 = Friday, 08-22 = Saturday, 08-23 = Sunday, 08-24 = Monday (UTC).
const fri = Date.UTC(2026, 7, 21);
const sat = Date.UTC(2026, 7, 22);
const sun = Date.UTC(2026, 7, 23);
const mon = Date.UTC(2026, 7, 24);

// --- Active model provider ---
assert.equal(isDeepSeekModel({ provider: "deepseek", id: "deepseek-flash" }), true, "DeepSeek provider -> active");
assert.equal(isDeepSeekModel({ provider: "deepseek", id: "custom-model" }), true, "custom DeepSeek model id -> active");
assert.equal(isDeepSeekModel({ provider: "anthropic", id: "claude" }), false, "other provider -> inactive");
assert.equal(isDeepSeekModel({}), false, "missing provider -> inactive");
assert.equal(isDeepSeekModel(undefined), false, "missing model -> inactive");

// --- Weekends (Sat/Sun Beijing time) are off-peak all day, even inside UTC peak windows ---
assert.equal(isOffPeak(new Date(sat + 2 * H)), true, "Sat 02:00 UTC (Beijing 10:00) -> off-peak");
assert.equal(isOffPeak(new Date(sat + 7 * H)), true, "Sat 07:00 UTC (Beijing 15:00) -> off-peak");
assert.equal(isOffPeak(new Date(sun + 3 * H)), true, "Sun 03:00 UTC (Beijing 11:00) -> off-peak");
assert.equal(isOffPeak(new Date(fri + 17 * H)), true, "Fri 17:00 UTC = Beijing Sat 01:00 -> off-peak");
assert.equal(isOffPeak(new Date(sun + 17 * H)), true, "Sun 17:00 UTC = Beijing Mon 01:00 -> off-peak (Paris Sun 19:00)");

// --- Weekdays: UTC windows 01:00-04:00 and 06:00-10:00, exclusive right edges ---
assert.equal(isOffPeak(new Date(mon + 2 * H)), false, "Mon 02:00 UTC -> peak");
assert.equal(isOffPeak(new Date(mon + 4 * H - 1)), false, "Mon 03:59:59.999 UTC -> peak");
assert.equal(isOffPeak(new Date(mon + 4 * H)), true, "Mon 04:00 UTC -> off-peak");
assert.equal(isOffPeak(new Date(mon + 7 * H)), false, "Mon 07:00 UTC -> peak");
assert.equal(isOffPeak(new Date(mon + 10 * H)), true, "Mon 10:00 UTC -> off-peak");
assert.equal(isOffPeak(new Date(mon + H - 1)), true, "Mon 00:59:59.999 UTC -> off-peak");
assert.equal(isOffPeak(new Date(mon + 20 * H)), true, "Mon 20:00 UTC -> off-peak");

// --- nextStatusChange: skips no-flip boundaries (Beijing weekend start/end) ---
assert.equal(
	nextStatusChange(new Date(fri + 15 * H))?.getTime(),
	mon + H,
	"Fri 15:00 UTC -> next flip is Mon 01:00 UTC (Beijing midnight Sat & Sun edges skip)",
);

// --- Countdown formatting ---
const f = (t: number) => formatCountdown(new Date(t));
assert.equal(f(mon + 2.5 * H), "1h30m", "Mon 02:30 UTC -> 04:00 = 1h30m");
assert.equal(f(mon + 3.25 * H), "45m", "Mon 03:15 UTC -> 04:00 = 45m");
assert.equal(f(mon + 2 * H + 55 * 60000), "1h05m", "Mon 02:55 UTC -> 04:00 = 1h05m");
assert.equal(f(mon + 3 * H), "1h", "Mon 03:00 UTC -> 04:00 = 1h");
assert.equal(f(sat + 22 * H), "27h", "Sat 22:00 UTC (Sun 00:00 Beijing) -> Mon 01:00 UTC = 27h (user example)");
assert.equal(f(fri + 16 * H), "2d9h", "Beijing Sat 00:00 -> Mon 01:00 UTC = 2d9h (long off-peak in days)");

// --- Chinese public holidays (official 2026 State Council dates) are off-peak all day,
// even on weekdays inside the UTC peak windows; 调休 make-up days are Sat/Sun anyway ---
assert.equal(isOffPeak(new Date(Date.UTC(2026, 0, 1, 2))), true, "Thu 2026-01-01 02:00 UTC (New Year) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 1, 16, 2))), true, "Mon 2026-02-16 02:00 UTC (Spring Festival) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 3, 6, 3))), true, "Mon 2026-04-06 03:00 UTC (Ching Ming) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 4, 1, 2))), true, "Fri 2026-05-01 02:00 UTC (Labour Day) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 5, 19, 2))), true, "Fri 2026-06-19 02:00 UTC (Dragon Boat) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 8, 25, 7))), true, "Fri 2026-09-25 07:00 UTC (Mid-Autumn) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 9, 1, 7))), true, "Thu 2026-10-01 07:00 UTC (National Day) -> off-peak");
// 2027 holidays are bundled too, so the table does not expire on 2027-01-01.
assert.equal(isOffPeak(new Date(Date.UTC(2027, 0, 1, 2))), true, "Fri 2027-01-01 02:00 UTC (New Year) -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2027, 1, 8, 2))), true, "Mon 2027-02-08 02:00 UTC (Spring Festival) -> off-peak");
// A plain weekday is still peak, and a make-up workday stays off-peak (it is a Sunday).
assert.equal(isOffPeak(new Date(Date.UTC(2026, 1, 9, 2))), false, "Mon 2026-02-09 02:00 UTC (no holiday) -> peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 0, 4, 2))), true, "Sun 2026-01-04 02:00 UTC (make-up workday) -> off-peak");
// Holiday edges are Beijing midnights: Spring Festival ends after Mon 2026-02-23.
assert.equal(isOffPeak(new Date(Date.UTC(2026, 1, 24, 0, 59))), true, "Tue 2026-02-24 00:59 UTC -> off-peak");
assert.equal(isOffPeak(new Date(Date.UTC(2026, 1, 24, 1))), false, "Tue 2026-02-24 01:00 UTC -> peak");
// The scan horizon spans the whole Spring Festival (the old 4-day window returned null).
assert.equal(
	nextStatusChange(new Date(Date.UTC(2026, 1, 15, 3)))?.getTime(),
	Date.UTC(2026, 1, 24, 1),
	"Sun 2026-02-15 03:00 UTC -> next flip Tue 2026-02-24 01:00 UTC",
);
assert.equal(f(Date.UTC(2026, 1, 15, 3)), "8d22h", "Spring Festival countdown uses days");

// --- Full status strings with mock theme ---
const theme = { fg: (color: string, text: string) => `[${color}]${text}[/${color}]` };
assert.equal(
	statusText(true, theme, new Date(mon + 2.5 * H)),
	"[warning]\u{1F534} DS Peak for 1h30m[/warning]",
	"red state: countdown in warning color",
);
assert.equal(
	statusText(true, theme, new Date(sat + 22 * H)),
	"[success]\u{1F7E2} DS Normal for 27h[/success]",
	"green weekend: countdown in success color",
);
assert.equal(
	statusText(false, theme, new Date(mon + 2.5 * H)),
	"[warning]\u{1F534} DS Peak[/warning]",
	"countdown off: no suffix",
);

// --- Config path: $PI_CODING_AGENT_DIR when set (leading ~ expanded, like pi), else ~/.pi/agent ---
const savedAgentDir = process.env.PI_CODING_AGENT_DIR;
try {
	delete process.env.PI_CODING_AGENT_DIR;
	assert.equal(configPath(), join(homedir(), ".pi", "agent", "deepseek-peak.json"), "unset env -> default ~/.pi/agent");
	process.env.PI_CODING_AGENT_DIR = "";
	assert.equal(configPath(), join(homedir(), ".pi", "agent", "deepseek-peak.json"), "empty env -> default");
	process.env.PI_CODING_AGENT_DIR = "/home/u/.config/pi/agent";
	assert.equal(configPath(), join("/home/u/.config/pi/agent", "deepseek-peak.json"), "absolute env (XDG) wins");
	process.env.PI_CODING_AGENT_DIR = "~/cfg";
	assert.equal(configPath(), join(homedir(), "cfg", "deepseek-peak.json"), "leading ~ expanded like pi");
	process.env.PI_CODING_AGENT_DIR = "relative/cfg";
	assert.equal(configPath(), join("relative/cfg", "deepseek-peak.json"), "relative env kept relative, like pi");
} finally {
	if (savedAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = savedAgentDir;
}

// --- Bundled holiday table must cover the current year, and the next one from November
// (the State Council notice for next year comes out early November) ---
{
	const now = new Date();
	const year = now.getUTCFullYear();
	assert.ok(HOLIDAY_YEARS.includes(year), "holiday table needs a refresh — see gov.cn State Council notice");
	if (now.getUTCMonth() >= 10) {
		assert.ok(HOLIDAY_YEARS.includes(year + 1), `holiday table needs ${year + 1} — see gov.cn State Council notice`);
	}
}

console.log("selfcheck OK");
