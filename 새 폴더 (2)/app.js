const { useEffect, useMemo, useRef, useState } = React;

const TEAM_LABELS = {
  ks: "경산",
  my: "문양",
  wb: "월배",
  as: "안심",
};

const TEAM_ORDER = ["ks", "my", "wb", "as"];

const COLOR_OPTIONS = [
  { value: "", label: "기본" },
  { value: "#dbeafe", label: "하늘" },
  { value: "#bbf7d0", label: "연두" },
  { value: "#fde68a", label: "노랑" },
  { value: "#fecaca", label: "분홍" },
  { value: "#e9d5ff", label: "보라" },
  { value: "#e5e7eb", label: "회색" },
];

// fallback 교번 순서
const DEFAULT_GYOBUN = [
  "2d","대3","16d","휴1","휴2","대2","14d","24d","24~","휴3","5d","17d",
  "27d","27~","휴4","3d","13d","23d","23~","휴5","휴6","대1","15d","22d","22~",
  "휴7","9d","10d","28d","28~","휴8","4d","20d","25d","25~","휴9","1d","11d",
  "대4","대4~","휴10","휴11","7d","18d","29d","29~","휴12","8d","12d","26d",
  "26~","휴13","휴14","6d","19d","21d","21~","휴15"
];

function formatDate(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(dateStr, days) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return formatDate(d);
}

function diffDays(a, b) {
  const da = new Date(a);
  const db = new Date(b);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function positiveMod(n, mod) {
  return ((n % mod) + mod) % mod;
}

function weekdayName(dateStr) {
  const names = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];
  return names[new Date(dateStr).getDay()];
}

function isSaturday(dateStr) {
  return new Date(dateStr).getDay() === 6;
}

function isSunday(dateStr) {
  return new Date(dateStr).getDay() === 0;
}

function guessDayType(dateStr) {
  if (isSunday(dateStr)) return "hol";
  if (isSaturday(dateStr)) return "sat";
  return "nor";
}

function parseLines(text) {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseInfo(text) {
  const lines = parseLines(text);
  const [year, month, day, baseCode, baseName, total] = lines;
  return {
    raw: lines,
    baseDate:
      year && month && day
        ? `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        : null,
    baseCode: baseCode || null,
    baseName: baseName || null,
    totalCount: total ? Number(total) : lines.length,
  };
}

function normalizeWorktimeLine(line) {
  return line.replace(/\s+/g, " ").trim().toLowerCase();
}

// worktime 파일은 gyobun.txt와 같은 줄 순서
function parseWorktime(text, gyobunOrder = []) {
  const lines = parseLines(text).map(normalizeWorktimeLine);
  const map = {};

  gyobunOrder.forEach((code, idx) => {
    const key = String(code || "").trim().toLowerCase();
    map[key] = lines[idx] || "----";
  });

  return map;
}

function inferShiftLabel(code) {
  if (!code) return "미정";
  if (code.startsWith("휴")) return "휴무";
  if (code.startsWith("대")) return "대기";
  if (code.endsWith("~")) return "야간종료";
  if (code.endsWith("d")) return "근무";
  return "근무";
}

function normalizeCodeKey(code) {
  return String(code || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function pickWorktime(team, code, dateStr) {
  const kind = guessDayType(dateStr);
  const key = normalizeCodeKey(code);
  const source = team?.worktimes?.[kind] || {};
  return source[key] || "----";
}

function isNightStartCode(code) {
  const s = normalizeCodeKey(code);
  return /^(23|24|25|26|27|28|29)d$/.test(s);
}

function isNightEndCode(code) {
  const s = normalizeCodeKey(code);
  return /^(23|24|25|26|27|28|29)~$/.test(s);
}

function isDayShiftCode(code) {
  const s = normalizeCodeKey(code);
  return /^(1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20)d$/.test(s);
}

function getPathFolder(dateStr, code) {
  const day = new Date(dateStr).getDay(); // 0=일 ~ 6=토

  if (isNightStartCode(code)) {
    if (day >= 1 && day <= 4) return "nor";
    if (day === 5) return "nor_sat";
    if (day === 6) return "sat_hol";
    if (day === 0) return "hol_nor";
  }

  if (isNightEndCode(code)) {
    if (day >= 2 && day <= 5) return "nor";
    if (day === 6) return "nor_sat";
    if (day === 0) return "sat_hol";
    if (day === 1) return "hol_nor";
  }

  if (isDayShiftCode(code)) {
    if (day >= 1 && day <= 5) return "nor";
    if (day === 6) return "sat";
    if (day === 0) return "hol";
  }

  if (day >= 1 && day <= 5) return "nor";
  if (day === 6) return "sat";
  return "hol";
}

function findPathImage(team, dateStr, code) {
  if (!team || !code) return null;

  const folder = getPathFolder(dateStr, code);
  const raw = normalizeCodeKey(code);

  const strippedD = raw.replace(/d$/, "");
  const strippedTilde = raw.replace(/~$/, "");
  const strippedAll = raw.replace(/d$/, "").replace(/~$/, "");

  const candidates = [
    raw,
    strippedD,
    strippedTilde,
    strippedAll,
    `제${strippedAll}`,
    `${raw}.png`,
    `${raw}.jpg`,
    `${raw}.jpeg`,
    `${strippedD}.png`,
    `${strippedD}.jpg`,
    `${strippedD}.jpeg`,
    `${strippedTilde}.png`,
    `${strippedTilde}.jpg`,
    `${strippedTilde}.jpeg`,
    `${strippedAll}.png`,
    `${strippedAll}.jpg`,
    `${strippedAll}.jpeg`,
    `제${strippedAll}.png`,
    `제${strippedAll}.jpg`,
    `제${strippedAll}.jpeg`,
  ];

  const bucket = team?.paths?.[folder];
  if (!bucket) return null;

  for (const key of candidates) {
    if (bucket[key]) return bucket[key];
    if (bucket[key.toLowerCase()]) return bucket[key.toLowerCase()];
  }

  return null;
}

function isSpecialS(value) {
  return value === "s1" || value === "s2";
}

function menuTimeClass(code, time) {
  if (isSpecialS(time)) return "red-text";
  if (code?.startsWith("휴")) return "blue-text";
  return "";
}

// 모든 기준은 gyobun.txt
function getGyobunOrder(team) {
  if (team?.gyobun?.length) return team.gyobun;
  return DEFAULT_GYOBUN;
}

function createTeamBucket(teamKey) {
  return {
    key: teamKey,
    label: TEAM_LABELS[teamKey],
    names: [],
    gyobun: [],
    people: [],
    info: { totalCount: 0, baseDate: null, baseCode: null, baseName: null, raw: [] },
    worktimes: { nor: {}, sat: {}, hol: {} },
    paths: { nor: {}, sat: {}, hol: {}, nor_sat: {}, sat_hol: {}, hol_nor: {} },
  };
}

function parseZipToData(parsedFiles) {
  const result = {};
  TEAM_ORDER.forEach((teamKey) => {
    result[teamKey] = createTeamBucket(teamKey);
  });

  Object.entries(parsedFiles).forEach(([path, content]) => {
    const clean = path.replace(/^\/+/, "");
    const parts = clean.split("/");
    const teamKey = parts.find((p) => TEAM_ORDER.includes(p));
    if (!teamKey) return;

    const team = result[teamKey];
    const fileName = parts[parts.length - 1];

    if (fileName === "name.txt") team.names = parseLines(content);
    if (fileName === "gyobun.txt") team.gyobun = parseLines(content);
    if (fileName === "info.txt") team.info = parseInfo(content);
  });

  TEAM_ORDER.forEach((teamKey) => {
    const team = result[teamKey];
    if (!team.gyobun.length) {
      team.gyobun = DEFAULT_GYOBUN.slice();
    }

    team.people = team.names.map((name, idx) => ({
      name,
      baseCode: team.gyobun[idx] || "",
      idx,
    }));
  });

  Object.entries(parsedFiles).forEach(([path, content]) => {
    const clean = path.replace(/^\/+/, "");
    const parts = clean.split("/");
    const teamKey = parts.find((p) => TEAM_ORDER.includes(p));
    if (!teamKey) return;

    const team = result[teamKey];
    const fileName = parts[parts.length - 1];
    const parent = parts[parts.length - 2];

    const gyobunOrder = team.gyobun.length ? team.gyobun : DEFAULT_GYOBUN;

    if (fileName === "nor_worktime.txt") team.worktimes.nor = parseWorktime(content, gyobunOrder);
    if (fileName === "sat_worktime.txt") team.worktimes.sat = parseWorktime(content, gyobunOrder);
    if (fileName === "hol_worktime.txt") team.worktimes.hol = parseWorktime(content, gyobunOrder);

    if (parts.includes("path") && /\.(png|jpg|jpeg)$/i.test(fileName)) {
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

function loadOverrides() {
  try {
    return JSON.parse(localStorage.getItem("gyobeon_overrides") || "{}");
  } catch {
    return {};
  }
}

function saveOverrides(value) {
  localStorage.setItem("gyobeon_overrides", JSON.stringify(value));
}

function loadTeamAnchors() {
  try {
    return JSON.parse(localStorage.getItem("gyobeon_team_anchors") || "{}");
  } catch {
    return {};
  }
}

function saveTeamAnchors(value) {
  localStorage.setItem("gyobeon_team_anchors", JSON.stringify(value));
}

function getOverrideKey(teamKey, index) {
  return `${teamKey}_${index}`;
}

// 전체화면: 교번칸 고정, 사람만 회전
function buildAssignedGrid(team, anchorName, anchorCode, dayOffset, overrides) {
  if (!team || !team.people?.length) return [];

  const people = team.people;
  const fixedCodes = getGyobunOrder(team);

  const anchorPersonIndex = people.findIndex((p) => p.name === anchorName);
  const anchorCodeIndex = fixedCodes.indexOf(anchorCode);

  if (anchorPersonIndex < 0 || anchorCodeIndex < 0) {
    return fixedCodes.map((slotCode, slotIndex) => {
      const person = people[slotIndex] || { idx: slotIndex, name: "" };
      const override = overrides[getOverrideKey(team.key, person.idx)] || {};
      return {
        idx: person.idx,
        name: person.name,
        displayName: override.name || person.name,
        code: slotCode,
        customColor: override.color || "",
      };
    });
  }

  return fixedCodes.map((slotCode, slotIndex) => {
    const personIndex = positiveMod(
      anchorPersonIndex + (slotIndex - anchorCodeIndex - dayOffset),
      people.length
    );
    const person = people[personIndex];
    const override = overrides[getOverrideKey(team.key, person.idx)] || {};

    return {
      idx: person.idx,
      name: person.name,
      displayName: override.name || person.name,
      code: slotCode,
      customColor: override.color || "",
    };
  });
}

// IndexedDB
function openZipDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("gyobeon-app-db", 1);
    request.onupgradeneeded = function () {
      const db = request.result;
      if (!db.objectStoreNames.contains("files")) {
        db.createObjectStore("files");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveZipBlob(blob, name) {
  const db = await openZipDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readwrite");
    const store = tx.objectStore("files");
    store.put({ blob, name, savedAt: Date.now() }, "latestZip");
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadZipBlob() {
  const db = await openZipDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("files", "readonly");
    const store = tx.objectStore("files");
    const req = store.get("latestZip");
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function App() {
  const [zipName, setZipName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [data, setData] = useState(null);

  const [selectedTeam, setSelectedTeam] = useState("ks");
  const [viewTeam, setViewTeam] = useState("ks");
  const [selectedDate, setSelectedDate] = useState(formatDate(new Date()));
  const [teamAnchors, setTeamAnchors] = useState({
    ks: { name: "", code: "", anchorDate: formatDate(new Date()) },
    my: { name: "", code: "", anchorDate: formatDate(new Date()) },
    wb: { name: "", code: "", anchorDate: formatDate(new Date()) },
    as: { name: "", code: "", anchorDate: formatDate(new Date()) },
  });
  const [overrides, setOverrides] = useState({});
  const [showAll, setShowAll] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editingCell, setEditingCell] = useState(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const [pathOpen, setPathOpen] = useState(false);
  const [pathTarget, setPathTarget] = useState(null);
  const [pathImage, setPathImage] = useState("");

  const [deferredPrompt, setDeferredPrompt] = useState(null);

  const longPressRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  useEffect(() => {
    setOverrides(loadOverrides());
    const savedAnchors = loadTeamAnchors();
    if (savedAnchors && Object.keys(savedAnchors).length) {
      setTeamAnchors((prev) => ({ ...prev, ...savedAnchors }));
    }

    async function tryAutoLoad() {
      try {
        const saved = await loadZipBlob();
        if (saved?.blob) {
          setZipName(saved.name || "이전 ZIP");
          await parseAndSetZip(saved.blob, false);
        }
      } catch (e) {
        console.log("자동 ZIP 로드 실패", e);
      }
    }

    tryAutoLoad();
  }, []);

  useEffect(() => {
    saveTeamAnchors(teamAnchors);
  }, [teamAnchors]);

  useEffect(() => {
    function handler(e) {
      e.preventDefault();
      setDeferredPrompt(e);
    }
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const currentTeam = data?.[selectedTeam] || null;
  const currentViewTeam = data?.[viewTeam] || null;
  const currentAnchor =
    teamAnchors[selectedTeam] || { name: "", code: "", anchorDate: selectedDate };
  const currentViewAnchor =
    teamAnchors[viewTeam] || { name: "", code: "", anchorDate: selectedDate };

  const currentDayOffset = useMemo(() => {
    return diffDays(currentAnchor.anchorDate || selectedDate, selectedDate);
  }, [currentAnchor.anchorDate, selectedDate]);

  const currentViewDayOffset = useMemo(() => {
    return diffDays(currentViewAnchor.anchorDate || selectedDate, selectedDate);
  }, [currentViewAnchor.anchorDate, selectedDate]);

  useEffect(() => {
    if (!data) return;

    setTeamAnchors((prev) => {
      const next = { ...prev };
      let changed = false;

      TEAM_ORDER.forEach((teamKey) => {
        const team = data[teamKey];
        if (!team) return;
        const prevAnchor = next[teamKey] || {};
        if (!prevAnchor.name || !prevAnchor.code) {
          next[teamKey] = {
            name: prevAnchor.name || team.info.baseName || team.people[0]?.name || "",
            code: prevAnchor.code || team.info.baseCode || getGyobunOrder(team)[0] || "",
            anchorDate: prevAnchor.anchorDate || formatDate(new Date()),
          };
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [data]);

  // 핵심: 첫 화면도 전체화면 계산 결과에서 내 이름 칸을 찾아서 사용
  const myInfo = useMemo(() => {
    if (!currentTeam || !currentAnchor.name || !currentAnchor.code) return null;

    const assignedGrid = buildAssignedGrid(
      currentTeam,
      currentAnchor.name,
      currentAnchor.code,
      currentDayOffset,
      overrides
    );

    const me = assignedGrid.find((item) => item.name === currentAnchor.name);
    if (!me) return null;

    return {
      code: me.code,
      shiftLabel: inferShiftLabel(me.code),
      time: pickWorktime(currentTeam, me.code, selectedDate),
      pathImage: findPathImage(currentTeam, selectedDate, me.code),
    };
  }, [
    currentTeam,
    currentAnchor.name,
    currentAnchor.code,
    currentDayOffset,
    selectedDate,
    overrides,
  ]);

  const grid = useMemo(() => {
    if (!currentViewTeam || !currentViewAnchor.name || !currentViewAnchor.code) return [];
    return buildAssignedGrid(
      currentViewTeam,
      currentViewAnchor.name,
      currentViewAnchor.code,
      currentViewDayOffset,
      overrides
    );
  }, [
    currentViewTeam,
    currentViewAnchor.name,
    currentViewAnchor.code,
    currentViewDayOffset,
    overrides,
  ]);

  async function parseAndSetZip(fileOrBlob, saveToIdb = true) {
    setLoading(true);
    setError("");

    try {
      if (saveToIdb) {
        await saveZipBlob(fileOrBlob, fileOrBlob.name || "gyobeon-data.zip");
      }

      const zip = await JSZip.loadAsync(fileOrBlob);
      const parsedFiles = {};
      const tasks = [];

      zip.forEach((relativePath, entry) => {
        if (entry.dir) return;
        const lower = relativePath.toLowerCase();

        if (lower.endsWith(".txt")) {
          tasks.push(
            entry.async("string").then((text) => {
              parsedFiles[relativePath] = text;
            })
          );
        } else if (/\.(png|jpg|jpeg)$/i.test(lower)) {
          tasks.push(
            entry.async("base64").then((base64) => {
              const mime = lower.endsWith(".png") ? "image/png" : "image/jpeg";
              parsedFiles[relativePath] = `data:${mime};base64,${base64}`;
            })
          );
        }
      });

      await Promise.all(tasks);

      const nextData = parseZipToData(parsedFiles);
      const today = formatDate(new Date());

      setData(nextData);
      setSelectedTeam("ks");
      setViewTeam("ks");
      setSelectedDate(today);

      const nextAnchors = {
        ks: {
          name: nextData.ks?.info?.baseName || nextData.ks?.people?.[0]?.name || "",
          code: nextData.ks?.info?.baseCode || getGyobunOrder(nextData.ks)[0] || "",
          anchorDate: today,
        },
        my: {
          name: nextData.my?.info?.baseName || nextData.my?.people?.[0]?.name || "",
          code: nextData.my?.info?.baseCode || getGyobunOrder(nextData.my)[0] || "",
          anchorDate: today,
        },
        wb: {
          name: nextData.wb?.info?.baseName || nextData.wb?.people?.[0]?.name || "",
          code: nextData.wb?.info?.baseCode || getGyobunOrder(nextData.wb)[0] || "",
          anchorDate: today,
        },
        as: {
          name: nextData.as?.info?.baseName || nextData.as?.people?.[0]?.name || "",
          code: nextData.as?.info?.baseCode || getGyobunOrder(nextData.as)[0] || "",
          anchorDate: today,
        },
      };

      setTeamAnchors(nextAnchors);
      setShowSettings(false);
    } catch (e) {
      console.error(e);
      setError("ZIP 파일을 읽는 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  async function handleZipUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setZipName(file.name);
    await parseAndSetZip(file, true);
  }

  function updateCurrentTeamAnchor(field, value) {
    setTeamAnchors((prev) => ({
      ...prev,
      [selectedTeam]: {
        ...prev[selectedTeam],
        [field]: value,
      },
    }));
  }

  function openEditDialog(item) {
    setEditingCell(item);
    const key = getOverrideKey(viewTeam, item.idx);
    const current = overrides[key] || {};
    setEditName(current.name || item.displayName || item.name || "");
    setEditColor(current.color || "");
    setEditOpen(true);
  }

  function commitEdit(nextColorValue = editColor) {
    if (!editingCell) return;

    const key = getOverrideKey(viewTeam, editingCell.idx);
    const next = { ...overrides };

    if (!editName.trim() && !nextColorValue) {
      delete next[key];
    } else {
      next[key] = {
        name: editName.trim(),
        color: nextColorValue,
      };
    }

    setOverrides(next);
    saveOverrides(next);
    setEditOpen(false);
  }

  function openPathDialog(item) {
    if (!currentViewTeam) return;
    const image = findPathImage(currentViewTeam, selectedDate, item.code);
    setPathTarget(item);
    setPathImage(image || "");
    setPathOpen(true);
  }

  function startLongPress(item) {
    clearTimeout(longPressRef.current);
    longPressTriggeredRef.current = false;
    longPressRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      openEditDialog(item);
    }, 550);
  }

  function cancelLongPress() {
    clearTimeout(longPressRef.current);
  }

  function handleCellClick(item) {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    openPathDialog(item);
  }

  function resetOverrides() {
    setOverrides({});
    saveOverrides({});
  }

  async function handleInstall() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
  }

  return (
    <>
      <div className="topbar">GB_2601</div>

      <div className="container">
        {!data ? (
          <div className="card">
            <div className="card-title">데이터 불러오기</div>
            <input type="file" accept=".zip" className="input" onChange={handleZipUpload} />
            <div className="help-text">ZIP 파일을 선택하면 압축 내부 데이터를 그대로 읽어서 적용합니다.</div>
            <div className="notice-box">
              처음 한 번 ZIP을 선택하면 이후에는 휴대폰에서 다시 열 때 자동으로 불러옵니다.
            </div>
            {loading && <div className="help-text" style={{ color: "#2563eb" }}>불러오는 중...</div>}
            {zipName && <div className="help-text">현재 파일: {zipName}</div>}
            {error && <div className="help-text" style={{ color: "#dc2626" }}>{error}</div>}
          </div>
        ) : (
          <>
            <div className="settings-row">
              {deferredPrompt && <button className="install-btn" onClick={handleInstall}>설치</button>}
              <button className="settings-btn" onClick={() => setShowSettings(true)}>설정</button>
            </div>

            <div className="date-grid">
              <div className="date-box">
                <button
                  className="date-btn"
                  onClick={() => {
                    const d = new Date(selectedDate);
                    d.setFullYear(d.getFullYear() + 1);
                    setSelectedDate(formatDate(d));
                  }}
                >
                  +
                </button>
                <div className="date-value">{new Date(selectedDate).getFullYear()}년</div>
                <button
                  className="date-btn"
                  onClick={() => {
                    const d = new Date(selectedDate);
                    d.setFullYear(d.getFullYear() - 1);
                    setSelectedDate(formatDate(d));
                  }}
                >
                  -
                </button>
              </div>

              <div className="date-box">
                <button
                  className="date-btn"
                  onClick={() => {
                    const d = new Date(selectedDate);
                    d.setMonth(d.getMonth() + 1);
                    setSelectedDate(formatDate(d));
                  }}
                >
                  +
                </button>
                <div className="date-value">{new Date(selectedDate).getMonth() + 1}월</div>
                <button
                  className="date-btn"
                  onClick={() => {
                    const d = new Date(selectedDate);
                    d.setMonth(d.getMonth() - 1);
                    setSelectedDate(formatDate(d));
                  }}
                >
                  -
                </button>
              </div>

              <div className="date-box">
                <button className="date-btn" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>+</button>
                <div className="date-value">{new Date(selectedDate).getDate()}일</div>
                <button className="date-btn" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>-</button>
              </div>
            </div>

            <div className="card main-panel">
              <div className="center-view">
                <div
                  className={
                    "main-code " +
                    (isSpecialS(myInfo?.time)
                      ? "red-text"
                      : myInfo?.code?.startsWith("휴")
                      ? "blue-text"
                      : "")
                  }
                >
                  {myInfo?.code || "-"} {weekdayName(selectedDate)}
                </div>

                <div className={`main-time ${menuTimeClass(myInfo?.code, myInfo?.time)}`}>
                  {myInfo?.time || "----"}
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {data && (
        <div className="bottom-tabs">
          <button className="bottom-tab" onClick={() => setShowAll(true)}>전체</button>
        </div>
      )}

      {showSettings && (
        <div className="modal-backdrop" onClick={() => setShowSettings(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">설정</div>

            <label className="label">데이터 ZIP 다시 불러오기</label>
            <input type="file" accept=".zip" className="input" onChange={handleZipUpload} />

            <label className="label" style={{ marginTop: 12 }}>현재 메인 소속</label>
            <select
              className="select"
              value={selectedTeam}
              onChange={(e) => {
                setSelectedTeam(e.target.value);
                setViewTeam(e.target.value);
              }}
            >
              {TEAM_ORDER.map((key) => (
                <option key={key} value={key}>{TEAM_LABELS[key]}</option>
              ))}
            </select>

            <label className="label" style={{ marginTop: 12 }}>이 소속 기준 사람</label>
            <select
              className="select"
              value={currentAnchor.name || ""}
              onChange={(e) => {
                updateCurrentTeamAnchor("name", e.target.value);
                updateCurrentTeamAnchor("anchorDate", selectedDate);
              }}
            >
              {(currentTeam?.people || []).map((person) => (
                <option key={`${person.idx}-${person.name}`} value={person.name}>
                  {person.name}
                </option>
              ))}
            </select>

            <label className="label" style={{ marginTop: 12 }}>이 날짜의 해당 사람 교번</label>
            <select
              className="select"
              value={currentAnchor.code || ""}
              onChange={(e) => {
                updateCurrentTeamAnchor("code", e.target.value);
                updateCurrentTeamAnchor("anchorDate", selectedDate);
              }}
            >
              {getGyobunOrder(currentTeam).map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
            </select>

            <div className="help-text">
              현재 보고 있는 날짜를 기준으로 이 소속의 기준 사람/교번을 저장합니다. 각 소속은 서로 독립적으로 유지됩니다.
            </div>

            <div className="modal-actions">
              <button className="modal-btn" onClick={resetOverrides}>수정값 초기화</button>
              <button className="modal-btn primary" onClick={() => setShowSettings(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {showAll && (
        <div className="fullscreen-viewer">
          <button className="close-all-btn" onClick={() => setShowAll(false)}>닫기</button>

          <div className="all-header">
            <button className="all-header-btn" onClick={() => setSelectedDate(addDays(selectedDate, -1))}>-</button>
            <div className="all-header-title">
              {TEAM_LABELS[viewTeam]} {new Date(selectedDate).getFullYear()}.
              {new Date(selectedDate).getMonth() + 1}.
              {new Date(selectedDate).getDate()} {weekdayName(selectedDate)}
            </div>
            <button className="all-header-btn" onClick={() => setSelectedDate(addDays(selectedDate, 1))}>+</button>
          </div>

          <div className="all-grid-wrap">
            <div className="all-grid-real">
              {grid.map((item) => {
                const viewAnchor = teamAnchors[viewTeam] || {};
                const isMine = item.name === viewAnchor.name;

                return (
                  <button
                    key={`${item.idx}-${item.displayName}`}
                    className={`all-cell-real ${isMine ? "cell-my" : ""}`}
                    style={{ backgroundColor: item.customColor || "#ffffff" }}
                    onClick={() => handleCellClick(item)}
                    onMouseDown={() => startLongPress(item)}
                    onMouseUp={cancelLongPress}
                    onMouseLeave={cancelLongPress}
                    onTouchStart={() => startLongPress(item)}
                    onTouchEnd={cancelLongPress}
                  >
                    <div className="all-code">{item.code || "-"}</div>
                    <div className="all-name">{item.displayName || "-"}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bottom-team-tabs">
            <button className={`bottom-team-tab ${viewTeam === "ks" ? "active" : ""}`} onClick={() => setViewTeam("ks")}>경산</button>
            <button className={`bottom-team-tab ${viewTeam === "my" ? "active" : ""}`} onClick={() => setViewTeam("my")}>문양</button>
            <button className={`bottom-team-tab ${viewTeam === "wb" ? "active" : ""}`} onClick={() => setViewTeam("wb")}>월배</button>
            <button className={`bottom-team-tab ${viewTeam === "as" ? "active" : ""}`} onClick={() => setViewTeam("as")}>안심</button>
          </div>
        </div>
      )}

      {editOpen && (
        <div className="modal-backdrop" onClick={() => setEditOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">이름변경 및 색상 수정</div>
            <div className="modal-sub">
              {TEAM_LABELS[viewTeam]} {editingCell?.code} {editingCell?.displayName || editingCell?.name}
            </div>

            <label className="label">이름</label>
            <input className="input" value={editName} onChange={(e) => setEditName(e.target.value)} />

            <label className="label" style={{ marginTop: 12 }}>색상</label>
            <select className="select" value={editColor || "default"} onChange={(e) => setEditColor(e.target.value)}>
              {COLOR_OPTIONS.map((item) => (
                <option key={item.label} value={item.value || "default"}>{item.label}</option>
              ))}
            </select>

            <div
              className="color-preview"
              style={{ backgroundColor: editColor === "default" ? "#ffffff" : editColor || "#ffffff" }}
            />

            <div className="modal-actions">
              <button className="modal-btn" onClick={() => setEditOpen(false)}>아니요</button>
              <button className="modal-btn primary" onClick={() => commitEdit(editColor === "default" ? "" : editColor)}>
                변경
              </button>
            </div>
          </div>
        </div>
      )}

      {pathOpen && (
        <div className="viewer-page">
          <div className="viewer-header">
            <div className="viewer-title">행로표</div>
            <button className="modal-btn primary" onClick={() => setPathOpen(false)}>닫기</button>
          </div>

          <div className="viewer-body">
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
              {TEAM_LABELS[viewTeam]} / {pathTarget?.displayName || pathTarget?.name} / {pathTarget?.code}
            </div>
            <div style={{ color: "#6b7280", marginBottom: 16 }}>
              {selectedDate} {weekdayName(selectedDate)}
            </div>

            {pathImage ? (
              <img src={pathImage} alt="행로표" className="fullscreen-image" />
            ) : (
              <div className="empty-box">해당 행로표 이미지를 찾지 못했습니다.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);