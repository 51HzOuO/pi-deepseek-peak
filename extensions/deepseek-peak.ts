import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const H = 3600e3; // one hour in ms
// DeepSeek peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday-Friday, excluding Chinese
// public holidays (weekends, Sat/Sun Beijing time, and holidays are off-peak all day).
const PEAK_WINDOWS: Array<[number, number]> = [
	[1, 4],
	[6, 10],
];

// Chinese public holidays (official State Council dates), off-peak in full. Source:
// State Council notices on gov.cn (2027: https://www.gov.cn/zhengce/content/202611/content_7085101.htm);
// refresh each November when the notice for the next year is released. Make-up workdays (调休) need no entry: they are always
// Sat/Sun, which are off-peak anyway, so only weekday holidays can change a decision.
const CHINA_HOLIDAY_RANGES: Array<[string, string]> = [
	["2026-01-01", "2026-01-03"], // New Year
	["2026-02-15", "2026-02-23"], // Spring Festival
	["2026-04-04", "2026-04-06"], // Ching Ming
	["2026-05-01", "2026-05-05"], // Labour Day
	["2026-06-19", "2026-06-21"], // Dragon Boat
	["2026-09-25", "2026-09-27"], // Mid-Autumn
	["2026-10-01", "2026-10-07"], // National Day
	["2027-01-01", "2027-01-03"], // New Year
	["2027-02-05", "2027-02-13"], // Spring Festival
	["2027-04-03", "2027-04-05"], // Ching Ming
	["2027-05-01", "2027-05-05"], // Labour Day
	["2027-06-09", "2027-06-09"], // Dragon Boat
	["2027-09-15", "2027-09-15"], // Mid-Autumn
	["2027-10-01", "2027-10-07"], // National Day
];

/** Years covered by CHINA_HOLIDAY_RANGES (the selfcheck refuses to pass on a stale table). */
export const HOLIDAY_YEARS: number[] = [
	...new Set(CHINA_HOLIDAY_RANGES.map(([from]) => Number(from.slice(0, 4)))),
];

// Beijing calendar-day keys ("YYYY-MM-DD"), expanded once at load (UTC math, no DST).
const HOLIDAY_DAYS = new Set<string>();
for (const [from, to] of CHINA_HOLIDAY_RANGES) {
	const end = Date.parse(`${to}T00:00:00Z`);
	for (let t = Date.parse(`${from}T00:00:00Z`); t <= end; t += 24 * H) {
		HOLIDAY_DAYS.add(new Date(t).toISOString().slice(0, 10));
	}
}

// Allowed auto-refresh intervals, in seconds. Keep in sync with the /dsp-refresh picker.
const REFRESH_OPTIONS: Array<{ label: string; seconds: number }> = [
	{ label: "30s", seconds: 30 },
	{ label: "1m", seconds: 60 },
	{ label: "5m", seconds: 300 },
];

interface Config {
	countdown: boolean;
	refresh: number; // seconds; must be one of REFRESH_OPTIONS
}

const DEFAULTS: Config = { countdown: true, refresh: 300 };

/**
 * Config file: `$PI_CODING_AGENT_DIR/deepseek-peak.json` when set (leading `~` expanded, like
 * pi's own getAgentDir()), else `~/.pi/agent/deepseek-peak.json`.
 */
export function configPath(): string {
	const dir = process.env.PI_CODING_AGENT_DIR;
	const base = dir ? dir.replace(/^~(?=$|[\\/])/, homedir()) : join(homedir(), ".pi", "agent");
	return join(base, "deepseek-peak.json");
}

function loadConfig(): Config {
	try {
		const cfg = JSON.parse(readFileSync(configPath(), "utf-8"));
		const refresh =
			typeof cfg.refresh === "number" && REFRESH_OPTIONS.some((o) => o.seconds === cfg.refresh)
				? cfg.refresh
				: DEFAULTS.refresh;
		return {
			countdown: typeof cfg.countdown === "boolean" ? cfg.countdown : DEFAULTS.countdown,
			refresh,
		};
	} catch {
		return { ...DEFAULTS };
	}
}

function saveConfig(patch: Partial<Config>): void {
	writeFileSync(configPath(), JSON.stringify({ ...loadConfig(), ...patch }, null, 2) + "\n");
}

export function isDeepSeekModel(model: { provider?: string; id?: string } | null | undefined): boolean {
	return model?.provider === "deepseek";
}

/** Beijing time (UTC+8) as a Date whose getUTC* fields read Beijing values. */
function beijing(date: Date): Date {
	return new Date(date.getTime() + 8 * H);
}

/**
 * True when DeepSeek bills off-peak: all day on weekends (Sat/Sun Beijing time) and on
 * Chinese public holidays, otherwise outside the UTC peak windows. Peak windows fall
 * inside a single Beijing calendar day, so the holiday lookup by date is exact.
 */
export function isOffPeak(date: Date): boolean {
	const bj = beijing(date);
	const dow = bj.getUTCDay();
	if (dow === 0 || dow === 6) return true;
	if (HOLIDAY_DAYS.has(bj.toISOString().slice(0, 10))) return true;
	const h = date.getUTCHours();
	return !PEAK_WINDOWS.some(([start, end]) => h >= start && h < end);
}

// How far ahead nextStatusChange looks. Spring Festival is ~9.5 contiguous off-peak days
// (weekend + holiday), so 4 days would return null and blank the countdown mid-holiday.
const CHANGE_SCAN_DAYS = 21;

/**
 * First instant where the status flips, or null (never within range).
 * Candidates: UTC window edges (01:00/04:00/06:00/10:00) and Beijing midnights — holiday
 * boundaries are Beijing midnights too — for the 21 UTC calendar days starting today.
 * Boundaries where the status stays the same (e.g. weekend end = Beijing Monday midnight
 * while local is Sunday evening) are skipped.
 */
export function nextStatusChange(date: Date): Date | null {
	const now = date.getTime();
	const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
	const state = isOffPeak(date);
	const candidates: number[] = [];
	for (let i = 0; i < CHANGE_SCAN_DAYS; i++) {
		const d = day + i * 24 * H;
		for (const h of [1, 4, 6, 10]) candidates.push(d + h * H);
		candidates.push(d - 8 * H); // Beijing midnight
	}
	for (const t of candidates.sort((a, b) => a - b)) {
		if (t > now && isOffPeak(new Date(t + 1)) !== state) return new Date(t);
	}
	return null;
}

/** Minutes as "2h", "1h30m", "45m" (empty for 0). */
function formatHM(m: number): string {
	if (m === 0) return "";
	if (m < 60) return `${m}m`;
	const h = Math.floor(m / 60);
	const min = m % 60;
	return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, "0")}m`;
}

/** Time until the next status flip: "8d22h", "27h", "1h30m", "45m" (rounded up to the minute). */
export function formatCountdown(date: Date): string {
	const next = nextStatusChange(date);
	if (!next) return "";
	const m = Math.ceil((next.getTime() - date.getTime()) / 60000);
	// Long off-peak stretches (Chinese holidays) read better in days.
	if (m >= 48 * 60) return `${Math.floor(m / 1440)}d${formatHM(m % 1440)}`;
	return formatHM(m);
}

export function statusText(countdown: boolean, theme: { fg: (color: string, text: string) => string }, now: Date = new Date()): string {
	const peak = !isOffPeak(now);
	const color = peak ? "warning" : "success";
	const label = peak ? "DS Peak" : "DS Normal";
	const cd = countdown ? formatCountdown(now) : "";
	const suffix = cd ? ` for ${cd}` : "";
	return theme.fg(color, `${peak ? "\u{1F534}" : "\u{1F7E2}"} ${label}${suffix}`);
}

export default function (pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	// ctx is session-bound: it goes stale after session replacement or /reload.
	// Never capture it in a timer closure. Keep only the current session's ctx,
	// refreshed on session_start and cleared on session_shutdown.
	let currentCtx: any = null;
	let currentModel: { provider?: string; id?: string } | null | undefined;

	function stopTimer(): void {
		if (timer !== null) {
			clearInterval(timer);
			timer = null;
		}
	}

	function clearStatus(ctx: any): void {
		ctx.ui.setStatus("deepseek-peak", undefined);
	}

	function updateStatus(ctx: any): void {
		ctx.ui.setStatus("deepseek-peak", statusText(loadConfig().countdown, ctx.ui.theme));
	}

	function startTimer(): void {
		if (timer === null && currentCtx !== null && isDeepSeekModel(currentModel)) {
			timer = setInterval(refreshStatus, loadConfig().refresh * 1000);
		}
	}

	function syncModel(ctx: any, model: { provider?: string; id?: string } | null | undefined): void {
		currentCtx = ctx;
		currentModel = model;
		stopTimer();
		if (!isDeepSeekModel(model)) {
			clearStatus(ctx);
			return;
		}
		updateStatus(ctx);
		startTimer();
	}

	function refreshStatus(): void {
		if (currentCtx === null) return;
		try {
			if (!isDeepSeekModel(currentModel)) {
				stopTimer();
				clearStatus(currentCtx);
				return;
			}
			updateStatus(currentCtx);
		} catch {
			// ctx went stale (session replaced or /reload). Stop polling instead of
			// letting an uncaught exception escape the timer and crash pi.
			stopTimer();
			currentCtx = null;
			currentModel = undefined;
		}
	}

	pi.registerCommand("dsp-refresh", {
		description: "Pick the status auto-refresh interval (30s / 1m / 5m) from a menu. No argument needed.",
		handler: async (_args: string, ctx: any) => {
			const current = loadConfig().refresh;
			const label = (seconds: number) => REFRESH_OPTIONS.find((o) => o.seconds === seconds)!.label;
			if (!ctx.hasUI) {
				ctx.ui.notify(`Auto-refresh interval: ${label(current)}`, "info");
				return;
			}
			const choice = await ctx.ui.select(
				`Auto-refresh interval (current: ${label(current)})`,
				REFRESH_OPTIONS.map((o) => o.label),
			);
			const picked = REFRESH_OPTIONS.find((o) => o.label === choice);
			if (!picked) return; // cancelled
			saveConfig({ refresh: picked.seconds });
			syncModel(ctx, ctx.model);
			ctx.ui.notify(`Auto-refresh set to ${picked.label}`, "info");
		},
	});

	pi.registerCommand("dsp-countdown", {
		description: "Pick whether the countdown shows next to the status dot. No argument needed.",
		handler: async (_args: string, ctx: any) => {
			const current = loadConfig().countdown;
			const label = (on: boolean) => (on ? "on" : "off");
			if (!ctx.hasUI) {
				ctx.ui.notify(`Countdown is ${label(current)}`, "info");
				return;
			}
			const choice = await ctx.ui.select(`Countdown (current: ${label(current)})`, ["on", "off"]);
			const picked = choice === "on";
			if (choice !== "on" && choice !== "off") return; // cancelled
			saveConfig({ countdown: picked });
			syncModel(ctx, ctx.model);
			ctx.ui.notify(`DeepSeek countdown ${label(picked)}`, "info");
		},
	});

	pi.on("session_start", async (_event: any, ctx: any) => {
		syncModel(ctx, ctx.model);
	});

	pi.on("model_select", async (event: any, ctx: any) => {
		syncModel(ctx, event.model);
	});

	pi.on("session_shutdown", async () => {
		stopTimer();
		currentCtx = null;
		currentModel = undefined;
	});
};
