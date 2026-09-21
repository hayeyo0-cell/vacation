/** 🚀 대구교통공사 기관사용 교번/행로 조회 앱 (휴가 표시 기능 추가)
 * 개선사항: 
 * 1. [가독성 강화] 전체 탭의 교번과 이름 글씨 두께를 보강 (900 Bold 적용)
 * 2. [디자인 복구] 날짜 선택 인풋으로 인해 뚱뚱해진 헤더 높이 및 정렬 정밀 교정
 * 3. [검색 이미지] 검색 결과 하단 행로표 이미지 표시 로직 유지
 * 4. [뒤로가기/날짜선택] 검색창 히스토리 제어 및 날짜 직접 선택 기능 통합
 * 5. [휴가 표시] 월교번 캘린더에 휴가자 수 동그라미 + 클릭 시 휴가자 목록 모달
 **/

const { useEffect, useMemo, useRef, useState } = React;

// --- 상수 정의 ---
const LS_WORKTIME_OVERRIDES = "gyobeon_worktime_overrides";
const LS_HOLIDAY_CACHE_PREFIX = "gyobeon_holidays_";
const LS_SHARED_CONFIG_CACHE = "gyobeon_shared_config";
const LS_REMOTE_ROSTER_CACHE = "gyobeon_remote_roster";
const LS_REMOTE_ROSTER_DATE = "gyobeon_remote_roster_date";
const LS_LAST_ACK_ROSTER_SIG = "gyobeon_last_ack_roster_sig";
const LS_LAST_SEEN_PUBLISHED_AT = "gyobeon_last_seen_published_at";
const LS_DARK_MODE = "gyobeon_dark_mode";

const TEAM_LABELS = { ks: "경산", my: "문양", wb: "월배", as: "안심" };
const TEAM_ORDER = ["ks", "my", "wb", "as"];
const NIGHT_RANGE_BY_TEAM = { ks: { start: 21, end: 29 }, my: { start: 24, end: 34 }, wb: { start: 25, end: 37 }, as: { start: 25, end: 37 } };

const ADMIN_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbw8NMVjH3J_Mt7SBymWOg44zvD4gd4GXkQB3r95QTl63M3aWqtf-OglLrG2rQPH7J6UjA/exec";
const ADMIN_NAME = ["권재림", "조영빈"];
const ADMIN_PASSWORD = "ks5826";

let SHARED_REMOTE_BASE_DATE = "";
let CURRENT_REMOTE_ROSTER_DATE = "";

function setGlobalBaseDate(value) { SHARED_REMOTE_BASE_DATE = String(value || "").trim(); }
function getGlobalBaseDate() { return String(SHARED_REMOTE_BASE_DATE || "").trim(); }
function setGlobalRemoteRosterDate(value) { CURRENT_REMOTE_ROSTER_DATE = String(value || "").trim(); }
function getGlobalRemoteRosterDate() { return String(CURRENT_REMOTE_ROSTER_DATE || "").trim(); }

const COLOR_OPTIONS = [
  { value: "", label: "기본" }, { value: "#dbeafe", label: "하늘" }, { value: "#bbf7d0", label: "연두" },
  { value: "#fde68a", label: "노랑" }, { value: "#fecaca", label: "분홍" }, { value: "#e9d5ff", label: "보라" }, { value: "#e5e7eb", label: "회색" }
];

const DEFAULT_HOLIDAYS_BY_YEAR = {
  2026: ["2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02", "2026-05-01", "2026-05-05", "2026-05-24", "2026-05-25", "2026-06-03", "2026-06-06", "2026-07-17", "2026-08-15", "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25"],
};

let RUNTIME_HOLIDAYS_BY_YEAR = { ...DEFAULT_HOLIDAYS_BY_YEAR };
const HOLIDAY_FETCHING_YEARS = new Set();
const DEFAULT_GYOBUN = ["2d", "대3", "16d", "휴1", "휴2", "대2", "14d", "24d", "24~", "휴3", "5d", "17d", "27d", "27~", "휴4", "3d", "13d", "23d", "23~", "휴5", "휴6", "대1", "15d", "22d", "22~", "휴7", "9d", "10d", "28d", "28~", "휴7", "9d", "10d", "28d", "28~", "휴8", "4d", "20d", "25d", "25~", "휴9", "1d", "11d", "대4", "대4~", "휴10", "휴11", "7d", "18d", "29d", "29~", "휴12", "8d", "12d", "26d", "26~", "휴13", "휴14", "6d", "19d", "21d", "21~", "휴15"];
const HIDDEN_NAME_KEYS = ["gb2601"];

function normalizeNameKey(name) { return String(name || "").trim().toLowerCase().replace(/\s+/g, ""); }
function shouldHideName(name) { return HIDDEN_NAME_KEYS.includes(normalizeNameKey(name)); }
function samePersonName(a, b) { return String(a || "").trim().replace(/\s/g, "") === String(b || "").trim().replace(/\s/g, ""); }
function hasPersonInTeam(team, name) { return !!team?.people?.some((p) => samePersonName(p.name, name)); }
function parseLocalDate(dateStr) { if (!dateStr) return new Date(); const [y, m, d] = String(dateStr).split("-").map(Number); return new Date(y, (m || 1) - 1, d || 1); }
function formatDate(date) { const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, "0"); const d = String(date.getDate()).padStart(2, "0"); return `${y}-${m}-${d}`; }
function getKoreaNow() { const now = new Date(); const utcTime = now.getTime() + now.getTimezoneOffset() * 60000; return new Date(utcTime + 9 * 60 * 60000); }
function getKoreaToday() { return formatDate(getKoreaNow()); }
function addDays(dateStr, days) { const d = parseLocalDate(dateStr); d.setDate(d.getDate() + days); return formatDate(d); }
function addMonths(dateStr, months) { const d = parseLocalDate(dateStr); const originalDate = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + months); const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(originalDate, lastDay)); return formatDate(d); }
function diffDays(a, b) { const da = parseLocalDate(a); const db = parseLocalDate(b); da.setHours(0, 0, 0, 0); db.setHours(0, 0, 0, 0); return Math.round((db.getTime() - da.getTime()) / 86400000); }
function positiveMod(n, mod) { return ((n % mod) + mod) % mod; }
function weekdayShort(dateStr) { const names = ["일", "월", "화", "수", "목", "금", "토"]; return names[parseLocalDate(dateStr).getDay()]; }
function weekdayName(dateStr) { const names = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"]; return names[parseLocalDate(dateStr).getDay()]; }

function isSaturday(dateStr) { return parseLocalDate(dateStr).getDay() === 6; }
function isSunday(dateStr) { return parseLocalDate(dateStr).getDay() === 0; }
function getYearFromDateStr(dateStr) { return Number(String(dateStr || "").slice(0, 4)); }
function dedupeSortDates(list) { return [...new Set((list || []).map((v) => String(v || "").trim()).filter(Boolean))].sort(); }
function setHolidayYear(year, dates) { const y = Number(year); if (!y) return; RUNTIME_HOLIDAYS_BY_YEAR[y] = dedupeSortDates(dates); }
function loadHolidayYearFromCache(year) { try { const raw = JSON.parse(localStorage.getItem(`${LS_HOLIDAY_CACHE_PREFIX}${year}`) || "null"); if (!raw?.dates?.length) return null; return dedupeSortDates(raw.dates); } catch { return null; } }
function saveHolidayYearToCache(year, dates) { try { localStorage.setItem(`${LS_HOLIDAY_CACHE_PREFIX}${year}`, JSON.stringify({ year, savedAt: Date.now(), dates: dedupeSortDates(dates) })); } catch (_) {} }
function isHolidayDate(dateStr) { const clean = String(dateStr || "").trim(); const year = getYearFromDateStr(clean); const yearly = RUNTIME_HOLIDAYS_BY_YEAR[year] || DEFAULT_HOLIDAYS_BY_YEAR[year] || []; return yearly.includes(clean); }

async function fetchHolidayYear(year) {
  const res = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`, { method: "GET" });
  if (!res.ok) throw new Error(`공휴일 조회 실패 (${year})`);
  const json = await res.json();
  const dates = (Array.isArray(json) ? json : []).filter((row) => row?.date && (Array.isArray(row?.types) ? row.types : []).includes("Public") || row?.global === true).map((row) => String(row.date).trim());
  return dedupeSortDates(dates);
}

async function ensureHolidayYear(year, onApplied) {
  const y = Number(year); if (!y) return; if (RUNTIME_HOLIDAYS_BY_YEAR[y]?.length) return; if (HOLIDAY_FETCHING_YEARS.has(y)) return;
  const cached = loadHolidayYearFromCache(y);
  if (cached?.length) { setHolidayYear(y, cached); onApplied?.(); return; }
  HOLIDAY_FETCHING_YEARS.add(y);
  try {
    const fetched = await fetchHolidayYear(y);
    if (fetched?.length) { setHolidayYear(y, fetched); saveHolidayYearToCache(y, fetched); onApplied?.(); return; }
    if (DEFAULT_HOLIDAYS_BY_YEAR[y]?.length) { setHolidayYear(y, fetched); onApplied?.(); }
  } catch (err) {
    if (DEFAULT_HOLIDAYS_BY_YEAR[y]?.length) { setHolidayYear(y, DEFAULT_HOLIDAYS_BY_YEAR[y]); onApplied?.(); }
  } finally { HOLIDAY_FETCHING_YEARS.delete(y); }
}

function guessDayType(dateStr) { 
  if (isSunday(dateStr) || isHolidayDate(dateStr)) return "hol"; 
  if (isSaturday(dateStr)) return "sat"; 
  return "nor"; 
}
function getDateToneClass(dateStr) { if (isSunday(dateStr) || isHolidayDate(dateStr)) return "tone-sun"; if (isSaturday(dateStr)) return "tone-sat"; return "tone-normal"; }
function getDateBasedColor(dateStr) { if (isSunday(dateStr) || isHolidayDate(dateStr)) return "#ef4444"; if (isSaturday(dateStr)) return "#2563eb"; return "inherit"; }

function parseLines(text) { return String(text || "").replace(/\r/g, "").split("\n").map((v) => v.trim()).filter(Boolean); }
function parseInfo(text) {
  const lines = parseLines(text); const tokens = lines.join(" ").split(/\s+/).filter(Boolean);
  const [year, month, day, baseCode, baseName, total] = tokens;
  return { raw: lines, baseDate: year && month && day ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null, baseCode: baseCode || null, baseName: baseName || null, totalCount: total && !Number.isNaN(Number(total)) ? Number(total) : 0 };
}

function normalizeWorktimeLine(line) { return String(line || "").replace(/\s+/g, " ").trim().toLowerCase(); }
function parseWorktime(text, gyobunOrder = []) {
  const lines = parseLines(text).map(normalizeWorktimeLine); const map = {};
  gyobunOrder.forEach((code, idx) => { map[String(code || "").trim().toLowerCase()] = lines[idx] || "----"; });
  return map;
}

function normalizeCodeKey(code) { return String(code || "").trim().toLowerCase().replace(/\s+/g, ""); }
function parseShiftCode(code) { 
  const s = normalizeCodeKey(code); 
  const match = s.match(/^(\d+)(d|~)$/); 
  if (!match) return null; 
  return { num: Number(match[1]), suffix: match[2] }; 
}

function getNightRange(teamKey) { return NIGHT_RANGE_BY_TEAM[teamKey] || { start: 22, end: 29 }; }

function isNightStartCode(teamKey, code) { 
  const s = normalizeCodeKey(code);
  const numMatch = s.match(/^(\d+)/);
  if (!numMatch) return false;
  const num = Number(numMatch[1]);
  const range = getNightRange(teamKey); 
  return num >= range.start && num <= range.end; 
}

function loadWorktimeOverrides() { try { return JSON.parse(localStorage.getItem(LS_WORKTIME_OVERRIDES) || "{}"); } catch { return {}; } }
function saveWorktimeOverrides(value) { localStorage.setItem(LS_WORKTIME_OVERRIDES, JSON.stringify(value || {})); }
function getWorktimeOverrideKey(teamKey, personName) { return `${teamKey}::${normalizeNameKey(personName)}`; }
function getWorktimeOverrideValue(teamKey, code, dayType) { const data = loadWorktimeOverrides(); const key = getWorktimeOverrideKey(teamKey, code); return String(data?.[key]?.[dayType] || "").trim(); }
function parseTimeValueToParts(value) { const raw = String(value || "").trim(); if (!raw || raw === "----") return { sh: "", sm: "", eh: "", em: "" }; const match = raw.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/); return match ? { sh: match[1], sm: match[2], eh: match[3], em: match[4] } : { sh: "", sm: "", eh: "", em: "" }; }
function clamp2(value) { return String(value || "").replace(/\D/g, "").slice(0, 2); }
function buildTimeValueFromParts(sh, sm, eh, em) { const a = clamp2(sh); const b = clamp2(sm); const c = clamp2(eh); const d = clamp2(em); if (!a || !b || !c || !d) return null; const shNum = Number(a); const smNum = Number(b); const ehNum = Number(c); const emNum = Number(d); if (Number.isNaN(shNum) || Number.isNaN(smNum) || Number.isNaN(ehNum) || Number.isNaN(emNum) || shNum < 0 || shNum > 23 || ehNum < 0 || ehNum > 23 || smNum < 0 || smNum > 59 || emNum < 0 || emNum > 59) return null; return `${String(shNum).padStart(2, "0")}:${String(smNum).padStart(2, "0")}-${String(ehNum).padStart(2, "0")}:${String(emNum).padStart(2, "0")}`; }
function pickWorktime(team, code, dateStr) { const kind = guessDayType(dateStr); const overrideValue = getWorktimeOverrideValue(team?.key, code, kind); if (overrideValue) return overrideValue; const key = normalizeCodeKey(code); const source = team?.worktimes?.[kind] || {}; return source[key] || "----"; }

function getPathFolder(teamKey, dateStr, code) {
  const s = normalizeCodeKey(code);
  const isTilde = s.includes("~"); 
  const isNightStart = isNightStartCode(teamKey, code); 
  
  if (isTilde || isNightStart) {
    const startDate = isTilde ? addDays(dateStr, -1) : dateStr;
    const endDate = addDays(startDate, 1);
    
    const curType = guessDayType(startDate); 
    const nxtType = guessDayType(endDate);
    
    if (curType === nxtType) return curType;
    return `${curType}_${nxtType}`; 
  }
  
  return guessDayType(dateStr);
}

function findPathImage(team, dateStr, code) {
  if (!team || !code) return null;
  const s = normalizeCodeKey(code);
  if (s.startsWith("대") || s.startsWith("휴")) return null;

  const folder = getPathFolder(team.key, dateStr, code).toLowerCase(); 
  const raw = s.replace('~', 'd');
  const strippedD = raw.replace(/d$/, ""); 
  const candidates = [raw, strippedD, `제${strippedD}`, `${raw}.png`, `${raw}.jpg`, `${raw}.jpeg`, `${strippedD}.png`, `${strippedD}.jpg`, `${strippedD}.jpeg` ];
  const bucket = team?.paths?.[folder]; 
  if (!bucket) return null;
  for (const key of candidates) { 
    if (bucket[key]) return bucket[key]; 
    if (bucket[key.toLowerCase()]) return bucket[key.toLowerCase()]; 
  }
  return null;
}

function getGyobunOrder(team) { return team?.gyobun?.length ? team.gyobun : DEFAULT_GYOBUN; }
function getDiaOrder(team) { return team?.diaOrder?.length ? team.diaOrder : getGyobunOrder(team); }
function normalizeToFixedCode(team, code) { const fixedCodes = getGyobunOrder(team); return fixedCodes.find((item) => normalizeCodeKey(item) === normalizeCodeKey(code)) || code || ""; }
function shiftCodeByDays(team, baseCode, dayOffset) { const order = getGyobunOrder(team); const baseIdx = order.findIndex((code) => normalizeCodeKey(code) === normalizeCodeKey(baseCode)); if (baseIdx < 0) return baseCode || ""; return order[positiveMod(baseIdx + dayOffset, order.length)] || baseCode || ""; }
function getAllGridLayout(count) { if (count >= 49) return { cols: 6, className: "density-6" }; if (count >= 36) return { cols: 5, className: "density-5" }; return { cols: 4, className: "density-4" }; }
function createTeamBucket(teamKey) { return { key: teamKey, label: TEAM_LABELS[teamKey], names: [], gyobun: [], diaOrder: [], people: [], info: { totalCount: 0, baseDate: null, baseCode: null, baseName: null, raw: [] }, worktimes: { nor: {}, sat: {}, hol: {} }, paths: { nor: {}, sat: {}, hol: {}, nor_sat: {}, nor_hol: {}, sat_hol: {}, sat_nor: {}, hol_nor: {}, hol_sat: {} }, trainData: {} }; }

function cloneTeamData(data) {
  const result = {};
  TEAM_ORDER.forEach((teamKey) => {
    const team = data?.[teamKey]; if (!team) return;
    result[teamKey] = { ...team, names: Array.isArray(team.names) ? [...team.names] : [], gyobun: Array.isArray(team.gyobun) ? [...team.gyobun] : [], diaOrder: Array.isArray(team.diaOrder) ? [...team.diaOrder] : [], people: Array.isArray(team.people) ? team.people.map((p) => ({ ...p })) : [], info: team.info ? { ...team.info, raw: [...(team.info.raw || [])] } : createTeamBucket(teamKey).info, worktimes: { nor: { ...(team.worktimes?.nor || {}) }, sat: { ...(team.worktimes?.sat || {}) }, hol: { ...(team.worktimes?.hol || {}) } }, paths: { nor: { ...(team.paths?.nor || {}) }, sat: { ...(team.paths?.sat || {}) }, hol: { ...(team.paths?.hol || {}) }, nor_sat: { ...(team.paths?.nor_sat || {}) }, nor_hol: { ...(team.paths?.nor_hol || {}) }, sat_hol: { ...(team.paths?.sat_hol || {}) }, sat_nor: { ...(team.paths?.sat_nor || {}) }, hol_nor: { ...(team.paths?.hol_nor || {}) }, hol_sat: { ...(team.paths?.hol_sat || {}) } }, trainData: { ...(team.trainData || {}) } };
  });
  return result;
}

function parseZipToData(parsedFiles) {
  const result = {}; TEAM_ORDER.forEach((teamKey) => { result[teamKey] = createTeamBucket(teamKey); });
  Object.entries(parsedFiles).forEach(([path, content]) => {
    const clean = path.replace(/^\/+/, ""); 
    const parts = clean.split("/"); 
    const teamKey = parts.find((p) => TEAM_ORDER.includes(p.toLowerCase())); 
    if (!teamKey) return;
    const team = result[teamKey]; const fileName = parts[parts.length - 1];
    if (fileName === "name.txt") team.names = parseLines(content); if (fileName === "gyobun.txt") team.gyobun = parseLines(content); if (fileName === "info.txt") team.info = parseInfo(content); if (fileName === "dialist.txt") team.diaOrder = parseLines(content);
  });
  TEAM_ORDER.forEach((teamKey) => {
    const team = result[teamKey]; if (!team.gyobun.length) team.gyobun = DEFAULT_GYOBUN.slice();
    const filtered = team.names.map((name, idx) => ({ name, baseCode: team.gyobun[idx] || "", idx })).filter((person) => !shouldHideName(person.name));
    team.people = filtered; team.names = filtered.map((p) => p.name);
    if (!team.info.totalCount) team.info.totalCount = team.people.length;
    if (!team.info.baseName && team.people[0]?.name) team.info.baseName = team.people[0].name;
    if (!team.info.baseCode && team.people[0]?.baseCode) team.info.baseCode = team.people[0].baseCode;
  });
  Object.entries(parsedFiles).forEach(([path, content]) => {
    const clean = path.replace(/^\/+/, ""); const parts = clean.split("/"); 
    const lowerParts = parts.map(p => p.toLowerCase()); 
    const teamKey = parts.find((p) => TEAM_ORDER.includes(p.toLowerCase())); 
    if (!teamKey) return;
    const team = result[teamKey]; const fileName = parts[parts.length - 1]; const parent = parts[parts.length - 2]?.toLowerCase(); 
    const gyobunOrder = team.gyobun.length ? team.gyobun : DEFAULT_GYOBUN;
    if (fileName === "nor_worktime.txt") team.worktimes.nor = parseWorktime(content, gyobunOrder); if (fileName === "sat_worktime.txt") team.worktimes.sat = parseWorktime(content, gyobunOrder); if (fileName === "hol_worktime.txt") team.worktimes.hol = parseWorktime(content, gyobunOrder);

    if (lowerParts.includes("train_data") && fileName.endsWith(".txt")) {
        const type = fileName.replace("_train_data.txt", "").replace(".txt", ""); 
        const lines = parseLines(content);
        const mapping = {}; let lastCode = "";
        lines.forEach(line => {
          if (!line) return;
          if (line.match(/^(\d+)(d|~)$|^대\d+/i)) { lastCode = normalizeCodeKey(line); mapping[lastCode] = []; }
          else if (lastCode) { mapping[lastCode] = [...mapping[lastCode], ...line.split(/\s+/).filter(Boolean)]; }
        });
        if (!team.trainData) team.trainData = {};
        team.trainData[type] = mapping;
    }

    if (lowerParts.includes("path") && /\.(png|jpg|jpeg)$/i.test(fileName)) { 
        const kind = parent; 
        if (team.paths[kind]) { 
            const originalName = fileName; 
            const lowerName = fileName.toLowerCase(); 
            const baseName = lowerName.replace(/\.(png|jpg|jpeg)$/i, ""); 
            team.paths[kind][originalName] = content; 
            team.paths[kind][lowerName] = content; 
            team.paths[kind][baseName] = content; 
        } 
    }
  });
  return result;
}

function loadOverrides() { try { return JSON.parse(localStorage.getItem("gyobeon_overrides") || "{}"); } catch { return {}; } }
function saveOverrides(value) { localStorage.setItem("gyobeon_overrides", JSON.stringify(value)); }
function cleanupNameOverrides() { try { const raw = localStorage.getItem("gyobeon_overrides"); if (!raw) return; const data = JSON.parse(raw); let changed = false; Object.keys(data).forEach((key) => { const item = data[key]; if (item && typeof item === "object" && "name" in item) { delete item.name; changed = true; } }); if (changed) localStorage.setItem("gyobeon_overrides", JSON.stringify(data)); } catch (err) {} }

function loadMySelection() { try { const raw = JSON.parse(localStorage.getItem("gyobeon_my_selection") || "null"); if (!raw) return null; return { teamKey: raw.teamKey || "ks", name: raw.name || "", code: raw.code || "", anchorDate: raw.anchorDate || getKoreaToday() }; } catch { return null; } }
function saveMySelection(value) { const next = { teamKey: value?.teamKey || "ks", name: value?.name || "", code: value?.code || "", anchorDate: value?.anchorDate || getKoreaToday() }; localStorage.setItem("gyobeon_my_selection", JSON.stringify(next)); }
function clearMySelection() { localStorage.removeItem("gyobeon_my_selection"); }

// 교번변경 탭 입력값(사람 A/B, 기간) - 앱을 종료했다 다시 열어도 유지되도록 저장해요.
function loadSwapState() { try { return JSON.parse(localStorage.getItem("gyobeon_swap_state") || "null"); } catch { return null; } }
function saveSwapState(value) { try { localStorage.setItem("gyobeon_swap_state", JSON.stringify(value || {})); } catch (_) {} }
function loadGroups() { try { return JSON.parse(localStorage.getItem("gyobeon_groups") || "{}"); } catch { return {}; } }
function saveGroups(groups) { localStorage.setItem("gyobeon_groups", JSON.stringify(groups)); }
function getEmptyRemoteRoster() { return { ks: [], my: [], wb: [], as: [] }; }
function loadCachedSharedConfig() { try { return JSON.parse(localStorage.getItem(LS_SHARED_CONFIG_CACHE) || "null"); } catch { return null; } }
function saveCachedSharedConfig(value) { try { localStorage.setItem(LS_SHARED_CONFIG_CACHE, JSON.stringify(value || null)); } catch (_) {} }
function normalizeTeamKey(value) { const v = String(value || "").trim().toLowerCase(); if (TEAM_ORDER.includes(v)) return v; const found = TEAM_ORDER.find((key) => TEAM_LABELS[key] === String(value || "").trim()); return found || ""; }

function normalizeRemoteRosterShape(input) {
  const result = getEmptyRemoteRoster(); if (!input || typeof input !== "object") return result;
  if (TEAM_ORDER.some((teamKey) => Array.isArray(input?.[teamKey]))) {
    TEAM_ORDER.forEach((teamKey) => { result[teamKey] = (Array.isArray(input?.[teamKey]) ? input[teamKey] : []).map((row) => ({ code: String(row?.code || row?.gyobun || row?.교번 || row?.shiftCode || "").trim(), employeeId: String(row?.employeeId || row?.직원ID || row?.id || "").trim(), name: String(row?.name || row?.이름 || "").trim() })).filter((row) => row.code && row.name); });
    return result;
  }
  const rows = Array.isArray(input.rows) ? input.rows : Array.isArray(input) ? input : [];
  rows.forEach((row) => {
    const teamKey = normalizeTeamKey(row?.team) || normalizeTeamKey(row?.teamKey) || normalizeTeamKey(row?.teamLabel) || normalizeTeamKey(row?.소속);
    const gyobun = String(row?.gyobun || row?.교번 || row?.code || row?.shiftCode || "").trim(); const employeeId = String(row?.employeeId || row?.직원ID || row?.id || "").trim(); const name = String(row?.name || row?.이름 || "").trim();
    if (!teamKey || !gyobun || !name) return; result[teamKey].push({ code: gyobun, employeeId, name });
  });
  return result;
}

function loadCachedRemoteRoster() { try { const raw = JSON.parse(localStorage.getItem(LS_REMOTE_ROSTER_CACHE) || "null"); return normalizeRemoteRosterShape(raw); } catch { return getEmptyRemoteRoster(); } }
function saveCachedRemoteRoster(value) { try { localStorage.setItem(LS_REMOTE_ROSTER_CACHE, JSON.stringify(value || getEmptyRemoteRoster())); } catch (_) {} }
function hasAnyRemoteRoster(remoteRoster) { return TEAM_ORDER.some((teamKey) => (remoteRoster?.[teamKey] || []).length > 0); }
function getRemoteRosterSignature(remoteRoster) { return JSON.stringify(normalizeRemoteRosterShape(remoteRoster || getEmptyRemoteRoster())); }
function getOverrideKey(teamKey, personName) { return `${teamKey}::${normalizeNameKey(personName)}`; }

// 🆕 "표시 이름"을 저장할 때 어느 자리(교번코드)에서 설정한 건지도 같이 저장해둬요.
// 표시할 때는 "지금 그 이름이 실제로 그 자리에 있을 때만" 별명을 보여줘요 - 나중에 관리자가
// 스프레드시트를 바꿔서 그 사람이 다른 자리로 옮겨가면, 조건이 안 맞으니까 자동으로
// 원래 이름으로 돌아가요 (표시 이름을 다시 지울 필요 없이, 저절로 정리돼요).
function resolveDisplayName(overrides, teamKey, code, realName) {
  const override = overrides?.[getOverrideKey(teamKey, realName)];
  if (!override?.alias) return realName;
  if (override.aliasBaseCode && override.aliasBaseCode !== normalizeCodeKey(code)) return realName;
  return override.alias;
}

function hasRemoteRosterForTeam(teamKey, remoteRoster) { return Array.isArray(remoteRoster?.[teamKey]) && remoteRoster[teamKey].length > 0; }
function getZipBaseDate(team) { return String(team?.info?.baseDate || "").trim() || getKoreaToday(); }
function getResolvedBaseDate(teamKey, team, remoteRoster) { return getGlobalBaseDate() || getZipBaseDate(team); }

function migrateLegacyOverrides(currentOverrides, data) {
  if (!currentOverrides || !data) return currentOverrides || {}; const next = { ...currentOverrides }; let changed = false;
  Object.keys(currentOverrides).forEach((key) => {
    const match = key.match(/^([a-z]{2})_(\d+)$/i); if (!match) return;
    const teamKey = match[1]; const idx = Number(match[2]); const team = data?.[teamKey]; const person = team?.people?.find((p) => Number(p.idx) === idx); if (!person?.name) return;
    const newKey = getOverrideKey(teamKey, person.name); if (!next[newKey]) { next[newKey] = currentOverrides[key]; changed = true; } delete next[key]; changed = true;
  });
  if (changed) saveOverrides(next); return next;
}

function buildAssignedGrid(team, anchorName, anchorCode, dayOffset, overrides) {
  if (!team || !team.people?.length) return [];
  const people = team.people; const fixedCodes = getGyobunOrder(team); const anchorPersonIndex = people.findIndex((p) => samePersonName(p.name, anchorName)); const anchorCodeIndex = fixedCodes.findIndex((code) => normalizeCodeKey(code) === normalizeCodeKey(anchorCode));
  if (anchorPersonIndex < 0 || anchorCodeIndex < 0) { return fixedCodes.map((slotCode, slotIndex) => { const person = people[slotIndex] || { idx: slotIndex, name: "" }; const override = overrides[getOverrideKey(team.key, person.name)] || {}; return { idx: person.idx, name: person.name, displayName: resolveDisplayName(overrides, team.key, person.baseCode, person.name), code: slotCode, baseCode: person.baseCode, customColor: override.color || "", teamKey: team.key }; }).filter((item) => item.name); }
  return fixedCodes.map((slotCode, slotIndex) => { const personIndex = positiveMod(anchorPersonIndex + (slotIndex - anchorCodeIndex - dayOffset), people.length); const person = people[personIndex]; if (!person) return null; const override = overrides[getOverrideKey(team.key, person.name)] || {}; return { idx: person.idx, name: person.name, displayName: resolveDisplayName(overrides, team.key, person.baseCode, person.name), code: slotCode, baseCode: person.baseCode, customColor: override.color || "", teamKey: team.key }; }).filter((item) => item && item.name);
}

function getRemoteAnchorBaseDate(team) { return getGlobalBaseDate() || getZipBaseDate(team); }

function buildRemoteShiftedGrid(teamKey, team, remoteRoster, targetDate, overrides = {}) {
  const fixedCodes = getGyobunOrder(team);
  const rows = Array.isArray(remoteRoster?.[teamKey]) ? remoteRoster[teamKey] : [];
  const originalPeople = Array.isArray(team?.people) ? team.people : [];
  const anchorDate = getRemoteAnchorBaseDate(team);
  const dayOffset = diffDays(anchorDate, targetDate);
  const shiftedRows = rows.map((row) => ({ ...row, shiftedCode: shiftCodeByDays(team, row.code, dayOffset) }));

  return fixedCodes.map((slotCode, idx) => {
    const found = shiftedRows.find((row) => normalizeCodeKey(row.shiftedCode) === normalizeCodeKey(slotCode));
    if (found && found.name) {
      if (shouldHideName(found.name)) return null;
      const override = overrides[getOverrideKey(teamKey, found.name)] || {};
      return {
        idx,
        name: found.name,
        displayName: resolveDisplayName(overrides, teamKey, found.code, found.name),
        code: slotCode,
        baseCode: found.code,
        customColor: override.color || "",
        employeeId: found.employeeId || ""
      };
    }

    const fallback = originalPeople.find((p) =>
      normalizeCodeKey(shiftCodeByDays(team, p.baseCode || "", dayOffset)) === normalizeCodeKey(slotCode)
    );

    if (fallback && fallback.name) {
      const alreadyAssigned = shiftedRows.some((row) => samePersonName(row.name, fallback.name));
      if (alreadyAssigned) return null;

      if (shouldHideName(fallback.name)) return null;
      const override = overrides[getOverrideKey(teamKey, fallback.name)] || {};
      return {
        idx: fallback.idx ?? idx,
        name: fallback.name,
        displayName: resolveDisplayName(overrides, teamKey, fallback.baseCode, fallback.name),
        code: slotCode,
        baseCode: fallback.baseCode,
        customColor: override.color || "",
        employeeId: fallback.employeeId || ""
      };
    }

    return null;
  }).filter(Boolean);
}

function buildTeamAnchorFromZip(team) {
  const people = Array.isArray(team?.people) ? team.people : []; const fixedCodes = getGyobunOrder(team); let baseDate = getZipBaseDate(team);
  if (!people.length) return { name: team?.info?.baseName || "", code: normalizeToFixedCode(team, team?.info?.baseName || fixedCodes[0] || ""), anchorDate: baseDate };
  const matchedPerson = people.find((p) => samePersonName(p.name, team?.info?.baseName)); if (matchedPerson) return { name: matchedPerson.name, code: normalizeToFixedCode(team, team?.info?.baseCode || matchedPerson.baseCode || fixedCodes[0] || ""), anchorDate: baseDate };
  const firstPerson = people[0]; return { name: firstPerson?.name || "", code: normalizeToFixedCode(team, team?.info?.baseCode || firstPerson?.baseCode || fixedCodes[0] || ""), anchorDate: baseDate };
}

function findRemoteRowByName(teamKey, name, remoteRoster) { const rows = remoteRoster?.[teamKey] || []; return rows.find((row) => samePersonName(row.name, name)) || null; }
function findZipPersonByName(team, name) { if (!team?.people?.length) return null; return team.people.find((p) => samePersonName(p.name, name)) || null; }

function applyRemoteRosterNamesForSetup(baseData, remoteRoster) {
  if (!baseData) return null;
  const next = cloneTeamData(baseData);
  TEAM_ORDER.forEach((teamKey) => {
    const team = next[teamKey];
    if (!team) return;
    const rows = Array.isArray(remoteRoster?.[teamKey]) ? remoteRoster[teamKey] : [];
    if (!rows.length) return;
    const fixedOrder = getGyobunOrder(team);
    const originalPeople = Array.isArray(team.people) ? team.people : [];

    const mapped = fixedOrder.map((slotCode, idx) => {
      const found = rows.find((row) => normalizeCodeKey(row.code) === normalizeCodeKey(slotCode));
      if (found && found.name) {
        if (shouldHideName(found.name)) return null;
        return { idx, name: found.name, baseCode: slotCode, employeeId: found.employeeId || "" };
      }

      const fallback = originalPeople.find((p) => normalizeCodeKey(p.baseCode) === normalizeCodeKey(slotCode));
      if (fallback && fallback.name) {
        const alreadyAssigned = rows.some((row) => samePersonName(row.name, fallback.name));
        if (alreadyAssigned) return null;

        if (shouldHideName(fallback.name)) return null;
        return { idx: fallback.idx ?? idx, name: fallback.name, baseCode: slotCode, employeeId: fallback.employeeId || "" };
      }

      return null;
    }).filter(Boolean);

    if (mapped.length > 0) {
      team.people = mapped;
      team.names = mapped.map((p) => p.name);
    }
  });
  return next;
}

function buildAnchorForIdentity(teamKey, team, remoteRoster, name, mySelection = null) {
  if (!team || !name) return buildTeamAnchorFromZip(team);
  try {
    if (mySelection?.teamKey === teamKey && samePersonName(mySelection?.name, name)) return { name, code: normalizeToFixedCode(team, mySelection?.code || ""), anchorDate: String(mySelection?.anchorDate || "").trim() || getZipBaseDate(team) };
    const remoteRow = findRemoteRowByName(teamKey, name, remoteRoster); if (remoteRow?.code) return { name, code: normalizeToFixedCode(team, remoteRow.code), anchorDate: getRemoteAnchorBaseDate(team) };
    const zipPerson = findZipPersonByName(team, name); if (zipPerson?.baseCode) return { name, code: normalizeToFixedCode(team, zipPerson.baseCode), anchorDate: getZipBaseDate(team) };
  } catch (e) { console.error("Identity build error", e); }
  return buildTeamAnchorFromZip(team);
}

function buildAllTeamsAutoAnchorsFromIdentity(data, remoteRoster, selectedTeamKey, selectedName, mySelection = null) {
  const result = {}; TEAM_ORDER.forEach((teamKey) => { const team = data?.[teamKey]; if (!team) return; if (teamKey === selectedTeamKey && selectedName) { result[teamKey] = buildAnchorForIdentity(teamKey, team, remoteRoster, selectedName, mySelection); return; } result[teamKey] = buildTeamAnchorFromZip(team); });
  return result;
}

function getMyCodeForDate(team, dateStr, mySelection) { if (!team || !mySelection?.code) return ""; const anchorDate = String(mySelection.anchorDate || "").trim() || getZipBaseDate(team); const dayOffset = diffDays(anchorDate, dateStr); return shiftCodeByDays(team, mySelection.code, dayOffset); }

function getMonthMatrix(dateStr) { 
  const d = parseLocalDate(dateStr); 
  const year = d.getFullYear(); 
  const month = d.getMonth(); 
  const first = new Date(year, month, 1); 
  const firstDay = first.getDay(); 
  const start = new Date(year, month, 1 - firstDay); 
  const matrix = []; 
  for (let r = 0; r < 6; r++) { 
    const row = []; 
    for (let c = 0; c < 7; c++) { 
      const temp = new Date(start); 
      temp.setDate(start.getDate() + r * 7 + c); 
      row.push(formatDate(temp)); 
    } 
    matrix.push(row); 
  } 
  return matrix; 
}
function getWeekDates(baseDate) { const d = parseLocalDate(baseDate); const day = d.getDay(); const sunday = new Date(d); sunday.setDate(d.getDate() - day); const dates = []; for (let i = 0; i < 7; i++) { const temp = new Date(sunday); temp.setDate(sunday.getDate() + i); dates.push(formatDate(temp)); } return dates; }

function getMonthOptions(centerDateStr, range = 12) { 
  const base = parseLocalDate(centerDateStr); 
  const currentMonthVal = getDisplayMonthValue(getKoreaToday());
  const list = []; 
  for (let i = -range; i <= range; i++) { 
    const d = new Date(base.getFullYear(), base.getMonth() + i, 1); 
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; 
    const label = value === currentMonthVal ? `📍 ${d.getFullYear()}년 ${d.getMonth() + 1}월 (이번 달)` : `${d.getFullYear()}년 ${d.getMonth() + 1}월`; 
    list.push({ value, label }); 
  } 
  return list; 
}

function getDisplayMonthValue(dateStr) { return String(dateStr || "").slice(0, 7); }
function getMonthStartDate(monthValue) { const [y, m] = String(monthValue || "").split("-").map(Number); if (!y || !m) return getKoreaToday(); return `${y}-${String(m).padStart(2, "0")}-01`; }
function formatMonthDay(dateStr) { const d = parseLocalDate(dateStr); return `${d.getMonth() + 1}/${d.getDate()}`; }
function splitWorktime(worktime) { const raw = String(worktime || "").trim(); if (!raw || raw === "----") return { startTime: "-", endTime: "-" }; const normalized = raw.replace(/\s+/g, ""); if (normalized.includes("-")) { const [start, end] = normalized.split("-"); return { startTime: start || "-", endTime: "" }; } return { startTime: raw, endTime: "" }; }

// 교번변경 휴양시간 계산용 - "HH:MM-HH:MM" 형태의 근무시간 문자열을 자정 기준 분 단위로 변환해요.
function parseHM_(str) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(str || "").trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}
function parseWorktimeRange_(worktime) {
  const raw = String(worktime || "").trim();
  if (!raw || raw === "----") return null;
  const normalized = raw.replace(/\s+/g, "");
  if (!normalized.includes("-")) return null;
  const [startStr, endStr] = normalized.split("-");
  const start = parseHM_(startStr);
  const end = parseHM_(endStr);
  if (start == null || end == null) return null;
  return { start, end };
}
// 퇴근(prevRange)부터 다음날 출근(curRange)까지 휴양시간(시간 단위) - 야간 근무처럼 자정을 넘겨
// 끝나는 근무는 실제 퇴근이 다음날이라, 그 경우엔 자정을 넘기지 않은 것처럼 그냥 차이만 계산해요.
function restHoursBetween_(prevRange, curRange) {
  if (!prevRange || !curRange) return null;
  const crossesMidnight = prevRange.end < prevRange.start;
  const gapMinutes = crossesMidnight
    ? curRange.start - prevRange.end
    : (24 * 60 - prevRange.end) + curRange.start;
  return gapMinutes / 60;
}
// dates/codes: 같은 길이의 배열 (연속된 날짜와 그날의 교번코드) - 각 인덱스가 "그 전날에서 이어질 때
// 휴양시간이 12시간 미만이면" true인 배열을 돌려줘요 (index 0은 비교 대상이 없어서 항상 false).
function computeRestViolations_(team, dates, codes) {
  const violations = new Array(dates.length).fill(false);
  for (let i = 1; i < dates.length; i++) {
    const prevRange = parseWorktimeRange_(pickWorktime(team, codes[i - 1], dates[i - 1]));
    const curRange = parseWorktimeRange_(pickWorktime(team, codes[i], dates[i]));
    const rest = restHoursBetween_(prevRange, curRange);
    if (rest != null && rest < 12) violations[i] = true;
  }
  return violations;
}

const captureAndSave = async (elementId, filenamePrefix, isDarkMode) => {
  if (!window.html2canvas) {
    await new Promise(r => setTimeout(r, 500));
    if (!window.html2canvas) return alert("캡처 도구를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
  }
  const element = document.getElementById(elementId);
  if (!element) return;
  const originalAnimation = element.style.animation;
  element.style.animation = 'none';
  const calendarEl = element.querySelector('.month-calendar');
  const calBg = calendarEl ? calendarEl.style.background : '';
  const calTransform = calendarEl ? calendarEl.style.transform : '';
  if (calendarEl) { calendarEl.style.transform = 'none'; calendarEl.style.background = isDarkMode ? '#0f172a' : '#eef1f6'; }
  await new Promise(res => setTimeout(res, 50));
  try {
    const canvas = await window.html2canvas(element, { scale: 3, backgroundColor: isDarkMode ? '#0f172a' : '#eef1f6', useCORS: true });
    const timestamp = new Date().toLocaleTimeString('ko-KR', {hour12:false, hour:'2-digit', minute:'2-digit', second:'2-digit'}).replace(/:/g, '');
    const filename = `${filenamePrefix}_${timestamp}.png`;
    const link = document.createElement("a"); link.download = filename; link.href = canvas.toDataURL("image/png"); link.click();
  } catch (e) { alert("캡처에 실패했습니다."); } finally { element.style.animation = originalAnimation; if (calendarEl) { calendarEl.style.background = calBg; calendarEl.style.transform = calTransform; } }
};

function fetchJsonp(params = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const callbackName = `gyobeonJsonp_${Date.now()}_${Math.floor(Math.random() * 10000)}`; const script = document.createElement("script");
    const cleanup = () => { try { delete window[callbackName]; } catch (_) {} if (script.parentNode) script.parentNode.removeChild(script); };
    const timeout = setTimeout(() => { cleanup(); reject(new Error("JSONP 로드 시간 초과")); }, timeoutMs);
    window[callbackName] = (data) => { clearTimeout(timeout); cleanup(); resolve(data); };
    script.onerror = () => { clearTimeout(timeout); cleanup(); reject(new Error("JSONP 로드 실패")); };
    const search = new URLSearchParams({ ...params, callback: callbackName, t: String(Date.now()) }); script.src = `${ADMIN_SCRIPT_URL}?${search.toString()}`; document.body.appendChild(script);
  });
}

function fetchRemoteRosterJsonp(timeoutMs = 6000) { return fetchJsonp({ mode: "roster" }, timeoutMs); }
function fetchSharedConfigJsonp(timeoutMs = 4000) { return fetchJsonp({ mode: "config" }, timeoutMs); }

function openZipDB() { return new Promise((resolve, reject) => { const request = indexedDB.open("gyobeon-app-db", 1); request.onupgradeneeded = function () { const db = request.result; if (!db.objectStoreNames.contains("files")) { db.createObjectStore("files"); } }; request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
async function saveZipBlob(blob, name) { const db = await openZipDB(); return new Promise((resolve, reject) => { const tx = db.transaction("files", "readwrite"); const store = tx.objectStore("files"); store.put({ blob, name, savedAt: Date.now() }, "latestZip"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
async function loadZipBlob() { const db = await openZipDB(); return new Promise((resolve, reject) => { const tx = db.transaction("files", "readonly"); const store = tx.objectStore("files"); const req = store.get("latestZip"); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); }
async function saveParsedData(value) { const db = await openZipDB(); return new Promise((resolve, reject) => { const tx = db.transaction("files", "readwrite"); const store = tx.objectStore("files"); store.put({ data: value, savedAt: Date.now() }, "parsedData"); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); }); }
async function loadParsedData() { const db = await openZipDB(); return new Promise((resolve, reject) => { const tx = db.transaction("files", "readonly"); const store = tx.objectStore("files"); const req = store.get("parsedData"); req.onsuccess = () => resolve(req.result || null); req.onerror = () => reject(req.error); }); }

// 🆕 메모 관련 함수들 (사용자명 + 날짜 + DIA) - 개인 수첩 기능
function getMemoKey(userName, dateStr, diaCode) { return `gyobeon_memo_${String(userName || "").trim()}_${dateStr}_${String(diaCode || "").trim()}`; }
function loadMemo(userName, dateStr, diaCode) { try { return localStorage.getItem(getMemoKey(userName, dateStr, diaCode)) || ""; } catch { return ""; } }
function saveMemo(userName, dateStr, text, diaCode) { try { localStorage.setItem(getMemoKey(userName, dateStr, diaCode), String(text || "").trim()); } catch (_) {} }
function deleteMemo(userName, dateStr, diaCode) { try { localStorage.removeItem(getMemoKey(userName, dateStr, diaCode)); } catch (_) {} }
// 🆕 해당 날짜의 모든 메모 초기화 (수동 호출)
function clearAllMemosForDate(userName, dateStr) { try { const keys = Object.keys(localStorage); keys.forEach(key => { if (key.startsWith(`gyobeon_memo_${String(userName || "").trim()}_${dateStr}_`)) { localStorage.removeItem(key); } }); } catch (_) {} }

function promptAdminPassword() { const value = window.prompt("관리자 비밀번호를 입력하세요"); if (value == null) return null; if (String(value).trim() !== ADMIN_PASSWORD) { alert("비밀번호가 올바르지 않습니다."); return null; } return String(value).trim(); }
function App() {
  const initialSelection = loadMySelection();
  const initialGroups = loadGroups();
  const todayStr = getKoreaToday();
  const cachedShared = loadCachedSharedConfig();
  const cachedRemoteRoster = loadCachedRemoteRoster();
  const cachedRemoteRosterDate = localStorage.getItem(LS_REMOTE_ROSTER_DATE) || "";
  const lastAckRosterSig = localStorage.getItem(LS_LAST_ACK_ROSTER_SIG) || "";

  if (cachedShared?.baseDate) setGlobalBaseDate(cachedShared.baseDate);
  if (cachedRemoteRosterDate) setGlobalRemoteRosterDate(cachedRemoteRosterDate);
  const initialAppliedRemoteRoster = hasAnyRemoteRoster(cachedRemoteRoster) ? cachedRemoteRoster : getEmptyRemoteRoster();

  const [zipName, setZipName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);
  const [remoteRoster, setRemoteRoster] = useState(initialAppliedRemoteRoster);
  const [remoteRosterDate, setRemoteRosterDate] = useState(cachedRemoteRosterDate || "");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [pendingRosterJson, setPendingRosterJson] = useState(null);
  const [showUpdatePopup, setShowUpdatePopup] = useState(false);
  const [lastSeenPublishedAt, setLastSeenPublishedAt] = useState(localStorage.getItem(LS_LAST_SEEN_PUBLISHED_AT) || "");
  const [holidayVersion, setHolidayVersion] = useState(0);
  const [wordtimeVersion, setWorktimeVersion] = useState(0);
  const [activeTab, setActiveTab] = useState("home");
  const activeTabRef = useRef("home");

  const [selectedTeam, setSelectedTeam] = useState(initialSelection?.teamKey || "ks");
  const [viewTeam, setViewTeam] = useState(initialSelection?.teamKey || "ks");
  const [homeDate, setHomeDate] = useState(todayStr);
  const [browseDate, setBrowseDate] = useState(todayStr);
  const [monthDate, setMonthDate] = useState(todayStr);
  const [mySelection, setMySelection] = useState(initialSelection || { teamKey: "ks", name: "", code: "", anchorDate: todayStr });

  const [draftTeam, setDraftTeam] = useState(initialSelection?.teamKey || "ks");
  const [draftName, setDraftName] = useState(String(initialSelection?.name || "").trim());
  const [draftCode, setDraftCode] = useState(String(initialSelection?.code || "").trim());
  const [profileAnchorDate, setProfileAnchorDate] = useState(initialSelection?.anchorDate || todayStr);

  const [teamAnchors, setTeamAnchors] = useState({ ks: { name: "", code: "", anchorDate: todayStr }, my: { name: "", code: "", anchorDate: todayStr }, wb: { name: "", code: "", anchorDate: todayStr }, as: { name: "", code: "", anchorDate: todayStr } });
  const [remoteBaseDate, setRemoteBaseDate] = useState(cachedShared?.baseDate || "");
  const [savingSharedConfig, setSavingSharedConfig] = useState(false);
  const [overrides, setOverrides] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editColor, setEditColor] = useState("");
  const [editAlias, setEditAlias] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [isWorktimeEditOpen, setIsWorktimeEditOpen] = useState(false);
  const [editStartHour, setEditStartHour] = useState("");
  const [editStartMin, setEditStartMin] = useState("");
  const [editEndHour, setEditEndHour] = useState("");
  const [editEndMin, setEditEndMin] = useState("");
  const [pathOpen, setPathOpen] = useState(false);
  const [pathTarget, setPathTarget] = useState(null);
  const [pathImage, setPathImage] = useState("");
  const [pathTeamKey, setPathTeamKey] = useState("");
  const [pathDate, setPathDate] = useState(todayStr);
  const [memoText, setMemoText] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [allowProfileEdit, setAllowProfileEdit] = useState(!initialSelection?.name || !initialSelection?.code);

  const [groups, setGroups] = useState(initialGroups);
  const [currentGroup, setCurrentGroup] = useState(Object.keys(initialGroups)[0] || "");
  const [groupBaseDate, setGroupBaseDate] = useState(todayStr);
  const [groupMonth, setGroupMonth] = useState(getDisplayMonthValue(todayStr));
  const [selectedGroupDate, setSelectedGroupDate] = useState("");
  const [showGroupAdd, setShowGroupAdd] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [groupAddTeam, setGroupAddTeam] = useState("ks");
  const [groupAddName, setGroupAddName] = useState("");

  // 교번변경 시뮬레이션 - 1:1 방식이라 딱 두 사람(A/B)만 지정해요. 실제로 아무것도
  // 저장/변경하지 않고, 지정 기간 동안 서로 교번을 바꾸면 각자 어떤 근무가 되는지 미리 보기만 해요.
  // 실제 변경은 드림스에서 결재해요. 입력값은 앱을 껐다 켜도 유지돼요.
  // 소속은 항상 내 소속(mySelection) 그대로 써요 - 교번변경은 같은 소속 안에서만 이루어지니
  // 따로 고를 필요가 없어요.
  const swapTeam = mySelection?.teamKey || "ks";
  const swapSaved = loadSwapState();
  const [swapNameA, setSwapNameA] = useState(swapSaved?.nameA || "");
  const [swapNameB, setSwapNameB] = useState(swapSaved?.nameB || "");
  const [swapStartDate, setSwapStartDate] = useState(swapSaved?.startDate || todayStr);
  const [swapEndDate, setSwapEndDate] = useState(swapSaved?.endDate || todayStr);
  useEffect(() => {
    saveSwapState({
      nameA: swapNameA, nameB: swapNameB,
      startDate: swapStartDate, endDate: swapEndDate,
    });
  }, [swapNameA, swapNameB, swapStartDate, swapEndDate]);

  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [initialRemoteChecked, setInitialRemoteChecked] = useState(false);
  const [postSetupRemoteCheckNeeded, setPostSetupRemoteCheckNeeded] = useState(false);

  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem(LS_DARK_MODE) === 'true');
  const [swipeOffset, setSwipeOffset] = useState(0);
  const [swipeTransition, setSwipeTransition] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const pathOpenRef = useRef(false);
  const editOpenRef = useRef(false);
  const showGroupAddRef = useRef(false);
  const showSettingsRef = useRef(false);
  const showSearchRef = useRef(false);

  const effectiveData = data;
  const setupSourceData = useMemo(() => { if (!data) return null; if (!allowProfileEdit) return data; return applyRemoteRosterNamesForSetup(data, remoteRoster); }, [data, remoteRoster, allowProfileEdit]);

  const isAdminUser = ADMIN_NAME.includes(mySelection?.name);

  const groupAddCandidates = useMemo(() => {
    const team = effectiveData?.[groupAddTeam];
    if (!team) return [];
    let baseList = [];
    if (hasRemoteRosterForTeam(groupAddTeam, remoteRoster)) {
      baseList = remoteRoster[groupAddTeam].map(r => ({ name: r.name }));
    } else {
      baseList = team.people || [];
    }
    return baseList
      .filter(p => p.name && !shouldHideName(p.name))
      .map(p => {
        const override = overrides[getOverrideKey(groupAddTeam, p.name)] || {};
        return { name: p.name, displayName: override.alias || p.name };
      });
  }, [effectiveData, remoteRoster, groupAddTeam, overrides]);

  // 교번변경 시뮬레이션용 - 교번변경은 내 소속 안에서만 이루어지니, A/B가 같은 소속 후보 목록을 공유해요.
  const swapCandidatesAll = useMemo(() => {
    const team = effectiveData?.[swapTeam];
    if (!team) return [];
    let baseList = [];
    if (hasRemoteRosterForTeam(swapTeam, remoteRoster)) {
      baseList = remoteRoster[swapTeam].map(r => ({ name: r.name }));
    } else {
      baseList = team.people || [];
    }
    return baseList
      .filter(p => p.name && !shouldHideName(p.name))
      .map(p => {
        const override = overrides[getOverrideKey(swapTeam, p.name)] || {};
        return { name: p.name, displayName: override.alias || p.name };
      });
  }, [effectiveData, remoteRoster, swapTeam, overrides]);
  // 상대가 이미 고른 사람은 목록에서 빼서, 같은 사람을 A/B에 동시에 고르는 걸 막아요.
  const swapCandidatesA = useMemo(() => swapCandidatesAll.filter(p => p.name !== swapNameB), [swapCandidatesAll, swapNameB]);
  const swapCandidatesB = useMemo(() => swapCandidatesAll.filter(p => p.name !== swapNameA), [swapCandidatesAll, swapNameA]);

  // 시작~종료 사이 날짜 목록 (최대 31일 - 실수로 너무 긴 기간을 잡아도 안전하게 제한)
  const swapDateRange = useMemo(() => {
    if (!swapStartDate || !swapEndDate) return [];
    const start = parseLocalDate(swapStartDate);
    const end = parseLocalDate(swapEndDate);
    if (!start || !end || end < start) return [];
    const dates = [];
    let cursor = swapStartDate;
    while (cursor <= swapEndDate && dates.length < 31) {
      dates.push(cursor);
      cursor = addDays(cursor, 1);
    }
    return dates;
  }, [swapStartDate, swapEndDate]);

  const touchStartX = useRef(null);
  const touchStartY = useRef(null);
  const isSwipingRef = useRef(false);

  const onTouchStart = (e) => {
    const blockList = '.settings-btn, .quick-btn, .install-btn, select, input, .bottom-tabs, .all-team-tabs, .group-top-bar-v4';
    if (e.target.closest(blockList)) return;
    
    touchStartX.current = e.targetTouches[0].clientX;
    touchStartY.current = e.targetTouches[0].clientY;
    isSwipingRef.current = false;
    if (swipeOffset !== 0) { setSwipeOffset(0); setSwipeTransition("none"); }
  };

  const onTouchMove = (e) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const currentX = e.targetTouches[0].clientX;
    const currentY = e.targetTouches[0].clientY;
    const diffX = currentX - touchStartX.current;
    const diffY = currentY - touchStartY.current;
    
    if (!isSwipingRef.current) {
      if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 10) {
          isSwipingRef.current = true;
      } else if (Math.abs(diffY) > 10) {
          touchStartX.current = null;
          return;
      }
    }
    
    if (isSwipingRef.current) {
        if (e.cancelable) e.preventDefault(); 
        setSwipeOffset(diffX * 0.7); 
    }
  };

  const onTouchEndHandler = () => {
    if (!isSwipingRef.current) { touchStartX.current = null; touchStartY.current = null; return; }
    isSwipingRef.current = false;
    const viewportWidth = window.innerWidth || 400; 
    if (swipeOffset > 40) {
      setSwipeTransition("transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)");
      setSwipeOffset(viewportWidth); 
      setTimeout(() => { changeData(-1); setSwipeTransition("none"); setSwipeOffset(-viewportWidth); setTimeout(() => { setSwipeTransition("transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)"); setSwipeOffset(0); }, 30); }, 200);
    } else if (swipeOffset < -40) {
      setSwipeTransition("transform 0.2s cubic-bezier(0.2, 0.8, 0.2, 1)");
      setSwipeOffset(-viewportWidth); 
      setTimeout(() => { changeData(1); setSwipeTransition("none"); setSwipeOffset(viewportWidth); setTimeout(() => { setSwipeTransition("transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)"); setSwipeOffset(0); }, 30); }, 200);
    } else { setSwipeTransition("transform 0.25s cubic-bezier(0.2, 0.8, 0.2, 1)"); setSwipeOffset(0); }
    touchStartX.current = null; touchStartY.current = null;
  };

  const changeData = (direction) => {
    if (activeTabRef.current === 'home') setHomeDate(prev => addDays(prev, direction));
    else if (activeTabRef.current === 'all' || activeTabRef.current === 'dia') setBrowseDate(prev => addDays(prev, direction));
    else if (activeTabRef.current === 'month') setMonthDate(prev => addMonths(prev, direction));
    else if (activeTabRef.current === 'group') setGroupBaseDate(prev => addDays(prev, direction * 7));
  };

  const swipeStyle = { transform: `translate3d(${swipeOffset}px, 0, 0)`, transition: swipeTransition, willChange: 'transform' };

  useEffect(() => { if (remoteBaseDate) { setGlobalBaseDate(remoteBaseDate); const prevConfig = loadCachedSharedConfig() || {}; saveCachedSharedConfig({ ...prevConfig, baseDate: remoteBaseDate }); } }, [remoteBaseDate]);
  
  useEffect(() => { 
    localStorage.setItem(LS_DARK_MODE, isDarkMode); 
    if (isDarkMode) {
      document.body.classList.add('dark-mode'); 
      document.body.style.backgroundColor = '#0f172a';
      document.documentElement.style.backgroundColor = '#0f172a';
    } else {
      document.body.classList.remove('dark-mode'); 
      document.body.style.backgroundColor = '#eef1f6';
      document.documentElement.style.backgroundColor = '#eef1f6';
    }
  }, [isDarkMode]);
  
  useEffect(() => { if (!window.html2canvas) { const script = document.createElement("script"); script.src = "https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js"; script.id = "html2canvas-script"; document.body.appendChild(script); } }, []);
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  useEffect(() => { cleanupNameOverrides(); setOverrides(loadOverrides()); }, []);
  useEffect(() => { saveMySelection(mySelection); }, [mySelection]);
  useEffect(() => { setProfileAnchorDate(mySelection?.anchorDate || todayStr); }, [mySelection?.anchorDate, todayStr]);
  useEffect(() => { if (!data) return; const migrated = migrateLegacyOverrides(loadOverrides(), data); setOverrides(migrated); }, [data]);
  useEffect(() => { const years = [getYearFromDateStr(homeDate), getYearFromDateStr(browseDate), getYearFromDateStr(monthDate), getYearFromDateStr(groupBaseDate)].filter(Boolean); [...new Set(years)].forEach((year) => { ensureHolidayYear(year, () => setHolidayVersion((v) => v + 1)); }); }, [homeDate, browseDate, monthDate, groupBaseDate]);
  useEffect(() => {
    if (!allowProfileEdit) return;
    const nextTeam = selectedTeam || mySelection?.teamKey || "ks";
    setDraftTeam(nextTeam);
    setDraftName(String(mySelection?.name || "").trim());
    // 기준 날짜를 오늘로 맞추는 화면이니, 오늘 교번도 원래 저장된 기준교번이 아니라
    // 오늘 날짜 기준으로 실제 계산한 값으로 채워요 (startReconfigureProfile과 동일한 방식).
    const team = effectiveData?.[nextTeam];
    const todayCode = team && mySelection?.code ? getMyCodeForDate(team, getKoreaToday(), mySelection) : "";
    setDraftCode(todayCode || String(mySelection?.code || "").trim());
  }, [allowProfileEdit, selectedTeam, mySelection]);
  useEffect(() => { if (!allowProfileEdit) return; const teamKey = draftTeam || "ks"; const currentName = String(draftName || "").trim(); if (!currentName) return; const team = setupSourceData?.[draftTeam] || data?.[draftTeam]; if (!team) return; if (String(draftCode || "").trim()) return; let nextCode = ""; const remoteRow = findRemoteRowByName(teamKey, currentName, remoteRoster); if (remoteRow?.code) { nextCode = normalizeToFixedCode(team, remoteRow.code); } else { const zipPerson = findZipPersonByName(team, currentName); if (zipPerson?.baseCode) { nextCode = normalizeToFixedCode(team, zipPerson.baseCode); } } if (!nextCode) return; setDraftCode(nextCode); }, [ allowProfileEdit, draftTeam, draftName, draftCode, remoteRoster, setupSourceData, data, ]);
  useEffect(() => { const nextMonth = getDisplayMonthValue(groupBaseDate); if (groupMonth !== nextMonth) { setGroupMonth(nextMonth); } }, [groupBaseDate, groupMonth]);
  useEffect(() => { showSearchRef.current = showSearch; }, [showSearch]);

  function syncMySelectionFromRemote(nextRemoteRoster, nextDataOverride = null) {
    const currentTeamKey = mySelection?.teamKey || ""; const currentName = String(mySelection?.name || "").trim(); if (!currentTeamKey || !currentName) return;
    const teamSource = nextDataOverride?.[currentTeamKey] || data?.[currentTeamKey] || effectiveData?.[currentTeamKey]; if (!teamSource) return;
    
    const remoteRow = findRemoteRowByName(currentTeamKey, currentName, nextRemoteRoster); 
    if (!remoteRow?.code) return;
    
    const nextAnchorDate = getResolvedBaseDate(currentTeamKey, teamSource, nextRemoteRoster); 
    const nextCode = normalizeToFixedCode(teamSource, remoteRow.code);
    
    if (mySelection?.code && normalizeToFixedCode(teamSource, mySelection.code) === nextCode) return; // 이미 최신이면 그냥 둠 (동일 값 재설정으로 인한 불필요한 리렌더 방지)

    setMySelection((prev) => ({ ...prev, teamKey: currentTeamKey, name: currentName, code: nextCode, anchorDate: nextAnchorDate || prev.anchorDate || getKoreaToday(), }));
  }

  // 🆕 안전장치 - "업데이트 알림" 팝업을 안 거치는 경우(이미 예전에 수락해서 시그니처가 같은 경우 등)에도,
  // remoteRoster가 바뀔 때마다 조용히 내 기준교번이 최신인지 다시 확인해요. (팝업 없이도 항상 최신 유지)
  useEffect(() => {
    if (!hasAnyRemoteRoster(remoteRoster)) return;
    syncMySelectionFromRemote(remoteRoster);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteRoster, effectiveData]);

  function acceptRemoteRoster(json, options = {}) {
    const { alertMessage = "", nextDataOverride = null, syncMine = true, forceAliasReset = false } = options; const next = normalizeRemoteRosterShape(json); const serverPublishedAt = String(json?.publishedAt || "").trim(); const nextSig = getRemoteRosterSignature(next);
    const prevPublishedAt = localStorage.getItem(LS_LAST_SEEN_PUBLISHED_AT) || "";
    let effectiveDate = String(json?.effectiveDate || json?.date || json?.rosterDate || json?.snapshotDate || json?.currentDate || "").trim(); if (!effectiveDate) effectiveDate = getKoreaToday();
    setRemoteRoster(next); setRemoteRosterDate(effectiveDate); setGlobalRemoteRosterDate(effectiveDate); saveCachedRemoteRoster(next); localStorage.setItem(LS_REMOTE_ROSTER_DATE, effectiveDate); localStorage.setItem(LS_LAST_ACK_ROSTER_SIG, nextSig);
    // 🆕 새 배포가 감지되면(직전에 본 배포 시각과 다르면) 이 기기에 저장된 개인 별명(표시 이름)을 초기화해요.
    // 배포된 실명이 항상 우선이 되도록 하는 안전장치 — 색상·전화번호는 사람을 따라가야 하므로 그대로 둡니다.
    if (forceAliasReset || (serverPublishedAt && prevPublishedAt && serverPublishedAt !== prevPublishedAt)) {
      const currentOverrides = loadOverrides(); let aliasChanged = false;
      Object.keys(currentOverrides).forEach((key) => { const item = currentOverrides[key]; if (item && (item.alias || item.aliasBaseCode)) { delete item.alias; delete item.aliasBaseCode; aliasChanged = true; } });
      if (aliasChanged) { saveOverrides(currentOverrides); setOverrides(currentOverrides); }
    }
    if (serverPublishedAt) { localStorage.setItem(LS_LAST_SEEN_PUBLISHED_AT, serverPublishedAt); setLastSeenPublishedAt(serverPublishedAt); } else { const fallbackSeen = String(Date.now()); localStorage.setItem(LS_LAST_SEEN_PUBLISHED_AT, fallbackSeen); setLastSeenPublishedAt(fallbackSeen); }
    if (syncMine) syncMySelectionFromRemote(next, nextDataOverride);
    setPendingRosterJson(null); setShowUpdatePopup(false); setInitialRemoteChecked(true); if (alertMessage) alert(alertMessage);
  }

  async function parseAndSetZip(fileOrBlob, saveToIdb = true, keepSavedSelection = false, rosterForApply = remoteRoster, showBusy = true) {
    if (showBusy) setLoading(true); setError("");
    try {
      if (saveToIdb) saveZipBlob(fileOrBlob, fileOrBlob.name || "gyobeon-data.zip"); 

      const zip = await JSZip.loadAsync(fileOrBlob);
      const parsedFiles = {};
      const textTasks = [];
      const imageTasks = [];

      zip.forEach((relativePath, entry) => {
        if (entry.dir) return;
        const lower = relativePath.toLowerCase();
        if (lower.endsWith(".txt")) {
          textTasks.push(entry.async("string").then((text) => { parsedFiles[relativePath] = text; }));
        } else if (/\.(png|jpg|jpeg)$/i.test(lower)) {
          imageTasks.push(entry.async("base64").then((base64) => {
            const mime = lower.endsWith(".png") ? "image/png" : "image/jpeg";
            parsedFiles[relativePath] = `data:${mime};base64,${base64}`;
          }));
        }
      });

      await Promise.all(textTasks);
      const textOnlyData = parseZipToData({ ...parsedFiles });
      setData(textOnlyData); 
      if (showBusy) setLoading(false); 

      await Promise.all(imageTasks);
      const fullData = parseZipToData(parsedFiles);

      saveParsedData(fullData); 

      setData(fullData); 

      const nextSetupData = applyRemoteRosterNamesForSetup(fullData, rosterForApply || getEmptyRemoteRoster());
      if (!keepSavedSelection) {
        setAllowProfileEdit(true);
        const defaultTeam = mySelection?.teamKey || selectedTeam || "ks";
        const defaultName = String(mySelection?.name || "").trim() || nextSetupData?.[defaultTeam]?.info?.baseName || nextSetupData?.[defaultTeam]?.people?.[0]?.name || "";
        const autoAnchors = buildAllTeamsAutoAnchorsFromIdentity(effectiveData || fullData, rosterForApply || getEmptyRemoteRoster(), defaultTeam, defaultName, mySelection);
        setTeamAnchors(autoAnchors); setDraftTeam(defaultTeam); setDraftName(""); setDraftCode(""); setSelectedTeam(defaultTeam);
      }
    } catch (e) {
      setError("ZIP 파일을 읽는 중 오류가 발생했습니다.");
      if (showBusy) setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function initAppFast() {
      let parsedSaved = null; let savedZip = null;
      try {
        const shared = loadCachedSharedConfig();
        if (shared?.baseDate) { setGlobalBaseDate(shared.baseDate); setRemoteBaseDate(shared.baseDate); }
        const savedRemoteDate = localStorage.getItem(LS_REMOTE_ROSTER_DATE) || "";
        if (savedRemoteDate) { setGlobalRemoteRosterDate(savedRemoteDate); setRemoteRosterDate(savedRemoteDate); }

        try {
          parsedSaved = await loadParsedData();
          if (!cancelled && parsedSaved?.data) {
            setData(parsedSaved.data);
            setInitialRemoteChecked(false);
            setPostSetupRemoteCheckNeeded(true);
          }
          if (!parsedSaved?.data) {
            savedZip = await loadZipBlob();
            if (!cancelled && savedZip?.blob) {
              setZipName(savedZip.name || "저장된 ZIP");
              await parseAndSetZip(savedZip.blob, false, true, initialAppliedRemoteRoster, false);
            }
          }
        } catch (e) { console.log("로컬 복원 실패", e); }
      } catch (e) {}

      const thisYear = getYearFromDateStr(getKoreaToday());
      const preloadYears = [thisYear - 1, thisYear, thisYear + 1];

      const [, sharedResult, rosterResult] = await Promise.allSettled([
        Promise.all(preloadYears.map((year) =>
          ensureHolidayYear(year, () => { if (!cancelled) setHolidayVersion((v) => v + 1); })
        )),
        fetchSharedConfigJsonp(4000),
        (parsedSaved?.data || savedZip?.blob)
          ? fetchRemoteRosterJsonp(6000)
          : Promise.resolve(null)
      ]);

      if (cancelled) return;

      if (sharedResult.status === 'fulfilled' && sharedResult.value?.baseDate) {
        const shared = sharedResult.value;
        saveCachedSharedConfig(shared);
        setGlobalBaseDate(shared.baseDate);
        setRemoteBaseDate(shared.baseDate);
      }

      if (rosterResult.status === 'fulfilled' && rosterResult.value) {
        const json = rosterResult.value;
        const next = normalizeRemoteRosterShape(json);
        const hasAny = hasAnyRemoteRoster(next);
        const nextSig = getRemoteRosterSignature(next);
        if (hasAny && nextSig !== lastAckRosterSig) {
          setPendingRosterJson(json);
          setShowUpdatePopup(true);
        }
        setInitialRemoteChecked(true);
      }

      if (!cancelled) setRemoteLoading(false);
    }
    initAppFast(); return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkRemoteAfterSetup() {
      if (!postSetupRemoteCheckNeeded || allowProfileEdit || !effectiveData || initialRemoteChecked || showUpdatePopup) return;
      try { setRemoteLoading(true); const json = await fetchRemoteRosterJsonp(6000); if (cancelled) return; const next = normalizeRemoteRosterShape(json); const hasAny = hasAnyRemoteRoster(next); const nextSig = getRemoteRosterSignature(next); const currentAckSig = localStorage.getItem(LS_LAST_ACK_ROSTER_SIG) || ""; if (hasAny && nextSig !== currentAckSig) { setPendingRosterJson(json); setShowUpdatePopup(true); } setInitialRemoteChecked(true); } catch (e) {} finally { if (!cancelled) { setRemoteLoading(false); setPostSetupRemoteCheckNeeded(false); } }
    }
    checkRemoteAfterSetup(); return () => { cancelled = true; };
  }, [postSetupRemoteCheckNeeded, allowProfileEdit, effectiveData, initialRemoteChecked, showUpdatePopup]);

  useEffect(() => { pathOpenRef.current = pathOpen; }, [pathOpen]);
  useEffect(() => { editOpenRef.current = editOpen; }, [editOpen]);
  useEffect(() => { showGroupAddRef.current = showGroupAdd; }, [showGroupAdd]);
  useEffect(() => { showSettingsRef.current = showSettings; }, [showSettings]);
  useEffect(() => { function handler(e) { e.preventDefault(); setDeferredPrompt(e); } window.addEventListener("beforeinstallprompt", handler); return () => window.removeEventListener("beforeinstallprompt", handler); }, []);
  
  useEffect(() => {
    if (!window.history.state || !window.history.state.__gyobeon) window.history.replaceState({ __gyobeon: true, layer: "root" }, "");
    function handlePopState() {
      if (pathOpenRef.current) { setPathOpen(false); return; }
      if (editOpenRef.current) { setEditOpen(false); return; }
      if (showUpdatePopup) { setShowUpdatePopup(false); return; }
      if (showGroupAddRef.current) { setShowGroupAdd(false); return; } 
      if (showSettingsRef.current) { setShowSettings(false); return; } 

      if (showSearchRef.current || searchQuery) {
        setSearchQuery("");
        setShowSearch(false);
        return;
      }

      if (activeTabRef.current !== "home") { setActiveTab("home"); setHomeDate(getKoreaToday()); return; }
      window.history.pushState({ __gyobeon: true, layer: "root" }, "");
    }
    window.addEventListener("popstate", handlePopState); return () => window.removeEventListener("popstate", handlePopState);
  }, [showUpdatePopup, searchQuery]);

  useEffect(() => { if (pathOpen && (!window.history.state || window.history.state.layer !== "path")) window.history.pushState({ __gyobeon: true, layer: "path" }, ""); }, [pathOpen]);
  // 🆕 행로표 열때 메모 로드 (사용자명 + 날짜 + DIA)
  useEffect(() => { if (pathOpen && pathDate && pathTarget?.code && mySelection?.name) { setMemoText(loadMemo(mySelection.name, pathDate, pathTarget.code)); } }, [pathOpen, pathDate, pathTarget?.code, mySelection?.name]);
  useEffect(() => { if (editOpen && (!window.history.state || window.history.state.layer !== "edit")) window.history.pushState({ __gyobeon: true, layer: "edit" }, ""); }, [editOpen]);
  useEffect(() => { if (showUpdatePopup && (!window.history.state || window.history.state.layer !== "update")) window.history.pushState({ __gyobeon: true, layer: "update" }, ""); }, [showUpdatePopup]);
  useEffect(() => { if (showGroupAdd && (!window.history.state || window.history.state.layer !== "groupAdd")) window.history.pushState({ __gyobeon: true, layer: "groupAdd" }, ""); }, [showGroupAdd]);
  useEffect(() => { if (showSettings && (!window.history.state || window.history.state.layer !== "settings")) window.history.pushState({ __gyobeon: true, layer: "settings" }, ""); }, [showSettings]);

  useEffect(() => {
    if (!effectiveData) return;
    if (mySelection?.teamKey && String(mySelection?.name || "").trim()) { const autoAnchors = buildAllTeamsAutoAnchorsFromIdentity(effectiveData, remoteRoster, mySelection.teamKey, mySelection.name, mySelection); setTeamAnchors(autoAnchors); setSelectedTeam(mySelection.teamKey); if (activeTabRef.current === "home") setViewTeam(mySelection.teamKey); return; }
    const nextAnchors = {}; TEAM_ORDER.forEach((teamKey) => { const team = effectiveData[teamKey]; nextAnchors[teamKey] = buildTeamAnchorFromZip(team); }); setTeamAnchors(nextAnchors);
  }, [effectiveData, remoteRoster, mySelection]);

  const currentViewTeam = effectiveData?.[viewTeam] || null;

  const myInfo = useMemo(() => {
    const myTeamKey = mySelection?.teamKey || selectedTeam; const myName = String(mySelection?.name || "").trim(); const team = effectiveData?.[myTeamKey]; if (!team || !myName) return null;
    const override = overrides[getOverrideKey(myTeamKey, myName)] || {};
    if (mySelection?.teamKey === myTeamKey && mySelection?.code) { const code = getMyCodeForDate(team, homeDate, mySelection); return { code, time: pickWorktime(team, code, homeDate), displayName: resolveDisplayName(overrides, myTeamKey, mySelection.code, myName), customColor: override.color }; }
    const remoteRow = findRemoteRowByName(myTeamKey, myName, remoteRoster); if (remoteRow?.code) { const anchorDate = getRemoteAnchorBaseDate(team); const dayOffset = diffDays(anchorDate, homeDate); const code = shiftCodeByDays(team, remoteRow.code, dayOffset); return { code, time: pickWorktime(team, code, homeDate), displayName: resolveDisplayName(overrides, myTeamKey, remoteRow.code, myName), customColor: override.color }; }
    const anchor = buildAnchorForIdentity(myTeamKey, team, remoteRoster, myName, mySelection); if (!anchor?.code) return null;
    const dayOffset = diffDays(anchor.anchorDate || getResolvedBaseDate(myTeamKey, team, remoteRoster), homeDate); const code = shiftCodeByDays(team, anchor.code, dayOffset); return { code, time: pickWorktime(team, code, homeDate), displayName: resolveDisplayName(overrides, myTeamKey, anchor.code, myName), customColor: override.color };
  }, [effectiveData, remoteRoster, homeDate, selectedTeam, mySelection, holidayVersion, wordtimeVersion, overrides]);

  const homePathImage = useMemo(() => {
    if (!effectiveData || !myInfo?.code) return null;
    const targetTeamKey = mySelection?.teamKey || selectedTeam;
    const team = effectiveData[targetTeamKey];
    if (!team) return null;
    const codeStr = String(myInfo.code).trim();
    if (codeStr.startsWith("휴") || codeStr.startsWith("대")) return null;
    return findPathImage(team, homeDate, myInfo.code);
  }, [effectiveData, homeDate, myInfo?.code, mySelection, selectedTeam]);

  const allGrid = useMemo(() => {
    if (!currentViewTeam) return []; 
    let grid = [];
    
    if (hasRemoteRosterForTeam(viewTeam, remoteRoster)) { 
      grid = buildRemoteShiftedGrid(viewTeam, currentViewTeam, remoteRoster, browseDate, overrides); 
    } else {
      let anchorName = ""; 
      let anchorCode = ""; 
      let anchorDate = getResolvedBaseDate(viewTeam, currentViewTeam, remoteRoster);
      const canUseMyAnchorForTeam = mySelection?.teamKey === viewTeam && String(mySelection?.name || "").trim() && mySelection?.code && hasPersonInTeam(currentViewTeam, mySelection.name);
      
      if (canUseMyAnchorForTeam) { 
        anchorName = mySelection.name; 
        anchorCode = normalizeToFixedCode(currentViewTeam, mySelection.code); 
        anchorDate = mySelection.anchorDate || getResolvedBaseDate(viewTeam, currentViewTeam, remoteRoster); 
      } else { 
        const teamAnchor = buildTeamAnchorFromZip(currentViewTeam); 
        anchorName = teamAnchor?.name || ""; 
        anchorCode = normalizeToFixedCode(currentViewTeam, teamAnchor?.code || ""); 
        anchorDate = teamAnchor?.anchorDate || getResolvedBaseDate(viewTeam, currentViewTeam, remoteRoster); 
      }
      
      if (!anchorName || !anchorCode) { 
        grid = buildAssignedGrid(currentViewTeam, "", "", 0, overrides); 
      } else { 
        const dayOffset = diffDays(anchorDate, browseDate); 
        grid = buildAssignedGrid(currentViewTeam, anchorName, anchorCode, dayOffset, overrides); 
      }
    }

    if (mySelection?.teamKey === viewTeam && mySelection?.code && String(mySelection?.name || "").trim() && !hasRemoteRosterForTeam(viewTeam, remoteRoster)) {
      const myCode = normalizeToFixedCode(currentViewTeam, getMyCodeForDate(currentViewTeam, browseDate, mySelection));
      grid = grid.map((cell) => { 
        if (normalizeToFixedCode(currentViewTeam, cell.code) === myCode) {
          const cellKey = getOverrideKey(viewTeam, mySelection.name);
          return { 
            ...cell, 
            name: mySelection.name, 
            displayName: overrides[cellKey]?.alias || mySelection.name,
            customColor: overrides[cellKey]?.color || myInfo?.customColor
          }; 
        }
        return cell; 
      });
    }
    
    return grid.map(item => ({ ...item, teamKey: viewTeam })); 
  }, [currentViewTeam, viewTeam, remoteRoster, overrides, browseDate, mySelection, myInfo]);

  const filteredGrid = useMemo(() => {
    if (!effectiveData) return [];
    if (!searchQuery) return allGrid;

    const q = String(searchQuery || "").trim().toLowerCase();
    const trainNum = parseInt(q);
    
    const isEarlyMorningTrain = !isNaN(trainNum) && ((trainNum >= 2001 && trainNum <= 2090) || (trainNum >= 1001 && trainNum <= 1090));
    const isTodaySpecialTrain = !isNaN(trainNum) && ((trainNum >= 2091 && trainNum <= 2296) || (trainNum >= 1091 && trainNum <= 1296));
    const isTrainSearch = !isNaN(trainNum) && q.length >= 4 && (isEarlyMorningTrain || isTodaySpecialTrain);

    if (isTrainSearch) {
      const yesterdayStr = addDays(browseDate, -1);
      let crossTeamResults = [];

      TEAM_ORDER.forEach(teamKey => {
        const team = effectiveData[teamKey];
        if (!team) return;

        const teamGrid = hasRemoteRosterForTeam(teamKey, remoteRoster)
          ? buildRemoteShiftedGrid(teamKey, team, remoteRoster, browseDate, overrides)
          : buildAssignedGrid(team, teamAnchors[teamKey]?.name, teamAnchors[teamKey]?.code, diffDays(teamAnchors[teamKey]?.anchorDate, browseDate), overrides);

        const yesterdayGrid = hasRemoteRosterForTeam(teamKey, remoteRoster)
          ? buildRemoteShiftedGrid(teamKey, team, remoteRoster, yesterdayStr, overrides)
          : buildAssignedGrid(team, teamAnchors[teamKey]?.name, teamAnchors[teamKey]?.code, diffDays(teamAnchors[teamKey]?.anchorDate, yesterdayStr), overrides);

        if (isEarlyMorningTrain) {
          const matchedYesterday = yesterdayGrid.filter(item => {
            if (!isNightStartCode(teamKey, item.code)) return false;
            const folder = getPathFolder(teamKey, yesterdayStr, item.code);
            const trains = team.trainData?.[folder]?.[normalizeCodeKey(item.code)] || [];
            return trains.some(t => String(t) === q);
          }).map(item => ({ 
            ...item, 
            code: normalizeCodeKey(item.code).replace(/d$/, "") + "~", 
            teamKey, 
            searchOrigin: 'yesterday' 
          }));
          
          if (matchedYesterday.length > 0) {
            crossTeamResults = [...crossTeamResults, ...matchedYesterday];
          } else {
            const matchedTodayBackup = teamGrid.filter(item => {
              if (isNightStartCode(teamKey, item.code)) return false; 
              const folder = getPathFolder(teamKey, browseDate, item.code);
              const trains = team.trainData?.[folder]?.[normalizeCodeKey(item.code)] || [];
              return trains.some(t => String(t) === q);
            }).map(item => ({ ...item, teamKey, searchOrigin: 'today' }));
            crossTeamResults = [...crossTeamResults, ...matchedTodayBackup];
          }
        } 
        else if (isTodaySpecialTrain) {
          const matchedToday = teamGrid.filter(item => {
            const folder = getPathFolder(teamKey, browseDate, item.code);
            const trains = team.trainData?.[folder]?.[normalizeCodeKey(item.code)] || [];
            return trains.some(t => String(t) === q);
          }).map(item => ({ ...item, teamKey, searchOrigin: 'today' }));
          crossTeamResults = [...crossTeamResults, ...matchedToday];
        }
      });

      const uniqueMap = new Map();
      crossTeamResults.forEach(item => {
          const key = `${item.teamKey}-${item.name}-${item.code}-${item.searchOrigin}`;
          if (!uniqueMap.has(key)) uniqueMap.set(key, item);
      });
      return Array.from(uniqueMap.values());

    } else {
      let crossTeamNameResults = [];
      TEAM_ORDER.forEach(teamKey => {
        const team = effectiveData[teamKey];
        if (!team) return;
        const teamGrid = hasRemoteRosterForTeam(teamKey, remoteRoster)
          ? buildRemoteShiftedGrid(teamKey, team, remoteRoster, browseDate, overrides)
          : buildAssignedGrid(team, teamAnchors[teamKey]?.name, teamAnchors[teamKey]?.code, diffDays(teamAnchors[teamKey]?.anchorDate, browseDate), overrides);

        const matched = teamGrid.filter(item => {
          const cellKey = getOverrideKey(teamKey, item.name);
          const displayName = overrides[cellKey]?.alias || item.displayName || item.name;
          return (displayName || "").toLowerCase().includes(q) || (item.code || "").toLowerCase().includes(q);
        }).map(item => ({ 
          ...item, 
          teamKey, 
          searchOrigin: 'today' 
        }));
        crossTeamNameResults = [...crossTeamNameResults, ...matched];
      });
      return crossTeamNameResults;
    }
  }, [allGrid, searchQuery, browseDate, effectiveData, remoteRoster, overrides, teamAnchors]);

  const visibleAllGrid = useMemo(() => { return filteredGrid.filter((item) => item && item.name && !shouldHideName(item.name)); }, [filteredGrid]);

  useEffect(() => {
    if (activeTab === 'all' && searchQuery) {
      if (visibleAllGrid.length === 0) {
        setPathImage("");
        setPathTarget(null);
        return;
      }
      const validResults = visibleAllGrid.filter(item => {
          const nameTxt = String(item.name || "").trim();
          return nameTxt && nameTxt !== "-" && nameTxt !== "공백";
      });
      if (validResults.length > 0) {
        const firstValid = validResults[0];
        const targetTeam = effectiveData[firstValid.teamKey];
        const image = findPathImage(targetTeam, browseDate, firstValid.code);
        if (image && pathImage !== image) {
          setPathTeamKey(firstValid.teamKey);
          setPathTarget(firstValid);
          setPathDate(browseDate);
          setPathImage(image);
        } else if (!image) {
          setPathImage("");
          setPathTarget(null);
        }
      } else {
        setPathImage("");
        setPathTarget(null);
      }
    } else if (!searchQuery && pathImage !== "") {
      setPathImage("");
      setPathTarget(null);
    }
  }, [searchQuery, visibleAllGrid, browseDate, activeTab, effectiveData]);

  const allGridLayout = useMemo(() => { return getAllGridLayout(visibleAllGrid.length || 0); }, [visibleAllGrid.length]);
  const allGridRows = useMemo(() => { return Math.max(1, Math.ceil((visibleAllGrid.length || 1) / allGridLayout.cols)); }, [visibleAllGrid.length, allGridLayout.cols]);

  const diaList = useMemo(() => {
    const team = currentViewTeam; if (!team) return []; let grid = [];
    const canUseMyAnchorForTeam = viewTeam === mySelection?.teamKey && String(mySelection?.name || "").trim() && mySelection?.code && hasPersonInTeam(team, mySelection.name);
    if (hasRemoteRosterForTeam(viewTeam, remoteRoster)) { grid = buildRemoteShiftedGrid(viewTeam, team, remoteRoster, browseDate, overrides); } else if (canUseMyAnchorForTeam) { grid = buildAssignedGrid(team, mySelection.name, normalizeToFixedCode(team, mySelection.code), diffDays(mySelection.anchorDate || getResolvedBaseDate(viewTeam, team, remoteRoster), browseDate), overrides); } else { const teamAnchor = buildTeamAnchorFromZip(currentViewTeam); grid = buildAssignedGrid(team, teamAnchor.name, teamAnchor.code, diffDays(teamAnchor.anchorDate || getResolvedBaseDate(viewTeam, team, remoteRoster), browseDate), overrides); }
    if (viewTeam === mySelection?.teamKey && mySelection?.code && String(mySelection?.name || "").trim() && !hasRemoteRosterForTeam(viewTeam, remoteRoster)) { const myCode = normalizeToFixedCode(currentViewTeam, getMyCodeForDate(currentViewTeam, browseDate, mySelection)); grid = grid.map((cell) => { if (normalizeToFixedCode(currentViewTeam, cell.code) === myCode) return { ...cell, name: mySelection.name, displayName: mySelection.name }; return cell; }); }
    const diaOrder = findDiaOrder(team); return diaOrder.map((code) => { const found = grid.find((item) => normalizeCodeKey(item.code) === normalizeCodeKey(code)); return { code, idx: found?.idx ?? -1, name: found?.name || "-", displayName: found?.displayName || found?.name || "-", teamKey: viewTeam }; });
  }, [currentViewTeam, browseDate, overrides, remoteRoster, viewTeam, mySelection]);

  function findDiaOrder(team) { return team?.diaOrder?.length ? team.diaOrder : getGyobunOrder(team); }

  const monthMatrix = useMemo(() => getMonthMatrix(monthDate), [monthDate]);
  const monthHeaderDate = parseLocalDate(monthDate);
  const weekDates = useMemo(() => getWeekDates(groupBaseDate), [groupBaseDate]);
  const groupMembers = groups[currentGroup] || [];
  const groupMonthOptions = useMemo(() => getMonthOptions(todayStr, 12), [todayStr]);

  useEffect(() => { if (!weekDates.length) return; if (!selectedGroupDate || !weekDates.includes(selectedGroupDate)) setSelectedGroupDate(weekDates[0]); }, [weekDates, selectedGroupDate]);

  function handleGroupMonthChange(nextMonthValue) {
    const today = getKoreaToday(); const todayMonth = getDisplayMonthValue(today); setGroupMonth(nextMonthValue);
    if (nextMonthValue === todayMonth) setGroupBaseDate(today); else setGroupBaseDate(getMonthStartDate(nextMonthValue));
  }

  function switchTab(tabName) {
    const currentTab = activeTabRef.current;
    const today = getKoreaToday();
    const myTeamKey = mySelection?.teamKey || selectedTeam || "ks";
    if (tabName === currentTab) {
      if (tabName === "home") setHomeDate(today);
      else if (tabName === "all" || tabName === "dia") { setBrowseDate(today); setViewTeam(myTeamKey); }
      else if (tabName === "month") setMonthDate(today);
      else if (tabName === "group") { setGroupMonth(getDisplayMonthValue(today)); setGroupBaseDate(today); setSelectedGroupDate(""); }
      return;
    }
    if (tabName === "home") setHomeDate(today);
    else if (tabName === "all" || tabName === "dia") { if (currentTab !== "all" && currentTab !== "dia") { if (currentTab === "home") setBrowseDate(homeDate); else setBrowseDate(today); setViewTeam(myTeamKey); } }
    else if (tabName === "month") setMonthDate(today);
    else if (tabName === "group") { setGroupMonth(getDisplayMonthValue(today)); setGroupBaseDate(today); setSelectedGroupDate(""); }
    setActiveTab(tabName);
    if (tabName === "home") window.history.pushState({ __gyobeon: true, layer: "root" }, "");
    else window.history.pushState({ __gyobeon: true, layer: `tab-${tabName}` }, "");
    setSearchQuery(""); setShowSearch(false);
  }

  async function handleZipUpload(event) { const file = event.target.files?.[0]; if (!file) return; setZipName(file.name); setInitialRemoteChecked(false); await parseAndSetZip(file, true, false, remoteRoster, true); }
  
  async function saveSharedConfig() {
    if (!isAdminUser) return alert("관리자만 저장할 수 있습니다."); 
    const adminKey = promptAdminPassword(); 
    if (!adminKey) return;
    try { 
      setSavingSharedConfig(true); 
      const payload = { action: "saveConfig", adminKey, baseDate: remoteBaseDate, zipBase64: "" }; 
      const res = await fetch(ADMIN_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) }); 
      const json = await res.json(); 
      if (!json?.ok) throw new Error(json?.error || "공용 기준일 저장 실패"); 
      setGlobalBaseDate(remoteBaseDate); 
      saveCachedSharedConfig({ baseDate: remoteBaseDate }); 
      alert("공용 기준일 저장 완료"); 
    } catch (e) { 
      alert(`저장 실패: ${e.message || e}`); 
    } finally { 
      setSavingSharedConfig(false); 
    }
  }

  async function publishRoster() {
    if (!isAdminUser) return alert("관리자만 배포할 수 있습니다."); 
    const adminKey = promptAdminPassword(); 
    if (!adminKey) return;
    try { 
      setSavingSharedConfig(true); 
      const payload = { action: "publishRoster", adminKey, baseDate: remoteBaseDate }; 
      const res = await fetch(ADMIN_SCRIPT_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload) }); 
      const json = await res.json(); 
      if (!json?.ok) throw new Error(json?.error || "배포 실패"); 
      if (json?.baseDate) { 
        setGlobalBaseDate(json.baseDate); 
        setRemoteBaseDate(json.baseDate); 
        saveCachedSharedConfig({ baseDate: json.baseDate }); 
      } 
      localStorage.removeItem(LS_LAST_SEEN_PUBLISHED_AT); 
      localStorage.removeItem(LS_LAST_ACK_ROSTER_SIG); 
      // 🆕 배포 직후, 앱을 재시작하거나 "업데이트 알림" 팝업을 누르지 않아도 이 기기가 바로
      // 최신 상태가 되도록, 방금 배포한 로스터를 즉시 다시 받아와서 그 자리에서 반영해요.
      try {
        const freshRoster = await fetchRemoteRosterJsonp(6000);
        acceptRemoteRoster(freshRoster, { nextDataOverride: data, syncMine: true, forceAliasReset: true });
      } catch (syncErr) {
        console.error("배포 직후 자동 동기화 실패:", syncErr);
      }
      alert(`배포 완료 (${json?.publishedCount || 0}건)`); 
    } catch (e) { 
      alert(`배포 실패: ${e.message || e}`); 
    } finally { 
      setSavingSharedConfig(false); 
    }
  }

  function applyInitialSelection(teamKey, name, code) {
    const cleanName = String(name || "").trim();
    const cleanCode = String(code || "").trim();
    if (!teamKey || !cleanName || !cleanCode) {
        alert("소속, 이름, 교번을 모두 입력해주세요.");
        return;
    }
    const nextAnchorDate = profileAnchorDate || getKoreaToday(); 
    const nextSelection = { teamKey, name: cleanName, code: cleanCode, anchorDate: nextAnchorDate };
    setMySelection(nextSelection); 
    saveMySelection(nextSelection);
    setSelectedTeam(teamKey); 
    setViewTeam(teamKey);
    setAllowProfileEdit(false); 
    const today = getKoreaToday(); 
    setHomeDate(today); 
    setBrowseDate(today); 
    setMonthDate(today); 
    setGroupBaseDate(today); 
    setGroupMonth(getDisplayMonthValue(today)); 
    setSelectedGroupDate("");
    if (effectiveData) { 
        const nextAnchors = buildAllTeamsAutoAnchorsFromIdentity(effectiveData, remoteRoster, teamKey, cleanName, nextSelection); 
        setTeamAnchors(nextAnchors); 
    }
    setInitialRemoteChecked(false); 
    setPostSetupRemoteCheckNeeded(true);
  }

  function startReconfigureProfile() {
    setAllowProfileEdit(true);
    const nextTeam = mySelection?.teamKey || selectedTeam || "ks";
    setSelectedTeam(nextTeam);
    setDraftTeam(nextTeam);
    setDraftName(String(mySelection?.name || "").trim());
    const today = getKoreaToday();
    // "기준 날짜"를 오늘로 미리 채우는 거니까, "오늘 교번"도 원래 저장된 기준교번(예전 값)이 아니라
    // 오늘 날짜 기준으로 실제 계산한 교번으로 미리 채워둬요 - 두 값이 서로 안 맞는 조합으로
    // 보이지 않게(예: 기준날짜는 오늘인데 교번은 반년 전 값인 것처럼 보이는 것 방지).
    const team = effectiveData?.[nextTeam];
    const todayCode = team ? getMyCodeForDate(team, today, mySelection) : "";
    setDraftCode(todayCode || String(mySelection?.code || "").trim());
    setProfileAnchorDate(today);
  }
  function cancelReconfigureProfile() { if (mySelection?.teamKey) { setSelectedTeam(mySelection.teamKey); setViewTeam(mySelection.teamKey); } setProfileAnchorDate(mySelection?.anchorDate || todayStr); setAllowProfileEdit(false); }
  function resetMyProfile() { const today = getKoreaToday(); clearMySelection(); setMySelection({ teamKey: "ks", name: "", code: "", anchorDate: today }); setDraftTeam("ks"); setDraftName(""); setDraftCode(""); setProfileAnchorDate(today); setAllowProfileEdit(true); setSelectedTeam("ks"); setViewTeam("ks"); setInitialRemoteChecked(false); setHomeDate(today); setBrowseDate(today); setMonthDate(today); setGroupBaseDate(today); setGroupMonth(getDisplayMonthValue(today)); setSelectedGroupDate(""); }

  function handleAllCellTap(item) { 
    if (editMode) {
      openEditDialog(item);
    } else {
      const currentTeamKey = item.teamKey || viewTeam;
      const team = effectiveData[currentTeamKey];
      const nameTxt = String(item.name || "").trim();
      if (!nameTxt || nameTxt === "-" || nameTxt === "공백") return;
      const image = findPathImage(team, browseDate, item.code);
      if (searchQuery) {
        if (image) {
          setPathTeamKey(currentTeamKey);
          setPathTarget(item);
          setPathDate(browseDate);
          setPathImage(image);
        } else {
          setPathImage("");
        }
      } else {
        openPathDialog(item, browseDate);
      }
    }
  }

  function openEditDialog(item) {
    setEditingCell(item); const currentTeam = item.teamKey || viewTeam; const key = getOverrideKey(currentTeam, item.name); const current = overrides[key] || {}; 
    setEditColor(current.color || ""); setEditPhone(current.phone || "");
    // 이 자리(baseCode)에서 설정했던 표시 이름이고, 지금도 그 자리 그대로일 때만 불러와요.
    // (다른 자리에서 걸어둔 게 이 사람 이름에 남아있어도, 여긴 안 보여줘요 - 이미 무효화된 거라서)
    const normalizedCode = item.baseCode ? normalizeCodeKey(item.baseCode) : null;
    const aliasValid = current.alias && (!current.aliasBaseCode || current.aliasBaseCode === normalizedCode);
    setEditAlias(aliasValid ? current.alias : "");
    const team = effectiveData?.[currentTeam]; const currentTime = team ? pickWorktime(team, item.code, browseDate) : "----"; const parts = parseTimeValueToParts(currentTime);
    setEditStartHour(parts.sh); setEditStartMin(parts.sm); setEditEndHour(parts.eh); setEditEndMin(parts.em); setIsWorktimeEditOpen(false); setEditOpen(true);
  }
  function closeEditDialog() { if (editOpenRef.current) window.history.back(); else setEditOpen(false); }
  function commitEdit(nextColorValue = editColor, nextAliasValue = editAlias, nextPhoneValue = editPhone) {
    if (!editingCell) return; 
    const currentTeam = editingCell.teamKey || viewTeam; 
    const cleanColor = String(nextColorValue || "").trim(); 
    const cleanAlias = String(nextAliasValue || "").trim(); 
    const cleanPhone = String(nextPhoneValue || "").trim(); 
    const key = getOverrideKey(currentTeam, editingCell.name); 
    const next = { ...overrides };
    if (next[key] && next[key].baseName && !samePersonName(next[key].baseName, editingCell.name)) {
        delete next[key];
    }
    const currentEntry = next[key] || { baseName: editingCell.name };
    if (editingCell.isMonthEdit && editingCell.date) {
        if (!currentEntry.monthShifts) currentEntry.monthShifts = {};
        currentEntry.monthShifts[editingCell.date] = cleanAlias; 
    } else {
        currentEntry.alias = cleanAlias;
        // 표시 이름을 "지금 이 자리에서" 설정했다는 걸 같이 기록해둬요 - 나중에 이 사람이
        // 진짜로 다른 자리로 옮겨가면(관리자가 명단을 바꾸면), 자리가 안 맞으니까 표시 이름이
        // 자동으로 무효화돼서 원래 이름으로 돌아가요.
        currentEntry.aliasBaseCode = editingCell.baseCode ? normalizeCodeKey(editingCell.baseCode) : null;
        currentEntry.color = cleanColor;
        currentEntry.phone = cleanPhone;
    }
    next[key] = currentEntry;
    if (isWorktimeEditOpen) { const built = buildTimeValueFromParts(editStartHour, editStartMin, editEndHour, editEndMin); if (!built) return alert("출퇴근시간 형식을 다시 확인해주세요."); const dayType = guessDayType(browseDate); const allWorktimeOverrides = loadWorktimeOverrides(); const wtKey = getWorktimeOverrideKey(currentTeam, editingCell.code); const wtEntry = { ...(allWorktimeOverrides[wtKey] || {}) }; wtEntry[dayType] = built; allWorktimeOverrides[wtKey] = wtEntry; saveWorktimeOverrides(allWorktimeOverrides); setWorktimeVersion((v) => v + 1); }
    setOverrides(next); saveOverrides(next); setEditOpen(false); setEditingCell(null); setEditColor(""); setEditAlias(""); setEditPhone(""); setIsWorktimeEditOpen(false); setEditStartHour(""); setEditStartMin(""); setEditEndHour(""); setEditEndMin("");
  }

  async function pickContactForEdit() {
    if (!('contacts' in navigator && 'select' in navigator.contacts)) return alert("연락처를 불러오기 위해 지원되는 브라우저(Android Chrome 등)가 필요합니다.");
    try {
      const contacts = await navigator.contacts.select(['name', 'tel'], { multiple: false });
      if (contacts.length > 0) {
        const contact = contacts[0];
        const rawPhone = contact.tel && contact.tel[0] ? contact.tel[0] : "";
        setEditPhone(rawPhone.replace(/[^0-9]/g, ''));
      }
    } catch (e) { console.error(e); }
  }

  function openPathDialog(item, dateStr = todayStr) { 
    if (!effectiveData || !item?.code) return; 
    const nameTxt = String(item.name || "").trim();
    if (!nameTxt || nameTxt === "-" || nameTxt === "공백") return;
    const currentTeamKey = item.teamKey || viewTeam; 
    const team = effectiveData[currentTeamKey]; 
    const image = findPathImage(team, dateStr, item.code); 
    setPathTeamKey(currentTeamKey); 
    setPathTarget(item); 
    setPathDate(dateStr); 
    setPathImage(image || ""); 
    setPathOpen(true); 
  }

  function openPathDialogForTeamAndDate(teamKey, item, dateStr) { 
    const team = effectiveData?.[teamKey]; 
    if (!team || !item?.code) return; 
    const nameTxt = String(item.name || item.displayName || "").trim();
    if (!nameTxt || nameTxt === "-" || nameTxt === "공백") return;
    const image = findPathImage(team, dateStr, item.code); 
    setPathTeamKey(teamKey); 
    setPathTarget(item); 
    setPathDate(dateStr); 
    setPathImage(image || ""); 
    setPathOpen(true); 
  }
  function closePathDialog() { if (pathOpenRef.current) window.history.back(); else setPathOpen(false); }

  function handleGroupSubmit() { 
    const name = newGroupName.trim(); 
    if (!name) return alert("그룹 이름을 입력해주세요."); 
    const next = { ...groups }; 
    if (next[name]) return alert("이미 존재하는 그룹 이름입니다."); 
    next[name] = []; 
    setGroups(next); 
    saveGroups(next); 
    setCurrentGroup(name); 
    setNewGroupName(""); 
  }
  
  function addToGroup() { 
    const typedGroupName = newGroupName.trim(); 
    const targetGroup = currentGroup || typedGroupName; 
    if (!targetGroup) return alert("그룹 이름을 입력하거나 현재 그룹을 선택해주세요."); 
    if (!groupAddTeam || !groupAddName) return alert("소속과 이름을 선택해주세요."); 
    const next = { ...groups }; 
    if (!next[targetGroup]) next[targetGroup] = []; 
    const exists = next[targetGroup].some((item) => item.team === groupAddTeam && samePersonName(item.name, groupAddName)); 
    if (!exists) next[targetGroup].push({ team: groupAddTeam, name: groupAddName }); 
    setGroups(next); 
    saveGroups(next); 
    setCurrentGroup(targetGroup); 
    setGroupAddName(""); 
  }
  
  function removeFromGroup(teamKey, name) { const next = { ...groups }; next[currentGroup] = (next[currentGroup] || []).filter((item) => !(item.team === teamKey && samePersonName(item.name, name))); setGroups(next); saveGroups(next); }
  
  function deleteCurrentGroup() {
    if (!currentGroup) return;
    if (!window.confirm(`정말 '${currentGroup}' 그룹 전체를 삭제하시겠습니까?\n(삭제 후 복구할 수 없습니다)`)) return;
    const next = { ...groups };
    delete next[currentGroup];
    setGroups(next);
    saveGroups(next);
    setCurrentGroup(Object.keys(next)[0] || "");
  }

  function exportSettings() {
    const dataToSave = {
      mySelection: loadMySelection(),
      overrides: loadOverrides(),
      groups: loadGroups(),
      worktimeOverrides: loadWorktimeOverrides(),
      isDarkMode: isDarkMode
    };
    const jsonStr = JSON.stringify(dataToSave, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const today = getKoreaToday().replace(/-/g, "");
    a.download = `gyobeon_backup_${today}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function importSettings(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target.result);
        if (imported.mySelection) {
           saveMySelection(imported.mySelection);
           setMySelection(imported.mySelection);
           setSelectedTeam(imported.mySelection.teamKey || "ks");
           setViewTeam(imported.mySelection.teamKey || "ks");
        }
        if (imported.overrides) {
           saveOverrides(imported.overrides);
           setOverrides(imported.overrides);
        }
        if (imported.groups) {
           saveGroups(imported.groups);
           setGroups(imported.groups);
           setCurrentGroup(Object.keys(imported.groups)[0] || "");
        }
        if (imported.worktimeOverrides) {
           saveWorktimeOverrides(imported.worktimeOverrides);
           setWorktimeVersion(v => v + 1);
        }
        if (imported.isDarkMode !== undefined) {
           setIsDarkMode(imported.isDarkMode);
        }
        alert("설정이 성공적으로 복구되었습니다!");
        if (showSettingsRef.current) window.history.back(); else setShowSettings(false);
      } catch(err) {
        alert("잘못된 백업 파일입니다.");
      }
    };
    reader.readAsText(file);
    e.target.value = null; 
  }

  const handleShareGroupImage = async () => {
    if (!currentGroup || groupMembers.length === 0) return alert("공유할 그룹 인원이 없습니다.");
    if (!window.html2canvas) {
      await new Promise(r => setTimeout(r, 500));
      if (!window.html2canvas) return alert("캡처 도구를 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
    }
    const element = document.getElementById('capture-group-area');
    if (!element) return;
    const originalTransform = element.style.transform;
    const originalOverflow = element.style.overflow;
    element.style.transform = 'none';
    element.style.overflow = 'visible'; 
    const innerDivs = element.querySelectorAll('th > div[style*="translate3d"], td > div[style*="translate3d"]');
    const origTransforms = [];
    innerDivs.forEach((div, i) => {
      origTransforms[i] = div.style.transform;
      div.style.transform = 'none';
    });
    await new Promise(res => setTimeout(res, 50));
    try {
      const canvas = await window.html2canvas(element, { scale: 3, backgroundColor: isDarkMode ? '#1e293b' : '#ffffff', useCORS: true });
      canvas.toBlob(async (blob) => {
        if (!blob) return alert("이미지 생성에 실패했습니다.");
        const d = new Date(); const timestamp = `${d.getHours()}${d.getMinutes()}${d.getSeconds()}`;
        const filename = `${currentGroup}_스케줄_${timestamp}.png`;
        const file = new File([blob], filename, { type: 'image/png' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ title: `${currentGroup} 스케줄`, files: [file] }); } catch (shareErr) { console.log('공유 취소', shareErr); }
        } else {
          const link = document.createElement("a"); link.download = filename; link.href = URL.createObjectURL(blob); link.click();
          alert("기기가 바로 공유를 지원하지 않아 앨범에 사진으로 저장했습니다.");
        }
      });
    } catch (e) { alert("캡처에 실패했습니다."); } finally {
      element.style.transform = originalTransform; element.style.overflow = originalOverflow;
      innerDivs.forEach((div, i) => { div.style.transform = origTransforms[i]; });
    }
  };

  async function handleInstall() { if (!deferredPrompt) return; deferredPrompt.prompt(); await deferredPrompt.userChoice; setDeferredPrompt(null); }
  function applyPendingRosterUpdate() { if (!pendingRosterJson) { setShowUpdatePopup(false); return; } acceptRemoteRoster(pendingRosterJson, { alertMessage: "최신 교번 정보가 반영되었습니다.", nextDataOverride: data, syncMine: true }); }
  function closeUpdatePopup() { setShowUpdatePopup(false); }

  function openMonthShiftEdit(date, currentItem) {
    const name = mySelection?.name;
    if (!name) return;
    setEditingCell({
      code: currentItem?.code || "",
      name: name,
      date: date,
      isMonthEdit: true,
      teamKey: mySelection?.teamKey || selectedTeam
    });
    const key = getOverrideKey(mySelection?.teamKey || selectedTeam, name);
    const current = overrides[key] || {};
    setEditAlias(currentItem?.code || ""); 
    setEditColor(current.color || "");
    setEditPhone(current.phone || "");
    setEditOpen(true);
  }

  const canEnterApp = !!effectiveData && !!mySelection?.teamKey && !!String(mySelection?.name || "").trim() && !!mySelection?.code && !allowProfileEdit;
  return (
    <>
      <div 
        className="container"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEndHandler}
      >
        {!effectiveData ? (
          <div className="card">
            <div className="card-title">기본자료 ZIP 등록</div>
            <input type="file" accept=".zip" className="input" onChange={handleZipUpload} />
            <div className="help-text">처음 한 번만 ZIP 파일을 등록하면 이후에는 자동으로 저장되어 계속 사용할 수 있습니다.</div>
            {zipName && <div className="help-text">현재 파일: {zipName}</div>}
            {error && <div className="help-text" style={{ color: "#dc2626" }}>{error}</div>}
          </div>
        ) : allowProfileEdit ? (
          <div className="card">
            <div className="card-title">초기 설정</div>
            <label className="label">내 소속</label>
            <select className="select" value={draftTeam} onChange={(e) => { const nextTeam = e.target.value; setDraftTeam(nextTeam); setSelectedTeam(nextTeam); setDraftName(""); setDraftCode(""); }}>
              {TEAM_ORDER.map((key) => (<option key={key} value={key}>{TEAM_LABELS[key]}</option>))}
            </select>
            <label className="label" style={{ marginTop: 12 }}>내 이름</label>
            <input className="input" type="text" placeholder="이름 직접 입력" value={draftName} onChange={(e) => { setDraftName(e.target.value); setDraftCode(""); }} />
            <label className="label" style={{ marginTop: 12 }}>오늘 교번</label>
            <select className="select" value={draftCode} onChange={(e) => { setDraftCode(e.target.value); }}>
              <option value="">선택</option>
              {(setupSourceData?.[draftTeam]?.gyobun || DEFAULT_GYOBUN).map((code, idx) => (<option key={`${idx}`} value={code}>{code}</option>))}
            </select>
            <label className="label" style={{ marginTop: 12 }}>기준 날짜</label>
            <input className="input" type="date" value={profileAnchorDate} onChange={(e) => { const nextDate = e.target.value || getKoreaToday(); setProfileAnchorDate(nextDate); }} />
            <div className="modal-actions">
              <button 
                className="modal-btn primary" 
                onClick={() => applyInitialSelection(draftTeam, draftName, draftCode)} 
                disabled={!String(draftName || "").trim() || !String(draftCode || "").trim()}
              >
                시작하기
              </button>
            </div>
          </div>
        ) : (
          <>
            {activeTab === "home" && (
              <>
                <div className="settings-row">
                  {deferredPrompt && <button className="install-btn" onClick={handleInstall}>설치</button>}
                  <button className="settings-btn" onClick={() => setShowSettings(true)}>설정</button>
                </div>
                <div className="date-grid">
                  <div className="date-box">
                    <button className="date-btn" onClick={() => { const d = parseLocalDate(homeDate); d.setFullYear(d.getFullYear() + 1); setHomeDate(formatDate(d)); }}>+</button>
                    <div className="date-value" style={{ position: 'relative' }}>
                      {parseLocalDate(homeDate).getFullYear()}년
                      <input type="date" className="hidden-date-input" value={homeDate} onChange={(e) => setHomeDate(e.target.value)} />
                    </div>
                    <button className="date-btn" onClick={() => { const d = parseLocalDate(homeDate); d.setFullYear(d.getFullYear() - 1); setHomeDate(formatDate(d)); }}>-</button>
                  </div>
                  <div className="date-box">
                    <button className="date-btn" onClick={() => { const d = parseLocalDate(homeDate); d.setMonth(d.getMonth() + 1); setHomeDate(formatDate(d)); }}>+</button>
                    <div className="date-value" style={{ position: 'relative' }}>
                      {parseLocalDate(homeDate).getMonth() + 1}월
                      <input type="date" className="hidden-date-input" value={homeDate} onChange={(e) => setHomeDate(e.target.value)} />
                    </div>
                    <button className="date-btn" onClick={() => { const d = parseLocalDate(homeDate); d.setMonth(d.getMonth() - 1); setHomeDate(formatDate(d)); }}>-</button>
                  </div>
                  <div className="date-box">
                    <button className="date-btn" onClick={() => setHomeDate(addDays(homeDate, 1))}>+</button>
                    <div className="date-value" style={{ position: 'relative' }}>
                      {parseLocalDate(homeDate).getDate()}일
                      <input type="date" className="hidden-date-input" value={homeDate} onChange={(e) => setHomeDate(e.target.value)} />
                    </div>
                    <button className="date-btn" onClick={() => setHomeDate(addDays(homeDate, -1))}>-</button>
                  </div>
                </div>
                <div className="card main-panel" style={swipeStyle}>
                  <div className="center-view">
                    <div className="main-code" style={{ color: getDateBasedColor(homeDate) }}>{myInfo?.code || "-"} {weekdayName(homeDate)}</div>
                    <div className="main-time" style={{ color: getDateBasedColor(homeDate) }}>{myInfo?.time || "----"}</div>
                    <div className="main-subinfo">{TEAM_LABELS[mySelection?.teamKey || selectedTeam] || "-"} / {myInfo?.displayName || mySelection?.name || "-"}</div>
                    {homePathImage && (
                      <div 
                        className="home-path-preview" 
                        onClick={() => {
                          const targetTeamKey = mySelection?.teamKey || selectedTeam;
                          openPathDialogForTeamAndDate(targetTeamKey, { code: myInfo?.code, name: mySelection?.name || "", displayName: myInfo?.displayName || "", idx: -1 }, homeDate);
                        }}
                      >
                        <img src={homePathImage} alt="행로표 미리보기" />
                        <div className="preview-label">🔍 터치해서 크게 보기</div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {(activeTab === "all" || activeTab === "dia") && (
              <div className="tab-page all-page">
                <div className="all-tab-header">
                  <div className={`${activeTab === "all" ? "all-header" : "dia-header"}`} style={{ 
                    display: "grid", 
                    width: "100%", 
                    height: "48px", 
                    alignItems: "center",
                    gridTemplateColumns: activeTab === "all" ? "40px 1fr 40px 40px 40px" : "40px 1fr 40px",
                    background: editMode ? "#ef4444" : "#3b82f6", 
                    borderRadius: "16px", 
                    overflow: "hidden",
                    boxShadow: "0 4px 10px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.25)",
                    transition: "background 0.3s ease"
                  }}>
                    <button className="all-header-btn" style={{ 
                      width: "100%", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", 
                      padding: 0, border: "none", borderRight: "1px solid rgba(255,255,255,0.2)",
                      background: "transparent", fontSize: "20px", fontWeight: "bold", color: "#ffffff" 
                    }} onClick={() => setBrowseDate(addDays(browseDate, -1))}>-</button>
                    
                    <div className="all-header-title" style={{ 
                      width: "100%", height: "48px", display: "flex", alignItems: "center", justifyContent: "center",
                      textAlign: "center", fontSize: "14px", fontWeight: "800", color: "#ffffff", 
                      position: 'relative', borderRight: "1px solid rgba(255,255,255,0.2)"
                    }}>
                      {TEAM_LABELS[viewTeam]} {parseLocalDate(browseDate).getFullYear()}.{parseLocalDate(browseDate).getMonth() + 1}.{parseLocalDate(browseDate).getDate()} {weekdayShort(browseDate)}
                      <input 
                        type="date" 
                        className="hidden-date-input"
                        style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", zIndex: 2 }}
                        value={browseDate} 
                        onChange={(e) => {
                          const nextDate = e.target.value;
                          if(nextDate) setBrowseDate(nextDate);
                        }} 
                      />
                    </div>

                    {activeTab === "all" && (
                      <>
                        <button className="all-header-btn" style={{ 
                          width: "40px", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", 
                          padding: 0, border: "none", borderRight: "1px solid rgba(255,255,255,0.2)", 
                          background: "transparent", fontSize: "16px", color: "#ffffff" 
                        }} onClick={() => {
                          const nextShow = !showSearch;
                          setShowSearch(nextShow);
                          if (nextShow) {
                            window.history.pushState({ __gyobeon: true, layer: "search" }, "");
                          } else {
                            setSearchQuery("");
                          }
                        }}>🔍</button>
                        <button className={`all-edit-btn ${editMode ? "active" : ""}`} style={{ 
                          width: "40px", height: "48px", fontSize: "11.5px", display: "flex", alignItems: "center", justifyContent: "center", 
                          padding: 0, border: "none", borderRight: "1px solid rgba(255,255,255,0.2)", 
                          background: "transparent",
                          color: "#ffffff", fontWeight: "bold" 
                        }} onClick={(e) => { 
                          e.stopPropagation();
                          setEditMode(prev => !prev); 
                        }}>{!editMode && "수정"}</button>
                      </>
                    )}

                    <button className="all-header-btn" style={{ 
                      width: "100%", height: "48px", display: "flex", alignItems: "center", justifyContent: "center", 
                      padding: 0, border: "none", background: "transparent", 
                      fontSize: "20px", fontWeight: "bold", color: "#ffffff" 
                    }} onClick={() => setBrowseDate(addDays(browseDate, 1))}>+</button>
                  </div>
                  {showSearch && activeTab === "all" && (
                    <input className="input" style={{ marginTop: 8 }} placeholder="이름/교번/열번 통합 검색" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                  )}
                </div>
                <div className="all-team-tabs" style={{ marginTop: "12px" }}>
                  {TEAM_ORDER.map((key) => { 
                    const isActive = viewTeam === key; 
                    const isMyTeam = selectedTeam === key; 
                    return (
                      <button key={key} className={`all-team-tab ${isMyTeam ? "my-team" : ""} ${isActive ? "active" : ""}`} style={{ fontSize: "14px" }} onClick={() => setViewTeam(key)}>
                        {TEAM_LABELS[key]}{isActive && <span className="view-dot" />}
                      </button>
                    ); 
                  })}
                </div>
                {activeTab === "all" ? (
                  <>
                    <div className="all-tab-grid-wrap" style={swipeStyle}>
                      <div className={`all-grid-real ${allGridLayout.className}`} style={{ gridTemplateColumns: `repeat(${allGridLayout.cols}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${allGridRows}, minmax(0, 1fr))` }}>
                        {visibleAllGrid.map((item, idx) => {
                          const isMine = item.teamKey === (mySelection?.teamKey || selectedTeam) && (samePersonName(item.name, mySelection?.name));
                          const isToday = browseDate === getKoreaToday();
                          const currentCellKey = getOverrideKey(item.teamKey, item.name);
                          const cellColor = overrides[currentCellKey]?.color || item.customColor || "";
                          const customStyle = cellColor ? { backgroundColor: cellColor, backgroundImage: "none" } : undefined;
                          
                          return (
                            <div key={`${item.teamKey}-${item.name}-${idx}`} className={`all-cell-real ${isMine ? "cell-my" : ""} ${isMine && isToday ? "cell-my-today" : ""}`} style={customStyle} onClick={() => handleAllCellTap(item)}>
                              <div className="all-code">{item.code || "-"}</div>
                              <div className="all-name">
                                  {item.displayName || item.name || "-"}
                                  {searchQuery && (
                                    <div style={{fontSize: '9px', opacity: 0.8, fontWeight: "600"}}>
                                      [{TEAM_LABELS[item.teamKey]}]
                                    </div>
                                  )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                    {searchQuery && pathImage && (
                      <div className="card" style={{ marginTop: 10, padding: 10 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 8, textAlign: 'center', color: isDarkMode ? '#94a3b8' : '#64748b' }}>
                          🔍 {pathTarget?.displayName || pathTarget?.name} ({pathTarget?.code}) 행로표
                        </div>
                        <img src={pathImage} style={{ width: '100%', borderRadius: 16, border: isDarkMode ? '1px solid #334155' : '1px solid #c8d2e3' }} />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="card" style={{ padding: 0, overflow: "hidden", ...swipeStyle, borderRadius: "10px", marginTop: "15px" }}>
                    {diaList.map((item, idx) => {
                      const isMine = viewTeam === (mySelection?.teamKey || selectedTeam) && (samePersonName(item.name, mySelection?.name));
                      const cellKey = getOverrideKey(item.teamKey, item.name);
                      const hasPhone = overrides[cellKey]?.phone;
                      return (
                        <div key={`${idx}`} style={{ display: "flex", alignItems: "center", padding: "14px 20px", borderBottom: idx === diaList.length - 1 ? "none" : (isDarkMode ? "1px solid #334155" : "1px solid #c8d2e3"), background: isMine ? (isDarkMode ? "rgba(56, 189, 248, 0.25)" : "#d9e9ff") : "transparent", borderLeft: isMine ? (isDarkMode ? "4px solid #38bdf8" : "4px solid #3b82f6") : "4px solid transparent", cursor: "pointer" }}>
                          <div onClick={() => {
                            const nameTxt = String(item.name || "").trim();
                            if (nameTxt && nameTxt !== "-" && nameTxt !== "공백") {
                              openPathDialog(item, browseDate);
                            }
                          }} style={{ flex: 1, display: "flex", alignItems: "center", gap: "16px", fontSize: 18 }}>
                            <div style={{ fontWeight: 900, width: 60, color: getDateBasedColor(browseDate) }}>{item.code}</div>
                            <div style={{ fontWeight: 800 }}>{item.displayName || item.name}</div>
                          </div>
                          {hasPhone && (
                            <a href={`tel:${overrides[cellKey].phone}`} style={{ 
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: '40px', height: '40px',
                                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                                color: 'white', borderRadius: '50%', textDecoration: 'none', 
                                boxShadow: '0 4px 8px rgba(16, 185, 129, 0.4)',
                                fontSize: '18px', border: '2px solid white'
                              }}>📞</a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {activeTab === "month" && (
              <div className="tab-page" id="capture-month-area">
                <div className="month-header-bar" style={{ display: 'flex', gap: '8px' }}>
                  <button className="month-nav-btn" style={{ width: '48px', flexShrink: 0 }} onClick={() => setMonthDate(addMonths(monthDate, -1))}>-</button>
                  
                  <div className="month-header-title" style={{ flex: 1, fontSize: "14px", fontWeight: "700", position: 'relative' }}>
                    {monthHeaderDate.getFullYear()}년 {monthHeaderDate.getMonth() + 1}월
                    <input 
                      type="date" 
                      className="hidden-date-input"
                      style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
                      value={monthDate} 
                      onChange={(e) => {
                        const nextDate = e.target.value;
                        if(nextDate) setMonthDate(nextDate);
                      }} 
                    />
                  </div>

                  <button className="month-nav-btn" style={{ width: '48px', flexShrink: 0, background: 'linear-gradient(180deg, #10b981 0%, #059669 100%)', fontSize: '20px' }} onClick={() => captureAndSave('capture-month-area', `월교번`, isDarkMode)}>📷</button>
                  <button className="month-nav-btn" style={{ width: '48px', flexShrink: 0 }} onClick={() => setMonthDate(addMonths(monthDate, 1))}>+</button>
                </div>
                <div className="month-calendar" style={swipeStyle}>
                  <div className="month-weekdays">
                    <div className="sun">일</div><div>월</div><div>화</div><div>수</div><div>목</div><div>금</div><div className="sat">토</div>
                  </div>
                  {monthMatrix.map((row, rowIdx) => (
                    <div className="month-row" key={rowIdx}>
                      {row.map((date) => {
                        const item = mySelection?.name ? getPersonGyobunForDate(effectiveData, remoteRoster, mySelection?.teamKey || selectedTeam, mySelection.name, date, overrides, mySelection) : null;
                        const sameMonth = parseLocalDate(date).getMonth() === monthHeaderDate.getMonth(); 
                        const isSelected = date === getKoreaToday(); 
                        const toneClass = getDateToneClass(date);
                        const targetTeamKey = mySelection?.teamKey || selectedTeam; 
                        const worktime = item?.code ? pickWorktime(effectiveData[targetTeamKey], item.code, date) : ""; 
                        const { startTime, endTime } = splitWorktime(worktime);
                        return (
                          <button key={date} className={`month-cell ${sameMonth ? "" : "other-month"} ${isSelected ? "selected" : ""}`} onClick={() => { 
                            const nameTxt = String(item?.name || "").trim();
                            if (item?.code && nameTxt && nameTxt !== "-" && nameTxt !== "공백") { 
                              openPathDialogForTeamAndDate(targetTeamKey, { code: item.code, name: item.name || mySelection?.name || "", displayName: item.displayName || mySelection?.name || "", idx: -1 }, date); 
                            } else { 
                              setMonthDate(date); 
                            } 
                          }} onContextMenu={(e) => { e.preventDefault(); openMonthShiftEdit(date, item); }}>
                            <div className={`month-cell-inner ${toneClass}`}>
                              <div className={`month-day ${toneClass}`}>{parseLocalDate(date).getDate()}</div>
                              <div className={`month-code-line ${toneClass}`} style={{ cursor: "pointer", borderBottom: "1px dashed #ccc", fontWeight: "900" }} onClick={(e) => { e.stopPropagation(); openMonthShiftEdit(date, item); }}>{item?.code || "-"}</div>
                              <div className="month-time-wrap">
                                <div className={`month-time-line ${toneClass}`}>{startTime || "-"}</div>
                                <div className={`month-time-line ${toneClass}`}>{endTime || ""}</div>
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {activeTab === "group" && (
              <div className="group-page tab-page">
                <div className="group-top-bar-v4">
                  <button className="nav-btn-v4" onClick={() => setGroupBaseDate(addDays(groupBaseDate, -7))}>◀</button>
                  <div className="group-select-wrap">
                    <div className="group-select-display">{groupMonth ? `${parseInt(groupMonth.split('-')[1], 10)}월 ▾` : "월 ▾"}</div>
                    <select className="group-select-overlay" value={groupMonth} onChange={(e) => handleGroupMonthChange(e.target.value)}>
                      {groupMonthOptions.map((item) => (<option key={item.value} value={item.value}>{item.label}</option>))}
                    </select>
                  </div>
                  <div className="group-select-wrap">
                    <div className="group-select-display">{currentGroup ? `${currentGroup} ▾` : "그룹 없음 ▾"}</div>
                    <select className="group-select-overlay" value={currentGroup} onChange={(e) => setCurrentGroup(e.target.value)}>
                      {Object.keys(groups).map((g) => <option key={g} value={g}>{g}</option>)}
                    </select>
                  </div>
                  <div style={{ flex: 1, display: 'flex', gap: '4px', minWidth: 0, height: '100%' }}>
                    <button className="group-add-btn-v4" onClick={() => setShowGroupAdd(true)}>관리</button>
                    <button className="group-add-btn-v4" style={{ background: 'linear-gradient(180deg, #10b981 0%, #059669 100%)', boxShadow: '0 4px 10px rgba(16, 185, 129, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.2)' }} onClick={handleShareGroupImage}>공유</button>
                  </div>
                  <button className="nav-btn-v4" onClick={() => setGroupBaseDate(addDays(groupBaseDate, 7))}>▶</button>
                </div>
                <div className="group-table-wrap" id="capture-group-area">
                  <table className="group-table">
                    <thead>
                      <tr>
                        <th className="sticky-col">이름</th>
                        {weekDates.map((date) => {
                          const isToday = date === getKoreaToday();
                          const isSelectedCol = selectedGroupDate === date; 
                          return (
                            <th key={date} onClick={() => setSelectedGroupDate(date)} className={`${isToday ? "today-col" : ""} ${isSelectedCol ? "active-col" : ""}`} style={{ cursor: "pointer", padding: 0, overflow: 'hidden' }}>
                              <div style={{ ...swipeStyle, padding: '10px 4px 8px 4px', width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                                <div className={`day-name ${isSunday(date) || isHolidayDate(date) ? "sun" : ""} ${isSaturday(date) ? "sat" : ""}`}>{weekdayShort(date)}</div>
                                <div className="day-date">{formatMonthDay(date)}</div>
                              </div>
                            </th>
                          );
                        })}
                      </tr>
                    </thead>
                    <tbody>
                      {groupMembers.length === 0 ? (
                        <tr><td colSpan={8} className="empty-msg">그룹 인원을 추가해주세요.</td></tr>
                      ) : (
                        groupMembers.map((member, idx) => {
                          const memberAnchor = buildAnchorForIdentity(member.team, effectiveData?.[member.team], remoteRoster, member.name, mySelection);
                          const displayMemberName = memberAnchor?.code
                            ? resolveDisplayName(overrides, member.team, memberAnchor.code, member.name)
                            : (overrides[getOverrideKey(member.team, member.name)]?.alias || member.name);
                          return (
                            <tr key={`${idx}`}>
                              <td className="group-name-cell sticky-col">
                                <div className="group-name-cell-inner">
                                  <div className="name-txt" style={{ fontWeight: "800" }}>{displayMemberName}</div>
                                  <div className="team-badge">{TEAM_LABELS[member.team]}</div>
                                  <button className="row-del-btn-text" onClick={() => removeFromGroup(member.team, member.name)}>삭제</button>
                                </div>
                              </td>
                              {weekDates.map((date) => {
                                const item = getPersonGyobunForDate(effectiveData, remoteRoster, member.team, member.name, date, overrides, mySelection);
                                const isSelectedCol = selectedGroupDate === date;
                                return (
                                  <td key={date} onClick={() => { 
                                    const nameTxt = String(member.name || "").trim();
                                    setSelectedGroupDate(date); 
                                    if (item?.code && nameTxt && nameTxt !== "-" && nameTxt !== "공백") { 
                                      openPathDialogForTeamAndDate(member.team, { code: item.code, name: member.name, displayName: displayMemberName, idx: -1 }, date); 
                                    } 
                                  }} className={`${isSelectedCol ? "active-col" : ""}`} style={{ cursor: "pointer", padding: 0, overflow: 'hidden' }}>
                                    <div style={{ ...swipeStyle, padding: '8px 4px', display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', fontWeight: "900" }}>
                                      {item?.code || "-"}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {activeTab === "swap" && (
              <div className="tab-page" style={{ padding: "12px" }}>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "14px", lineHeight: "1.5" }}>
                  두 사람과 기간을 지정하면, 서로 교번을 바꿨을 때 각자 어떤 근무가 되는지 미리 볼 수 있어요.
                  <br />
                  ⚠️ 여기서는 아무것도 실제로 바뀌지 않아요 - 실제 교번변경은 드림스에서 결재해주세요.
                </div>

                <label className="label" style={{ fontSize: "12px", marginBottom: "4px" }}>사람 A</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px", marginBottom: "10px", alignItems: "center" }}>
                  <select className="select" style={{ margin: 0, fontSize: "13px", padding: "7px 8px" }} value={swapNameA} onChange={(e) => setSwapNameA(e.target.value)}>
                    <option value="">이름 선택</option>
                    {swapCandidatesA.map((p) => (<option key={`swapA-${p.name}`} value={p.name}>{p.displayName}</option>))}
                  </select>
                  <button
                    className="modal-btn"
                    style={{ width: "auto", height: "34px", minWidth: "0", padding: "0 10px", margin: 0, fontSize: "12px", color: "#ef4444", borderColor: "#fca5a5", background: "#fef2f2" }}
                    onClick={() => { setSwapNameA(""); setSwapStartDate(todayStr); setSwapEndDate(todayStr); }}
                    disabled={!swapNameA}
                  >
                    삭제
                  </button>
                </div>

                <label className="label" style={{ fontSize: "12px", marginBottom: "4px" }}>사람 B</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "6px", marginBottom: "10px", alignItems: "center" }}>
                  <select className="select" style={{ margin: 0, fontSize: "13px", padding: "7px 8px" }} value={swapNameB} onChange={(e) => setSwapNameB(e.target.value)}>
                    <option value="">이름 선택</option>
                    {swapCandidatesB.map((p) => (<option key={`swapB-${p.name}`} value={p.name}>{p.displayName}</option>))}
                  </select>
                  <button
                    className="modal-btn"
                    style={{ width: "auto", height: "34px", minWidth: "0", padding: "0 10px", margin: 0, fontSize: "12px", color: "#ef4444", borderColor: "#fca5a5", background: "#fef2f2" }}
                    onClick={() => { setSwapNameB(""); setSwapStartDate(todayStr); setSwapEndDate(todayStr); }}
                    disabled={!swapNameB}
                  >
                    삭제
                  </button>
                </div>

                <label className="label" style={{ fontSize: "12px", marginBottom: "4px" }}>기간</label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "14px", alignItems: "center" }}>
                  <input className="input" style={{ fontSize: "13px", padding: "7px 8px" }} type="date" value={swapStartDate} onChange={(e) => setSwapStartDate(e.target.value)} />
                  <input className="input" style={{ fontSize: "13px", padding: "7px 8px" }} type="date" value={swapEndDate} onChange={(e) => setSwapEndDate(e.target.value)} />
                </div>

                {!swapNameA || !swapNameB ? (
                  <div className="empty-msg" style={{ padding: "20px 0" }}>사람 A, B를 모두 선택해주세요.</div>
                ) : swapDateRange.length === 0 ? (
                  <div className="empty-msg" style={{ padding: "20px 0" }}>기간을 올바르게 선택해주세요 (최대 31일).</div>
                ) : (() => {
                  const team = effectiveData?.[swapTeam];
                  const displayA = swapCandidatesA.find((p) => p.name === swapNameA)?.displayName || swapNameA;
                  const displayB = swapCandidatesB.find((p) => p.name === swapNameB)?.displayName || swapNameB;
                  const codesA = swapDateRange.map((date) => getPersonGyobunForDate(effectiveData, remoteRoster, swapTeam, swapNameA, date, overrides, mySelection)?.code || "-");
                  const codesB = swapDateRange.map((date) => getPersonGyobunForDate(effectiveData, remoteRoster, swapTeam, swapNameB, date, overrides, mySelection)?.code || "-");
                  // 교환 기간 바로 전날/다음날 - 실제로는 교환 대상이 아니라 각자 원래 근무 그대로예요.
                  // 교환한 날짜 앞뒤로 무리 없이 이어지는지, 특히 휴양시간이 충분한지 참고하려고 같이 보여줘요.
                  const dayBefore = addDays(swapDateRange[0], -1);
                  const dayAfter = addDays(swapDateRange[swapDateRange.length - 1], 1);
                  const codeBeforeA = getPersonGyobunForDate(effectiveData, remoteRoster, swapTeam, swapNameA, dayBefore, overrides, mySelection)?.code || "-";
                  const codeBeforeB = getPersonGyobunForDate(effectiveData, remoteRoster, swapTeam, swapNameB, dayBefore, overrides, mySelection)?.code || "-";
                  const codeAfterA = getPersonGyobunForDate(effectiveData, remoteRoster, swapTeam, swapNameA, dayAfter, overrides, mySelection)?.code || "-";
                  const codeAfterB = getPersonGyobunForDate(effectiveData, remoteRoster, swapTeam, swapNameB, dayAfter, overrides, mySelection)?.code || "-";

                  // 전날~다음날까지 전체 날짜 목록과, 사람별/변경전후별 전체 교번 목록을 만들어서
                  // 연속된 두 날짜 사이 휴양시간이 12시간 미만인 지점을 찾아요.
                  const allDates = [dayBefore, ...swapDateRange, dayAfter];
                  const beforeCodesA = [codeBeforeA, ...codesA, codeAfterA];
                  const beforeCodesB = [codeBeforeB, ...codesB, codeAfterB];
                  const afterCodesA = [codeBeforeA, ...codesB, codeAfterA]; // 교환 구간만 B의 교번으로
                  const afterCodesB = [codeBeforeB, ...codesA, codeAfterB]; // 교환 구간만 A의 교번으로
                  const violBeforeA = computeRestViolations_(team, allDates, beforeCodesA);
                  const violBeforeB = computeRestViolations_(team, allDates, beforeCodesB);
                  const violAfterA = computeRestViolations_(team, allDates, afterCodesA);
                  const violAfterB = computeRestViolations_(team, allDates, afterCodesB);
                  const anyViolation = [violBeforeA, violBeforeB, violAfterA, violAfterB].some((v) => v.some(Boolean));

                  const COL_W = "36px";
                  // idx: allDates 기준 인덱스 (0=전날, 마지막=다음날) - 그 인덱스로 들어올 때 휴양시간이
                  // 부족하면 셀 위쪽에 빨간 경고 표시를 붙여요.
                  const cellStyle = (base, violated) => (
                    violated ? { ...base, boxShadow: "inset 0 3px 0 0 #ef4444" } : base
                  );
                  const contextTh = (date, label) => (
                    <th key={label} style={{ padding: 0, minWidth: COL_W, width: COL_W, background: "#fff7ed" }}>
                      <div style={{ padding: "5px 1px", textAlign: "center" }}>
                        <div style={{ fontSize: "10px", color: "#c2751b", fontWeight: "800" }}>{label}</div>
                        <div style={{ fontSize: "11px", fontWeight: "700", color: "#c2751b" }}>{formatMonthDay(date)}</div>
                      </div>
                    </th>
                  );
                  const contextTd = (code, violated) => (
                    <td style={cellStyle({ padding: 0, minWidth: COL_W, width: COL_W, background: "#fffaf0" }, violated)}>
                      <div style={{ padding: "5px 1px", textAlign: "center", fontWeight: "700", fontSize: "11px", whiteSpace: "nowrap", color: "#9a5b13" }}>{code}</div>
                    </td>
                  );
                  const rangeTd = (code, violated) => (
                    <td className="active-col" style={cellStyle({ padding: 0, minWidth: COL_W, width: COL_W }, violated)}>
                      <div style={{ padding: "5px 1px", textAlign: "center", fontWeight: "900", fontSize: "11px", whiteSpace: "nowrap" }}>{code}</div>
                    </td>
                  );
                  const renderSnapshotTable = (title, rowACode, rowBCode, violA, violB) => (
                    <div style={{ marginBottom: "18px" }}>
                      <div style={{ fontWeight: "800", fontSize: "14px", marginBottom: "6px" }}>{title}</div>
                      <div className="group-table-wrap" style={{ overflowX: "auto", overflowY: "hidden" }}>
                        <table className="group-table" style={{ tableLayout: "fixed" }}>
                          <thead>
                            <tr>
                              <th className="sticky-col" style={{ minWidth: "48px", width: "48px" }}>이름</th>
                              {contextTh(dayBefore, "전날")}
                              {swapDateRange.map((date) => (
                                <th key={date} style={{ padding: 0, minWidth: COL_W, width: COL_W }}>
                                  <div style={{ padding: "5px 1px", textAlign: "center" }}>
                                    <div style={{ fontSize: "11px", fontWeight: "700" }}>{formatMonthDay(date)}</div>
                                  </div>
                                </th>
                              ))}
                              {contextTh(dayAfter, "다음날")}
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td className="group-name-cell sticky-col" style={{ minWidth: "48px", width: "48px" }}>
                                <div className="group-name-cell-inner"><div className="name-txt" style={{ fontWeight: "800", fontSize: "13px" }}>{displayA}</div></div>
                              </td>
                              {contextTd(rowACode(0), violA[0])}
                              {swapDateRange.map((date, i) => rangeTd(rowACode(i + 1), violA[i + 1]))}
                              {contextTd(rowACode(allDates.length - 1), violA[allDates.length - 1])}
                            </tr>
                            <tr>
                              <td className="group-name-cell sticky-col" style={{ minWidth: "48px", width: "48px" }}>
                                <div className="group-name-cell-inner"><div className="name-txt" style={{ fontWeight: "800", fontSize: "13px" }}>{displayB}</div></div>
                              </td>
                              {contextTd(rowBCode(0), violB[0])}
                              {swapDateRange.map((date, i) => rangeTd(rowBCode(i + 1), violB[i + 1]))}
                              {contextTd(rowBCode(allDates.length - 1), violB[allDates.length - 1])}
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                  return (
                    <>
                      {anyViolation && (
                        <div style={{ background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: "10px", padding: "8px 10px", marginBottom: "12px", fontSize: "12px", color: "#b91c1c", fontWeight: "700" }}>
                          🔴 표시된 날짜는 앞날 퇴근부터 그날 출근까지 휴양시간이 12시간 미만이에요.
                        </div>
                      )}
                      {renderSnapshotTable("변경 전", (i) => beforeCodesA[i], (i) => beforeCodesB[i], violBeforeA, violBeforeB)}
                      {renderSnapshotTable("변경 후 (교환 시뮬레이션)", (i) => afterCodesA[i], (i) => afterCodesB[i], violAfterA, violAfterB)}
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}
      </div>

      {canEnterApp && (
        <div className={`bottom-tabs tabs-6 ${activeTab === "home" ? "home-theme" : activeTab === "all" || activeTab === "dia" ? "all-theme" : activeTab === "month" ? "month-theme" : activeTab === "swap" ? "swap-theme" : "group-theme"}`}>
          <button className={`bottom-tab ${activeTab === "home" ? "active" : ""}`} onClick={() => switchTab("home")}>홈</button>
          <button className={`bottom-tab ${activeTab === "all" ? "active" : ""}`} onClick={() => switchTab("all")}>전체</button>
          <button className={`bottom-tab ${activeTab === "dia" ? "active" : ""}`} onClick={() => switchTab("dia")}>DIA순서</button>
          <button className={`bottom-tab ${activeTab === "month" ? "active" : ""}`} onClick={() => switchTab("month")}>월교번</button>
          <button className={`bottom-tab ${activeTab === "group" ? "active" : ""}`} onClick={() => switchTab("group")}>그룹</button>
          <button className={`bottom-tab ${activeTab === "swap" ? "active" : ""}`} onClick={() => switchTab("swap")}>교번변경</button>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" onClick={() => { if (showSettingsRef.current) window.history.back(); else setShowSettings(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">설정</div>
            <label className="label" style={{ marginTop: 6 }}>화면 테마</label>
            <button className="modal-btn" style={{ width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 16px', marginBottom: 16 }} onClick={() => setIsDarkMode(!isDarkMode)}>
              <span>{isDarkMode ? "🌙 다크 모드 켜짐" : "☀️ 라이트 모드 켜짐"}</span>
              <span style={{ fontSize: '18px' }}>{isDarkMode ? "✅" : "☑️"}</span>
            </button>
            <label className="label">기본자료 ZIP 등록 / 변경</label>
            <input type="file" accept=".zip" className="input" onChange={handleZipUpload} />
            {!allowProfileEdit ? (
              <>
                <label className="label" style={{ marginTop: 14 }}>내 정보</label>
                <div className="notice-box" style={{ marginTop: 8 }}>
                  내 소속: {TEAM_LABELS[mySelection?.teamKey || selectedTeam] || "-"}<br />
                  내 이름: {mySelection?.name || "-"}<br />
                  오늘({todayStr}) 내 교번: {(() => {
                    const teamKey = mySelection?.teamKey || selectedTeam;
                    const team = effectiveData?.[teamKey];
                    return (team ? getMyCodeForDate(team, todayStr, mySelection) : "") || "-";
                  })()}
                </div>
                <div className="modal-actions"><button className="modal-btn" onClick={startReconfigureProfile}>내 정보 다시 설정</button></div>
              </>
            ) : (
              <>
                <label className="label" style={{ marginTop: 12 }}>내 소속</label>
                <select className="select" value={draftTeam} onChange={(e) => { const nextTeam = e.target.value; setDraftTeam(nextTeam); setSelectedTeam(nextTeam); setDraftName(""); setDraftCode(""); }}>
                  {TEAM_ORDER.map((key) => (<option key={key} value={key}>{TEAM_LABELS[key]}</option>))}
                </select>
                <label className="label" style={{ marginTop: 12 }}>내 이름</label>
                <input className="input" type="text" placeholder="이름 직접 입력" value={draftName} onChange={(e) => { setDraftName(e.target.value); setDraftCode(""); }} />
                <label className="label" style={{ marginTop: 12 }}>오늘 교번</label>
                <select className="select" value={draftCode} onChange={(e) => { setDraftCode(e.target.value); }}>
                  <option value="">선택</option>
                  {(setupSourceData?.[draftTeam]?.gyobun || DEFAULT_GYOBUN).map((code, idx) => (<option key={`${idx}`} value={code}>{code}</option>))}
                </select>
                <label className="label" style={{ marginTop: 12 }}>기준 날짜</label>
                <input className="input" type="date" value={profileAnchorDate} onChange={(e) => { const nextDate = e.target.value || getKoreaToday(); setProfileAnchorDate(nextDate); }} />
                <div className="modal-actions">
                  <button className="modal-btn" onClick={cancelReconfigureProfile}>취소</button>
                  <button className="modal-btn primary" onClick={() => applyInitialSelection(draftTeam, draftName, draftCode)}>저장</button>
                </div>
              </>
            )}
            <label className="label" style={{ marginTop: 24 }}>데이터 백업 및 복구</label>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
              <button className="modal-btn" style={{ flex: 1 }} onClick={exportSettings}>📥 백업하기</button>
              <label className="modal-btn" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', margin: 0 }}>
                📤 복구하기
                <input type="file" accept=".json" style={{ display: 'none' }} onChange={importSettings} />
              </label>
            </div>
            {isAdminUser && (
              <div className="card" style={{ marginTop: 14, padding: 12 }}>
                <div className="label" style={{ marginBottom: 10 }}>관리자</div>
                <label className="label">공용 기준일</label>
                <input className="input" type="date" value={remoteBaseDate} onChange={(e) => setRemoteBaseDate(e.target.value)} />
                <div className="modal-actions">
                  <button className="modal-btn" onClick={publishRoster} disabled={savingSharedConfig}>{savingSharedConfig ? "처리중..." : "현재배정 배포"}</button>
                  <button className="modal-btn primary" onClick={saveSharedConfig} disabled={savingSharedConfig}>{savingSharedConfig ? "저장중..." : "공용 기준일 저장"}</button>
                </div>
              </div>
            )}
            <div className="modal-actions">
              <button className="modal-btn" onClick={resetMyProfile}>내 정보 초기화</button>
              <button className="modal-btn primary" onClick={() => { if (showSettingsRef.current) window.history.back(); else setShowSettings(false); }}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {showGroupAdd && (
        <div className="modal-backdrop" onClick={() => { if (showGroupAddRef.current) window.history.back(); else setShowGroupAdd(false); }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">그룹 관리</div>
            <label className="label">1. 새 그룹 만들기</label>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input className="input" style={{ flex: 1 }} value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} placeholder="예: 1조, 낚시모임" />
              <button className="modal-btn primary" style={{ width: 'auto', padding: '0 16px' }} onClick={handleGroupSubmit}>생성</button>
            </div>
            <label className="label">2. 관리할 그룹 선택</label>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '20px' }}>
              <select className="select" style={{ flex: 1, margin: 0 }} value={currentGroup} onChange={(e) => setCurrentGroup(e.target.value)}>
                {Object.keys(groups).length === 0 ? (<option value="">그룹 없음</option>) : (Object.keys(groups).map((g) => <option key={g} value={g}>{g}</option>))}
              </select>
              <button className="modal-btn" style={{ width: 'auto', padding: '14px', margin: 0, color: '#ef4444', borderColor: '#fca5a5', background: '#fef2f2' }} onClick={deleteCurrentGroup} disabled={!currentGroup}>🗑️ 삭제</button>
            </div>
            <label className="label">3. 선택된 그룹에 인원 추가</label>
            <div style={{ gridTemplateColumns: '1fr 1fr', display: 'grid', gap: '8px', marginBottom: '12px' }}>
              <div>
                <select className="select" value={groupAddTeam} onChange={(e) => { setGroupAddTeam(e.target.value); setGroupAddName(""); }}>
                  {TEAM_ORDER.map((key) => (<option key={key} value={key}>{TEAM_LABELS[key]}</option>))}
                </select>
              </div>
              <div>
                <select className="select" value={groupAddName} onChange={(e) => setGroupAddName(e.target.value)}>
                  <option value="">선택</option>
                  {groupAddCandidates.map((person) => (<option key={`${groupAddTeam}-${person.name}`} value={person.name}>{person.displayName}</option>))}
                </select>
              </div>
            </div>
            <button className="modal-btn primary" style={{ width: '100%' }} onClick={addToGroup} disabled={!currentGroup || !groupAddName}>+ 인원 추가</button>
            <div className="modal-actions" style={{ marginTop: '24px' }}>
              <button className="modal-btn" style={{ width: '100%' }} onClick={() => { if (showGroupAddRef.current) window.history.back(); else setShowGroupAdd(false); }}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="modal-backdrop" onClick={closeEditDialog}>
          <div className="modal month-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">{editingCell?.isMonthEdit ? "교번 수정" : "표시 수정"}</div>
            <div className="modal-sub">
              {editingCell?.isMonthEdit ? `${editingCell.date} - ${editingCell.name}` : `${TEAM_LABELS[editingCell?.teamKey || viewTeam]} ${editingCell?.code} ${editingCell?.name}`}
            </div>
            <label className="label" style={{ marginTop: 12 }}>{editingCell?.isMonthEdit ? "수정할 교번" : "표시 이름"}</label>
            <div style={{ fontSize: '13px', color: '#94a3b8', marginBottom: '8px' }}>
              {editingCell?.isMonthEdit ? `현재: ${editingCell.code}` : "이 자리의 진짜 이름이 나중에 바뀌면 자동으로 원래 이름으로 돌아가요"}
            </div>
            <input className="input" value={editAlias} onChange={(e) => setEditAlias(e.target.value)} placeholder={editingCell?.isMonthEdit ? "예: 15d, 대1, 휴1" : "비워두면 원래 이름 사용"} />
            {!editingCell?.isMonthEdit && (
              <>
                <label className="label" style={{ marginTop: 12 }}>전화번호</label>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <input
                    type="tel"
                    className="input"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '11px 12px',
                      borderRadius: '16px',
                      border: '1px solid rgba(203,213,225,0.95)',
                      outline: 'none',
                      fontSize: 'inherit',
                      fontFamily: 'inherit',
                      boxSizing: 'border-box'
                    }}
                    value={editPhone}
                    onChange={(e) => setEditPhone(e.target.value)}
                    placeholder="01012345678"
                  />
                  <button
                    className="modal-btn"
                    style={{ flexShrink: 0, width: '48px', height: '48px', padding: 0 }}
                    onClick={pickContactForEdit}
                  >📂</button>
                </div>
                <label className="label" style={{ marginTop: 12 }}>색상 선택</label>
                <div style={{ marginTop: '8px' }}>
                  <select className="select" value={editColor} onChange={(e) => setEditColor(e.target.value)} style={{ width: '100%', height: '48px' }}>
                    {COLOR_OPTIONS.map((item) => (<option key={item.label} value={item.value}>{item.label}</option>))}
                  </select>
                </div>
                <button className="modal-btn" style={{ width: "100%", marginTop: 12 }} onClick={() => setIsWorktimeEditOpen((prev) => !prev)}>출퇴근시간 수정 {isWorktimeEditOpen ? "▴" : "▾"}</button>
                {isWorktimeEditOpen && (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, marginBottom: 12 }}>
                      <input className="input" inputMode="numeric" value={editStartHour} onChange={(e) => setEditStartHour(clamp2(e.target.value))} style={{ textAlign: "center" }} placeholder="06" />
                      <div style={{ fontWeight: 700 }}>:</div>
                      <input className="input" inputMode="numeric" value={editStartMin} onChange={(e) => setEditStartMin(clamp2(e.target.value))} style={{ textAlign: "center" }} placeholder="33" />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                      <input className="input" inputMode="numeric" value={editEndHour} onChange={(e) => setEditEndHour(clamp2(e.target.value))} style={{ textAlign: "center" }} placeholder="15" />
                      <div style={{ fontWeight: 700 }}>:</div>
                      <input className="input" inputMode="numeric" value={editEndMin} onChange={(e) => setEditEndMin(clamp2(e.target.value))} style={{ textAlign: "center" }} placeholder="54" />
                    </div>
                  </div>
                )}
              </>
            )}
            <div className="modal-actions">
              <button className="modal-btn" onClick={closeEditDialog}>취소</button>
              <button className="modal-btn primary" onClick={() => commitEdit(editColor, editAlias, editPhone)}>적용</button>
            </div>
          </div>
        </div>
      )}

      {pathOpen && (
        <div className="viewer-page">
          <div className="viewer-header">
            <div className="viewer-title">행로표</div>
            <button className="modal-btn primary" onClick={closePathDialog}>닫기</button>
          </div>
          <div className="viewer-body">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, padding: '0 4px' }}>
              <div>
                <div className="viewer-info-line" style={{ fontSize: 18, fontWeight: 700 }}>{TEAM_LABELS[pathTeamKey || viewTeam]} / {pathTarget?.displayName || pathTarget?.name} / {pathTarget?.code}</div>
                <div className="viewer-info-line" style={{ color: "#6b7280", marginTop: 4 }}>{pathDate} {weekdayName(pathDate)}</div>
              </div>
              {overrides[getOverrideKey(pathTeamKey || viewTeam, pathTarget?.name)]?.phone && (
                <a href={`tel:${overrides[getOverrideKey(pathTeamKey || viewTeam, pathTarget?.name)].phone}`} style={{ 
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '10px 18px', 
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', 
                  color: 'white', borderRadius: '25px', textDecoration: 'none', fontWeight: 800, fontSize: 14, 
                  boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.2)'
                }}>📞 전화연결</a>
              )}
            </div>
            {pathImage ? (<img src={pathImage} alt="행로표" className="fullscreen-image" />) : (<div className="empty-box">해당 행로표 이미지를 찾지 못했습니다.</div>)}
            
            {/* 🆕 메모 섹션 - 개인 수첩 (사용자 설정 필수) */}
            {mySelection?.name ? (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8, color: isDarkMode ? '#cbd5e1' : '#334155' }}>
                📝 메모 - {pathTarget?.code || "행로표"}
              </div>
              <textarea
                value={memoText}
                onChange={(e) => setMemoText(e.target.value)}
                placeholder="교대사항, 고장 내용 등을 기록하세요..."
                style={{
                  width: '100%',
                  minHeight: '80px',
                  padding: '10px 12px',
                  borderRadius: '12px',
                  border: isDarkMode ? '1px solid #334155' : '1px solid #c8d2e3',
                  background: isDarkMode ? '#0f172a' : '#ffffff',
                  color: isDarkMode ? '#e2e8f0' : '#1e293b',
                  fontSize: '14px',
                  fontFamily: 'inherit',
                  resize: 'vertical',
                  outline: 'none',
                  boxSizing: 'border-box'
                }}
              />
              <div style={{ display: 'flex', gap: '8px', marginTop: 10 }}>
                <button
                  onClick={() => {
                    saveMemo(mySelection?.name, pathDate, memoText, pathTarget?.code);
                    alert('메모가 저장되었습니다.');
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '14px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 8px rgba(59, 130, 246, 0.2)'
                  }}
                >
                  💾 저장
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('메모를 삭제하시겠습니까?')) {
                      deleteMemo(mySelection?.name, pathDate, pathTarget?.code);
                      setMemoText('');
                      alert('메모가 삭제되었습니다.');
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    background: isDarkMode ? '#ef4444' : '#fca5a5',
                    color: 'white',
                    border: 'none',
                    borderRadius: '12px',
                    fontWeight: 700,
                    fontSize: '14px',
                    cursor: 'pointer',
                    boxShadow: '0 4px 8px rgba(239, 68, 68, 0.2)'
                  }}
                >
                  🗑️ 삭제
                </button>
              </div>
              {/* 🆕 메모 초기화 버튼 - 해당 날짜의 모든 메모 삭제 */}
              <button
                onClick={() => {
                  if (window.confirm(`${pathDate}의 모든 메모를 초기화하시겠습니까?\n(이 작업은 되돌릴 수 없습니다)`)) {
                    clearAllMemosForDate(mySelection?.name, pathDate);
                    setMemoText('');
                    alert('모든 메모가 초기화되었습니다.');
                  }
                }}
                style={{
                  width: '100%',
                  padding: '12px 16px',
                  marginTop: 10,
                  background: isDarkMode ? '#64748b' : '#cbd5e1',
                  color: isDarkMode ? 'white' : '#1e293b',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: 700,
                  fontSize: '14px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 8px rgba(100, 116, 139, 0.2)'
                }}
              >
                🔄 메모 초기화 (모두 삭제)
              </button>
            </div>
            ) : (
              <div style={{ marginTop: 16, padding: '12px', borderRadius: '12px', background: isDarkMode ? '#1e293b' : '#f0f9ff', color: isDarkMode ? '#cbd5e1' : '#0c4a6e', fontSize: '14px', textAlign: 'center', fontWeight: 600 }}>
                ⚠️ 메모를 사용하려면 설정에서 내 정보를 먼저 입력해주세요.
              </div>
            )}
          </div>
        </div>
      )}

      {showUpdatePopup && (
        <div className="modal-backdrop" onClick={closeUpdatePopup}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">업데이트 알림</div>
            <div className="help-text" style={{ marginTop: 8 }}>최신 인원/교번 정보가 있습니다.<br />지금 업데이트하시겠습니까?</div>
            <div className="modal-actions">
              <button className="modal-btn" onClick={closeUpdatePopup}>나중에</button>
              <button className="modal-btn primary" onClick={applyPendingRosterUpdate}>업데이트</button>
            </div>
          </div>
        </div>
      )}
      
      <style>{`
        .bottom-tabs {
          padding-bottom: env(safe-area-inset-bottom, 0px) !important;
        }

        .hidden-date-input {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          opacity: 0;
          cursor: pointer;
          -webkit-appearance: none;
        }
        input[type="date"]::-webkit-calendar-picker-indicator {
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          cursor: pointer;
        }
      `}</style>
    </>
  );
}

function getPersonGyobunForDate(data, remoteRoster, teamKey, name, dateStr, overrides = {}, mySelection = null) {
  if (!data) return null;
  const team = data[teamKey]; if (!team) return null;
  const override = overrides[getOverrideKey(teamKey, name)] || {};
  if (override.monthShifts && override.monthShifts[dateStr]) {
    // 특정 날짜만 수동으로 고쳐둔 값이라 "자리" 개념이 없어요 - 일반 별명만 반영해요.
    return { code: override.monthShifts[dateStr], name, displayName: override.alias || name, teamKey: teamKey };
  }
  const anchor = buildAnchorForIdentity(teamKey, team, remoteRoster, name, mySelection); if (!anchor?.code) return null;
  const dayOffset = diffDays(anchor.anchorDate || getResolvedBaseDate(teamKey, team, remoteRoster), dateStr);
  const code = shiftCodeByDays(team, anchor.code, dayOffset);
  return { code, name, displayName: resolveDisplayName(overrides, teamKey, anchor.code, name), baseCode: anchor.code, teamKey: teamKey };
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
