// app.js - D휴가 앱
// 현재 단계: 로그인 흐름 (소속선택 → 이름선택 → 교번확인 → PIN설정 / 재로그인)
// TODO: fetchEmployees()의 실제 API 연동은 추후 처리 (지금은 더미 데이터)

const { useState, useEffect, useCallback, useRef } = React;

/* ------------------------------------------------------------------ */
/* 실제 직원 데이터 연동 (교번앱 Apps Script, JSONP)                     */
/* + 기준일(baseDate) 대비 오늘까지의 날짜차이만큼 교번틀을 밀어서       */
/*   "오늘 기준 실제 교번"을 계산 (교번앱과 동일한 방식)                  */
/* ------------------------------------------------------------------ */
const GAS_URL =
  "https://script.google.com/macros/s/AKfycbw8NMVjH3J_Mt7SBymWOg44zvD4gd4GXkQB3r95QTl63M3aWqtf-OglLrG2rQPH7J6UjA/exec";

// 경산 휴가 데이터 - 교번앱이 이미 안정적으로 쓰고 있는 검증된 API (날짜가 완성된 형태로 옴)
const VACATION_API_URL =
  "https://script.google.com/macros/s/AKfycby_p9K5jW7LTxAGy_uTTV88KcEGtnFQAEy7UctYq4Xkv2lpTj5RtR-mOACfic_BmE29kQ/exec";

// 가져오기 테스트에서 이 날짜 이전 기록은 제외 (필요하면 이 값만 바꾸면 돼요)
const IMPORT_FROM_DATE = "2026-07-01";

// 밴드 채팅방 바로가기 (경산승무팀)
const BAND_URL = "https://band.us/band/51746678/chat/C4U1ay";

const TEAM_MAP = { ks: "경산", my: "문양" }; // 안심(as)/월배(wb)는 이 앱 대상 아님
// ⚠️ 테스트 모드: true면 누구나 교번확인/승인 없이 바로 들어갈 수 있어요.
// 실제 운영 시작하면 반드시 false로 바꿔주세요!
const TEST_MODE = true;

const REVERSE_TEAM_MAP = { 경산: "ks", 문양: "my" };

// 운용(중간관리자) 명단은 더 이상 코드에 하드코딩하지 않고 Firestore(window.ManagerAPI)로 관리해요.
// 관리자(권재림)가 앱 내 "운용 인원 관리" 화면에서 직접 추가/삭제할 수 있어요.
function isMidManagerUser(user, managers) {
  return (managers || []).some((m) => m.name === user.name && m.branch === user.branch);
}

function jsonpRequest(url, params) {
  return new Promise((resolve, reject) => {
    const callbackName = "jsonp_cb_" + Math.random().toString(36).slice(2);
    const query = new URLSearchParams({ ...params, callback: callbackName }).toString();
    const script = document.createElement("script");
    script.src = url + "?" + query;

    const cleanup = () => {
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = (data) => {
      resolve(data);
      cleanup();
    };
    script.onerror = () => {
      reject(new Error("네트워크 오류로 직원 데이터를 불러오지 못했어요"));
      cleanup();
    };

    document.body.appendChild(script);
  });
}

// 교번앱과 동일한 날짜 계산 방식 (한국 시간 기준)
function koreaTodayStr() {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utcTime + 9 * 60 * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, "0");
  const d = String(kst.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// 오늘이 "짝수달 1일"인지 확인 (경산 - 다음 두 달 휴가를 선착순으로 신청받는 날, 순번 조정 가능일)
function isEvenMonthFirstDay() {
  const today = koreaTodayStr(); // "YYYY-MM-DD"
  const month = parseInt(today.slice(5, 7), 10);
  const day = parseInt(today.slice(8, 10), 10);
  return day === 1 && month % 2 === 0;
}

function parseLocalDate_(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function diffDays_(a, b) {
  const da = parseLocalDate_(a);
  const db = parseLocalDate_(b);
  da.setHours(0, 0, 0, 0);
  db.setHours(0, 0, 0, 0);
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

function positiveMod_(n, mod) {
  if (!mod) return 0;
  return ((n % mod) + mod) % mod;
}

// 교번틀 순서(order) 안에서 baseCode 위치를 찾아 dayOffset만큼 민 코드 반환
function shiftCodeByDays_(order, baseCode, dayOffset) {
  if (!order || !order.length) return baseCode || "";
  const baseIdx = order.findIndex((c) => String(c).trim() === String(baseCode).trim());
  if (baseIdx < 0) return baseCode || "";
  return order[positiveMod_(baseIdx + dayOffset, order.length)] || baseCode || "";
}

let GYOBUN_ORDER = { ks: [], my: [] }; // 달력 교번 계산용
let BASE_DATE = ""; // 달력 교번 계산용 (기준일)

function fetchEmployees() {
  return Promise.all([
    jsonpRequest(GAS_URL, { mode: "roster" }),
    jsonpRequest(GAS_URL, { mode: "gyobunOrder" }),
  ]).then(([rosterRes, orderRes]) => {
    if (!rosterRes || !rosterRes.ok) {
      throw new Error((rosterRes && rosterRes.error) || "직원 데이터를 불러오지 못했어요");
    }
    if (!orderRes || !orderRes.ok) {
      throw new Error((orderRes && orderRes.error) || "교번틀 데이터를 불러오지 못했어요");
    }

    GYOBUN_ORDER = { ks: orderRes.ks || [], my: orderRes.my || [] };
    BASE_DATE = rosterRes.baseDate || orderRes.baseDate || "";

    const today = koreaTodayStr();
    const dayOffset = BASE_DATE ? diffDays_(BASE_DATE, today) : 0;

    return rosterRes.rows
      .filter((r) => r.team === "ks" || r.team === "my")
      .map((r) => {
        const order = orderRes[r.team] || [];
        const todayCode = shiftCodeByDays_(order, r.gyobun, dayOffset);
        return {
          id: r.employeeId || `${r.team}-${r.gyobun}-${r.name}`,
          name: r.name,
          branch: TEAM_MAP[r.team],
          code: todayCode, // 오늘 기준 실제 교번
          baseCode: r.gyobun, // 기준일(4/1) 원본 (참고용)
        };
      });
  });
}

/* ------------------------------------------------------------------ */
/* 로컬 저장소 헬퍼 (PIN은 기기에만 저장)                                */
/* ------------------------------------------------------------------ */
const STORAGE_KEY = "vacation_auth";

function saveLocalAuth(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function loadLocalAuth() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* 공통 스타일                                                          */
/* ------------------------------------------------------------------ */
const styles = {
  screen: {
    minHeight: "100vh",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  title: {
    fontSize: "22px",
    fontWeight: 800,
    marginBottom: "24px",
    color: "#1b3a5c",
    textAlign: "center",
    letterSpacing: "-0.3px",
  },
  button: {
    width: "100%",
    maxWidth: "360px",
    padding: "16px",
    margin: "6px 0",
    borderRadius: "14px",
    border: "1px solid #e6e2d8",
    background: "#fff",
    fontSize: "16px",
    fontWeight: 600,
    color: "#1f2a33",
    cursor: "pointer",
  },
  primaryButton: {
    width: "100%",
    maxWidth: "360px",
    padding: "16px",
    margin: "16px 0 6px",
    borderRadius: "14px",
    border: "none",
    background: "#1b3a5c",
    fontSize: "16px",
    fontWeight: 700,
    color: "#fff",
    cursor: "pointer",
    boxShadow: "0 4px 10px rgba(27,58,92,0.25)",
  },
  pinDots: {
    display: "flex",
    gap: "18px",
    margin: "24px 0",
  },
  pinDot: (filled) => ({
    width: "16px",
    height: "16px",
    borderRadius: "50%",
    background: filled ? "#d99a3d" : "#e6e2d8",
    boxShadow: filled ? "0 0 0 4px rgba(217,154,61,0.18)" : "none",
    transition: "box-shadow 120ms ease",
  }),
  keypad: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "22px",
    width: "100%",
    maxWidth: "340px",
  },
  key: {
    aspectRatio: "1",
    width: "100%",
    fontSize: "26px",
    fontWeight: 600,
    borderRadius: "50%",
    border: "none",
    background: "#fff",
    color: "#1f2a33",
    boxShadow: "0 2px 8px rgba(27,58,92,0.08)",
  },
  backspaceKey: {
    aspectRatio: "1",
    width: "100%",
    fontSize: "20px",
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: "#b5aa96",
    boxShadow: "none",
  },
  errorText: {
    color: "#e02020",
    fontSize: "14px",
    marginTop: "8px",
  },
  subText: {
    color: "#888",
    fontSize: "14px",
    marginBottom: "16px",
    textAlign: "center",
  },
  select: {
    width: "100%",
    maxWidth: "360px",
    padding: "14px",
    margin: "6px 0",
    borderRadius: "12px",
    border: "1px solid #ddd",
    background: "#fff",
    fontSize: "16px",
    color: "#1a1a1a",
  },
  fieldLabel: {
    width: "100%",
    maxWidth: "360px",
    fontSize: "13px",
    color: "#666",
    margin: "12px 0 2px",
  },
};

/* ------------------------------------------------------------------ */
/* PIN 키패드 컴포넌트                                                   */
/* ------------------------------------------------------------------ */
function PinPad({ length = 4, onComplete, error }) {
  const [pin, setPin] = useState("");

  useEffect(() => {
    setPin("");
  }, [error]);

  const press = (digit) => {
    if (pin.length >= length) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === length) {
      onComplete(next);
      setTimeout(() => setPin(""), 300);
    }
  };

  const backspace = () => setPin(pin.slice(0, -1));

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div style={styles.pinDots}>
        {Array.from({ length }).map((_, i) => (
          <div key={i} style={styles.pinDot(i < pin.length)} />
        ))}
      </div>
      {error && <div style={styles.errorText}>{error}</div>}
      <div style={{ ...styles.keypad, marginTop: "16px" }}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
          <button key={n} style={styles.key} onClick={() => press(String(n))}>
            {n}
          </button>
        ))}
        <div />
        <button style={styles.key} onClick={() => press("0")}>0</button>
        <button style={styles.backspaceKey} onClick={backspace}>⌫</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* PWA 설치 배너 (안드로이드: 설치 버튼 / iOS: 안내 문구)                  */
/* ------------------------------------------------------------------ */
const installStyles = {
  bar: {
    width: "100%",
    maxWidth: "360px",
    background: "#eaf1ff",
    border: "1px solid #cfe0ff",
    borderRadius: "12px",
    padding: "12px 14px",
    marginBottom: "16px",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "10px",
  },
  text: { fontSize: "13px", color: "#333", flex: 1 },
  installBtn: {
    flexShrink: 0,
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#1b3a5c",
    color: "#fff",
    fontSize: "13px",
    fontWeight: 700,
  },
  closeBtn: {
    flexShrink: 0,
    border: "none",
    background: "none",
    color: "#999",
    fontSize: "16px",
    padding: "0 4px",
  },
};

function InstallBanner({ installPrompt, onInstall, showIosHint, dismissed, onDismiss }) {
  if (dismissed) return null;
  if (installPrompt) {
    return (
      <div style={installStyles.bar}>
        <span style={installStyles.text}>📱 앱처럼 설치해서 쓸 수 있어요</span>
        <button style={installStyles.installBtn} onClick={onInstall}>설치</button>
        <button style={installStyles.closeBtn} onClick={onDismiss}>✕</button>
      </div>
    );
  }
  if (showIosHint) {
    return (
      <div style={installStyles.bar}>
        <span style={installStyles.text}>📱 공유 버튼 → "홈 화면에 추가"로 앱처럼 설치할 수 있어요</span>
        <button style={installStyles.closeBtn} onClick={onDismiss}>✕</button>
      </div>
    );
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* 메인 앱                                                              */
/* ------------------------------------------------------------------ */
function App() {
  // step: "loading" | "chooseBranch" | "nameAndCode" | "setPin" | "loginName" | "loginPin" | "main"
  const [step, setStep] = useState("loading");
  const [employees, setEmployees] = useState([]);
  const [managers, setManagers] = useState([]); // 운용(중간관리자) 명단 - Firestore
  const [localAuth, setLocalAuth] = useState([]);
  const [branch, setBranch] = useState(null);
  const [role, setRole] = useState(null); // "기관사" | "운용"
  const [addManagerOnly, setAddManagerOnly] = useState(false); // "이 기기에 다른 사람 등록"은 운용 전용
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [pendingNameId, setPendingNameId] = useState("");
  const [pendingCode, setPendingCode] = useState("");
  const [loginTarget, setLoginTarget] = useState(null);
  const [pinError, setPinError] = useState("");
  const [firstPin, setFirstPin] = useState(""); // PIN 최초 설정 시 재입력 확인용

  // PWA 설치 배너 관련
  const [installPrompt, setInstallPrompt] = useState(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(
    localStorage.getItem("install_banner_dismissed") === "1"
  );

  useEffect(() => {
    const handler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener("beforeinstallprompt", handler);

    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
    if (isIos && !isStandalone) setShowIosHint(true);

    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  const handleInstallClick = () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    installPrompt.userChoice.finally(() => setInstallPrompt(null));
  };

  const handleDismissBanner = () => {
    setBannerDismissed(true);
    localStorage.setItem("install_banner_dismissed", "1");
  };

  const installBanner = (
    <InstallBanner
      installPrompt={installPrompt}
      onInstall={handleInstallClick}
      showIosHint={showIosHint}
      dismissed={bannerDismissed}
      onDismiss={handleDismissBanner}
    />
  );

  useEffect(() => {
    const auth = loadLocalAuth();
    setLocalAuth(auth);

    // 재로그인(이미 등록된) 사용자는 직원 데이터를 기다릴 필요 없이 바로 진입
    if (auth.length > 0) {
      setStep("loginName");
    }

    // 직원 데이터는 신규 등록 시 필요하고, 재로그인 사용자도 달력의 날짜별 교번 표시에 필요해서
    // 어차피 백그라운드로 가져옴
    fetchEmployees()
      .then((list) => {
        setEmployees(list);
        if (auth.length === 0) setStep("chooseBranch");
      })
      .catch((err) => {
        console.error(err);
        if (auth.length === 0) {
          alert("직원 데이터를 불러오지 못했어요: " + (err && err.message ? err.message : err));
          setStep("chooseBranch");
        }
        // 재로그인 사용자는 이미 화면이 떠 있으니 조용히 재시도만 실패 처리 (콘솔 로그만)
      });

    // 운용(중간관리자) 명단은 Firestore에서 불러옴
    waitForFirestore()
      .then(() => window.ManagerAPI.list())
      .then((list) => setManagers(list))
      .catch((err) => console.error("운용 명단 로드 실패:", err));

    // 보관 기한(1년) 지난 오래된 휴가 기록 자동 삭제 - 예: 2027년이 되면 2025년 데이터부터 삭제
    // (연 1회만 실제로 지우도록, 이 기기에서 올해 이미 정리했는지 localStorage로 확인)
    const CLEANUP_KEY = "vacation_cleanup_year";
    const currentYear = new Date().getFullYear();
    const lastCleanupYear = parseInt(localStorage.getItem(CLEANUP_KEY) || "0", 10);
    if (lastCleanupYear < currentYear) {
      waitForFirestore()
        .then(() => window.VacationAPI.deleteOlderThan(`${currentYear - 1}-01-01`))
        .then(() => localStorage.setItem(CLEANUP_KEY, String(currentYear)))
        .catch((err) => console.error("오래된 휴가 기록 정리 실패:", err));
    }
  }, []);

  const branchEmployees = employees.filter(
    (e) => e.branch === branch && !localAuth.some((a) => a.id === e.id)
  );

  // 운용(중간관리자) 명단 - 교번 없음
  const branchManagerEntries = managers
    .filter((m) => m.branch === branch)
    .map((m) => ({ id: m.id, name: m.name, branch: m.branch, code: null }))
    .filter((m) => !localAuth.some((a) => a.id === m.id));

  // 선택한 구분(기관사/운용)에 따라 이름 목록을 분리해서 보여줌
  const nameOptions = role === "운용" ? branchManagerEntries : branchEmployees;

  const selectedNameEntry = nameOptions.find((e) => e.id === pendingNameId);
  const selectedIsManager = !!selectedNameEntry && selectedNameEntry.code === null;

  /* ---- 최초 설정 흐름 ---- */
  const handleChooseBranch = (b) => {
    setBranch(b);
    setRole(null);
    setAddManagerOnly(false);
    setPendingNameId("");
    setPendingCode("");
    setStep("chooseRole");
  };

  // "이 기기에 다른 사람 등록" 전용 - 운용만 추가할 수 있어서 구분 선택 단계를 건너뜀
  const handleChooseBranchManagerOnly = (b) => {
    setBranch(b);
    setRole("운용");
    setPendingNameId("");
    setPendingCode("");
    setStep("nameAndCode");
  };

  const handleChooseRole = (r) => {
    setRole(r);
    setPendingNameId("");
    setPendingCode("");
    setStep("nameAndCode");
  };

  const branchOrder = GYOBUN_ORDER[REVERSE_TEAM_MAP[branch]] || [];
  const templateCodes = branchOrder.filter((c) =>
    branchEmployees.some((e) => e.code === c)
  );
  // 교번틀에 없는 코드(갑/을/병/현업일근 등 중간관리자 근무형태)도 뒤에 붙여서 보여줌
  const otherCodes = [...new Set(branchEmployees.map((e) => e.code))].filter(
    (c) => !templateCodes.includes(c)
  );
  const branchCodes = [...templateCodes, ...otherCodes];

  const handleConfirmNameCode = () => {
    const emp = nameOptions.find((e) => e.id === pendingNameId);
    if (!emp) {
      alert("이름을 선택해주세요");
      return;
    }

    // 관리직(교번 없음)은 교번 확인 단계 없이 바로 진행
    // ※ 교번 검증은 테스트 버전이어도 절차상 그대로 유지해요 (TEST_MODE와 무관)
    if (emp.code !== null) {
      if (!pendingCode) {
        alert("교번을 선택해주세요");
        return;
      }
      if (pendingCode !== emp.code) {
        alert("교번이 일치하지 않아요. 본인의 오늘자 현재 교번을 다시 확인해주세요.");
        return;
      }
    }

    // TEST_MODE에서는 "이미 승인된 기기" 같은 중복 차단만 건너뛰고, 그 외 절차(교번확인·PIN)는 그대로 거쳐요
    if (TEST_MODE || ADMIN_NAMES.includes(emp.name) || isMidManagerUser(emp, managers)) {
      setSelectedEmp(emp);
      setStep("setPin");
      return;
    }

    waitForFirestore()
      .then(() => window.ApprovalAPI.getStatus(emp.id))
      .then((data) => {
        if (data && data.status === "approved") {
          alert("이미 다른 기기에서 승인받아 사용 중인 계정이에요.\n\n휴대폰을 바꾸신 거라면, 관리자(권재림)에게 '기기변경'을 요청해주세요. 관리자가 처리해주면 다시 등록하실 수 있어요.");
          return;
        }
        if (data && data.status === "pending") {
          alert("이미 대기중인 신청 건이 있어요. 관리자 확인 후 처리될 때까지 기다려주세요.\n(본인이 신청한 게 아니라면 관리자에게 바로 알려주세요!)");
          return;
        }
        setSelectedEmp(emp);
        setStep("setPin");
      })
      .catch((err) => {
        console.error(err);
        alert("확인 중 오류가 발생했어요: " + (err && err.message ? err.message : err));
      });
  };

  // PIN 최초 입력 → 재확인 단계로 이동
  const handlePinFirstEntry = (pin) => {
    setFirstPin(pin);
    setStep("setPinConfirm");
  };

  // PIN 재입력 확인 → 일치하면 실제 등록 진행, 불일치하면 처음부터 다시
  const handlePinConfirm = (pin) => {
    if (pin !== firstPin) {
      alert("PIN이 일치하지 않아요. 처음부터 다시 입력해주세요.");
      setFirstPin("");
      setStep("setPin");
      return;
    }
    handleSetPin(pin);
  };

  const handleSetPin = (pin) => {
    const updated = [...localAuth, { id: selectedEmp.id, name: selectedEmp.name, branch: selectedEmp.branch, pin }];
    saveLocalAuth(updated);
    setLocalAuth(updated);

    if (TEST_MODE || ADMIN_NAMES.includes(selectedEmp.name) || isMidManagerUser(selectedEmp, managers)) {
      // 관리자는 승인 절차 없이 바로 진입 (본인이 승인권자니까)
      setStep("main");
      return;
    }

    waitForFirestore()
      .then(() => window.ApprovalAPI.request({ id: selectedEmp.id, name: selectedEmp.name, branch: selectedEmp.branch }))
      .then(() => setStep("pendingApproval"))
      .catch((err) => {
        console.error(err);
        alert("승인 요청 중 오류가 발생했어요: " + (err && err.message ? err.message : err));
        setStep("pendingApproval");
      });
  };

  /* ---- 재로그인 흐름 ---- */
  const handleLoginNameSelect = (auth) => {
    setLoginTarget(auth);
    setStep("loginPin");
    setPinError("");
  };

  const handleLoginPin = (pin) => {
    if (loginTarget.pin !== pin) {
      setPinError("PIN이 일치하지 않아요");
      return;
    }

    if (TEST_MODE || ADMIN_NAMES.includes(loginTarget.name) || isMidManagerUser(loginTarget, managers)) {
      setStep("main");
      return;
    }

    waitForFirestore()
      .then(() => window.ApprovalAPI.getStatus(loginTarget.id))
      .then((data) => {
        if (!data || data.status === "pending") {
          setStep("pendingApproval");
        } else if (data.status === "rejected") {
          setStep("rejected");
        } else {
          setStep("main");
        }
      })
      .catch((err) => {
        console.error(err);
        alert("승인 상태 확인 중 오류가 발생했어요: " + (err && err.message ? err.message : err));
      });
  };

  const handleResetAll = () => {
    if (!confirm("이 기기에 저장된 로그인 정보를 전부 지울까요?\n(테스트용 초기화 - 다시 처음부터 등록해야 해요)")) return;
    localStorage.removeItem(STORAGE_KEY);
    setLocalAuth([]);
    setStep("chooseBranch");
  };

  // 공용 PC 등, 이 기기에 운용 인원을 추가로 등록할 때 사용 (기존 등록자는 유지됨, 기관사는 등록 불가)
  const handleAddAnother = () => {
    setBranch(null);
    setRole(null);
    setAddManagerOnly(true);
    setPendingNameId("");
    setPendingCode("");
    setStep("chooseBranch");
  };

  /* ------------------------------ 화면 렌더링 ------------------------------ */

  if (step === "loading") {
    return <div style={styles.screen}>불러오는 중...</div>;
  }

  // 소속 선택
  if (step === "chooseBranch") {
    return (
      <div style={styles.screen}>
        {installBanner}
        <div style={styles.title}>
          {addManagerOnly ? "운용 인원 추가 · 소속을 선택해주세요" : "소속을 선택해주세요"}
        </div>
        {addManagerOnly ? (
          <React.Fragment>
            <button style={styles.button} onClick={() => handleChooseBranchManagerOnly("경산")}>경산승무팀</button>
            <button style={styles.button} onClick={() => handleChooseBranchManagerOnly("문양")}>문양승무팀</button>
          </React.Fragment>
        ) : (
          <React.Fragment>
            <button style={styles.button} onClick={() => handleChooseBranch("경산")}>경산승무팀</button>
            <button style={styles.button} onClick={() => handleChooseBranch("문양")}>문양승무팀</button>
          </React.Fragment>
        )}
        {addManagerOnly && (
          <button
            style={{ ...styles.button, border: "none", color: "#888" }}
            onClick={() => {
              setAddManagerOnly(false);
              setStep("loginName");
            }}
          >
            ← 취소
          </button>
        )}
      </div>
    );
  }

  // 구분 선택 (기관사 / 운용)
  if (step === "chooseRole") {
    return (
      <div style={styles.screen}>
        {installBanner}
        <div style={styles.title}>{branch} · 구분을 선택해주세요</div>
        <button style={styles.button} onClick={() => handleChooseRole("기관사")}>기관사</button>
        <button style={styles.button} onClick={() => handleChooseRole("운용")}>운용</button>
        <button style={{ ...styles.button, border: "none", color: "#888" }} onClick={() => setStep("chooseBranch")}>
          ← 소속 다시 선택
        </button>
      </div>
    );
  }

  // 이름 + 교번 확인 (한 페이지, 드롭다운)
  if (step === "nameAndCode") {
    return (
      <div style={styles.screen}>
        {installBanner}
        <div style={styles.title}>{branch} · {role} · 이름을 선택해주세요</div>
        {nameOptions.length === 0 && (
          <div style={styles.subText}>
            {role === "운용"
              ? "등록된 운용 인원이 없어요. 관리자에게 문의해주세요."
              : "표시할 이름이 없어요. 인사이동으로 새로 오신 경우 직원목록 시트 반영 후 다시 시도해주세요."}
          </div>
        )}
        {nameOptions.length > 0 && (
          <React.Fragment>
            <div style={styles.fieldLabel}>이름</div>
            <select
              style={styles.select}
              value={pendingNameId}
              onChange={(e) => {
                setPendingNameId(e.target.value);
                setPendingCode("");
              }}
            >
              <option value="">이름 선택</option>
              {[...nameOptions]
                .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                .map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
            </select>

            {selectedNameEntry && selectedIsManager && (
              <div style={styles.subText}>관리직은 교번 확인 없이 등록돼요</div>
            )}

            {selectedNameEntry && !selectedIsManager && (
              <React.Fragment>
                <div style={styles.fieldLabel}>본인의 현재 교번</div>
                <select
                  style={styles.select}
                  value={pendingCode}
                  onChange={(e) => setPendingCode(e.target.value)}
                >
                  <option value="">교번 선택</option>
                  {branchCodes.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </React.Fragment>
            )}

            <button style={styles.primaryButton} onClick={handleConfirmNameCode}>확인</button>
          </React.Fragment>
        )}
        <button
          style={{ ...styles.button, border: "none", color: "#888" }}
          onClick={() => setStep(addManagerOnly ? "chooseBranch" : "chooseRole")}
        >
          {addManagerOnly ? "← 소속 다시 선택" : "← 구분 다시 선택"}
        </button>
      </div>
    );
  }

  // PIN 설정 (1차 입력)
  if (step === "setPin") {
    return (
      <div style={styles.screen}>
        <div style={styles.title}>사용하실 PIN 4자리를 설정해주세요</div>
        <div style={styles.subText}>이 PIN은 이 휴대폰에만 저장돼요</div>
        <PinPad onComplete={handlePinFirstEntry} />
      </div>
    );
  }

  // PIN 설정 (재입력 확인)
  if (step === "setPinConfirm") {
    return (
      <div style={styles.screen}>
        <div style={styles.title}>PIN을 한 번 더 입력해주세요</div>
        <div style={styles.subText}>정확히 입력했는지 확인할게요</div>
        <PinPad onComplete={handlePinConfirm} />
      </div>
    );
  }

  // 재로그인 - 이름 선택
  if (step === "loginName") {
    const hasManagerOnDevice = localAuth.some((a) => isMidManagerUser(a, managers));
    return (
      <div style={styles.screen}>
        {installBanner}
        <div style={styles.title}>이름을 선택해주세요</div>
        {localAuth.map((a) => (
          <button key={a.id} style={styles.button} onClick={() => handleLoginNameSelect(a)}>
            {a.name} ({a.branch})
          </button>
        ))}
        {hasManagerOnDevice && (
          <button
            style={{ ...styles.button, border: "1px dashed #1b3a5c", color: "#1b3a5c", marginTop: "16px" }}
            onClick={handleAddAnother}
          >
            + 이 기기에 다른 사람 등록
          </button>
        )}
        {TEST_MODE && (
          <button style={{ ...styles.button, border: "none", color: "#e02020", marginTop: "8px" }} onClick={handleResetAll}>
            🔄 (테스트용) 전체 초기화
          </button>
        )}
      </div>
    );
  }

  // 승인 대기중
  if (step === "pendingApproval") {
    return (
      <div style={styles.screen}>
        <div style={styles.title}>승인 대기중이에요 ⏳</div>
        <div style={styles.subText}>관리자가 확인 후 승인하면 사용하실 수 있어요</div>
        <button
          style={styles.primaryButton}
          onClick={() => {
            const id = (loginTarget || selectedEmp)?.id;
            if (!id) return;
            window.ApprovalAPI.getStatus(id).then((data) => {
              if (data && data.status === "approved") setStep("main");
              else if (data && data.status === "rejected") setStep("rejected");
              else alert("아직 승인 대기중이에요");
            });
          }}
        >
          승인 상태 다시 확인
        </button>
        <button style={{ ...styles.button, border: "none", color: "#888" }} onClick={() => setStep("loginName")}>
          나가기
        </button>
      </div>
    );
  }

  // 승인 거절됨
  if (step === "rejected") {
    return (
      <div style={styles.screen}>
        <div style={styles.title}>승인이 거절됐어요</div>
        <div style={styles.subText}>본인이 맞다면 관리자에게 직접 문의해주세요</div>
        <button style={{ ...styles.button, border: "none", color: "#888" }} onClick={() => setStep("loginName")}>
          나가기
        </button>
      </div>
    );
  }
  if (step === "loginPin") {
    return (
      <div style={styles.screen}>
        <div style={styles.title}>{loginTarget.name}님, PIN을 입력해주세요</div>
        <PinPad onComplete={handleLoginPin} error={pinError} />
      </div>
    );
  }

  // 메인 화면 - 날짜별 조회
  if (step === "main") {
    return (
      <MainScreen
        currentUser={loginTarget || { ...selectedEmp }}
        employees={employees}
        managers={managers}
        onSwitchUser={() => setStep("loginName")}
      />
    );
  }

  return null;
}

/* ------------------------------------------------------------------ */
/* Firestore 준비 대기 헬퍼                                             */
/* ------------------------------------------------------------------ */
function waitForFirestore() {
  return new Promise((resolve) => {
    if (window.__firestoreReady) return resolve();
    window.addEventListener("firestore-ready", () => resolve(), { once: true });
  });
}

function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function weekdayShort(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return WEEKDAYS[d.getDay()];
}

function formatDateHeader(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${dateStr} ${WEEKDAYS[d.getDay()]}요일`;
}

function formatEntryTime(ts) {
  if (!ts) return "";
  const date = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (isNaN(date.getTime())) return "";
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${mo}/${dd} ${hh}:${mm} 입력`;
}

// createdAt(Firestore Timestamp)에서 "YYYY-MM-DD"만 추출 (순번 수정 가능 여부 판단용 - "그날 신청한 기록"인지 확인)
function formatEntryDateOnly(ts) {
  if (!ts) return "";
  const date = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
  if (isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${y}-${mo}-${dd}`;
}

/* ------------------------------------------------------------------ */
/* 메인 화면 - 월별 달력                                                 */
/* ------------------------------------------------------------------ */
const cal = {
  wrap: { minHeight: "100vh", background: "#f7f4ee", paddingBottom: "40px", overflowX: "hidden" },
  header: {
    padding: "18px 14px 14px",
    background: "#1b3a5c",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    flexWrap: "wrap",
    rowGap: "8px",
    marginBottom: "10px",
  },
  userName: {
    fontWeight: 700,
    fontSize: "15px",
    color: "#fff",
    whiteSpace: "nowrap",
    marginRight: "8px",
  },
  switchUserBtn: {
    padding: "3px 8px",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.4)",
    background: "transparent",
    color: "#cfe0ff",
    fontSize: "11px",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  headerBtnRow: {
    display: "flex",
    gap: "5px",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  },
  railDivider: {
    height: 0,
    borderBottom: "2px dashed rgba(255,255,255,0.25)",
    margin: "14px 0 0",
  },
  navRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navBtn: {
    width: "36px",
    height: "36px",
    borderRadius: "50%",
    border: "none",
    background: "rgba(255,255,255,0.14)",
    fontSize: "18px",
    color: "#fff",
  },
  monthTitle: { fontSize: "18px", fontWeight: 800, color: "#fff", letterSpacing: "0.5px" },
  weekRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    marginTop: "14px",
    textAlign: "center",
    fontSize: "12px",
    color: "#c9d4de",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    gap: "2px",
    padding: "2px 2px 16px",
    boxSizing: "border-box",
  },
  dayCell: (isToday) => ({
    minWidth: 0,
    width: "100%",
    minHeight: "82px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "flex-start",
    padding: "8px 2px 6px",
    borderRadius: "6px",
    background: "#fff",
    border: "1px solid #e6e0d0",
    outline: isToday ? "2px solid #1b3a5c" : "none",
    outlineOffset: "-2px",
    cursor: "pointer",
    position: "relative",
    boxSizing: "border-box",
  }),
  dayDivider: {
    width: "70%",
    borderBottom: "1px dashed #d8d2c2",
    margin: "5px 0 6px",
  },
  dayNum: (type) => ({
    fontSize: "16px",
    lineHeight: "18px",
    height: "18px",
    fontWeight: 800,
    color: type === "휴일" ? "#e02020" : type === "토요일" ? "#1a73e8" : "#222",
  }),
  dayCode: {
    fontSize: "14px",
    lineHeight: "16px",
    height: "16px",
    fontWeight: 700,
    color: "#1a1a1a",
    width: "100%",
    alignSelf: "stretch",
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    textAlign: "center",
    boxSizing: "border-box",
    padding: "0 2px",
  },
  dayBadge: (color) => ({
    marginTop: "auto",
    width: "24px",
    height: "24px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "13px",
    fontWeight: 700,
    color: "#fff",
    background: color,
  }),
  emptyCell: { visibility: "hidden" },
};

function badgeColor(count) {
  if (count >= 5) return "#e02020";
  if (count >= 3) return "#f5a623";
  return "#1caa5c";
}

/* ---- 경산 전용: 요일별 보장인원 + 비번 포함시 +1 로직 ---- */
// 보장인원 계산에 포함되는 휴가 종류만 카운트 (병가/교육/노조 등은 기록은 되지만 여유 계산엔 미포함)
const CAPACITY_TYPES = [
  "연차", "연차비", "분지", "분지비", "장재", "장재비",
  "지정교번휴무", "검진공가", "연간지", "돌봄",
];

function isCapacityType(type) {
  return CAPACITY_TYPES.includes(type);
}

// 2026년 공휴일 폴백 목록 (API 호출 실패/오프라인 시에만 사용)
const FALLBACK_HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18",
  "2026-03-01", "2026-03-02", "2026-05-05", "2026-05-24", "2026-05-25",
  "2026-06-03", "2026-06-06", "2026-07-17", "2026-08-15", "2026-08-17",
  "2026-09-24", "2026-09-25", "2026-09-26",
  "2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25",
]);

// 수동으로 추가하는 공휴일 (임시공휴일, 선거일 등 API가 놓치는 날짜)
// ⚠️ 필요할 때 이 배열에 "YYYY-MM-DD" 형식으로 날짜만 추가하면 돼요. API 성공 여부와 무관하게 항상 적용됩니다.
// Nager.Date API가 2026년 데이터(제헌절 재지정, 개천절 대체공휴일 등)를 놓치는 경우가 확인되어,
// 2026년 공휴일 전체를 API 결과와 무관하게 항상 보장되도록 넣어뒀어요.
const MANUAL_HOLIDAYS = [
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18",
  "2026-03-01", "2026-03-02", "2026-05-05", "2026-05-24", "2026-05-25",
  "2026-06-03", "2026-06-06", "2026-07-17", "2026-08-15", "2026-08-17",
  "2026-09-24", "2026-09-25", "2026-09-26",
  "2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25",
];

// API가 잘못 포함시키는 날짜(실제로는 근무일)를 매년 자동 제외
// 제헌절(7/17): 2008년~2025년엔 법정 공휴일이 아니었지만, 2026년 2월 법 개정으로 재지정되어
// 2026년 5월 11일 시행 이후(즉 2026년 7월 17일부터)는 다시 정식 공휴일이에요. 그래서 2026년 이후는 제외하지 않아요.
function isExcludedFakeHoliday(dateStr) {
  const isJeheonjeol = dateStr.endsWith("-07-17");
  if (!isJeheonjeol) return false;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return year < 2026; // 2026년 이전 제헌절만 "가짜 공휴일"로 제외
}

// 연도별 공휴일을 Nager.Date API에서 자동 조회 (실패 시 폴백 사용, 2026년 외 연도는 빈 목록)
// + MANUAL_HOLIDAYS는 항상 합쳐서 반환, isExcludedFakeHoliday는 항상 제외
const holidayCache = {};
function fetchHolidays(year) {
  if (holidayCache[year]) return holidayCache[year];
  const manualForYear = MANUAL_HOLIDAYS.filter((d) => d.startsWith(String(year)));
  const promise = fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/KR`)
    .then((res) => {
      if (!res.ok) throw new Error("holiday fetch failed");
      return res.json();
    })
    .then((list) => {
      const dates = list.map((h) => h.date).filter((d) => !isExcludedFakeHoliday(d));
      return new Set([...dates, ...manualForYear]);
    })
    .catch(() => {
      const base = year === 2026 ? FALLBACK_HOLIDAYS_2026 : new Set();
      return new Set([...base, ...manualForYear].filter((d) => !isExcludedFakeHoliday(d)));
    });
  holidayCache[year] = promise;
  return promise;
}

function getDayType(dateStr, holidaySet) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay(); // 0=일 6=토
  if ((holidaySet && holidaySet.has(dateStr)) || day === 0) return "휴일";
  if (day === 6) return "토요일";
  return "평일";
}

// 경산 전용: "3왕복"에 해당하는 교번(DIA) - 평일은 3d·6d, 토요일은 3d.
// 부담이 큰 근무라 기관사들끼리 가급적 휴가를 안 내기로 한 약속이 있어요 (강제는 아니고 안내만).
const THREE_ROUND_TRIP_CODES = { 평일: ["3d", "6d"], 토요일: ["3d"] };
function isThreeRoundTripCode(dateStr, dia, holidaySet) {
  const dayType = getDayType(dateStr, holidaySet);
  const codes = THREE_ROUND_TRIP_CODES[dayType];
  if (!codes) return false;
  return codes.includes(String(dia || "").trim());
}

const GUARANTEE_BY_BRANCH = {
  경산: { 평일: 4, 토요일: 5, 휴일: 7 },
  문양: { 평일: 5, 토요일: 7, 휴일: 8 },
};

// activeRecords: 취소 아닌 전체 기록 (비번 감지는 전체 기록 대상)
// branch: "경산" | "문양"
function gyeongsanCapacity(branch, dateStr, activeRecords, holidaySet) {
  const table = GUARANTEE_BY_BRANCH[branch] || GUARANTEE_BY_BRANCH["경산"];
  let base = table[getDayType(dateStr, holidaySet)];
  const hasOffDuty = activeRecords.some((r) => (r.dia || "").includes("비번"));
  if (hasOffDuty) base += 1;
  return base;
}

function gyeongsanColor(remain) {
  if (remain <= 0) return "#e02020";
  if (remain === 1) return "#f5a623";
  return "#1caa5c";
}

const TYPE_ICON = {
  // 보장인원 포함
  연차: "🏖️",
  연차비: "🏖️",
  분지: "🌴",
  분지비: "🌴",
  장재: "🛌",
  장재비: "🛌",
  지정교번휴무: "🗓️",
  검진공가: "🩺",
  연간지: "🌙",
  돌봄: "🏖️",
  // 보장인원 미포함 (휴충당)
  청휴: "🌿",
  청휴비: "🌿",
  "청휴(탈상)": "🕯️",
  병가: "🏥",
  병가비: "🏥",
  노조: "🤝",
  공란: "⬜",
  교육: "📚",
  출장: "🧳",
  "교휴(공휴)": "📅",
};

// 보장인원에 포함되지 않는(휴충당 처리) 휴가 종류
const NON_CAPACITY_TYPES = [
  "청휴", "청휴비", "청휴(탈상)", "병가", "병가비",
  "노조", "공란", "교육", "출장", "교휴(공휴)",
];

const modal = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.4)",
    display: "flex",
    alignItems: "flex-end",
    zIndex: 100,
  },
  sheet: {
    background: "#fff",
    width: "100%",
    maxWidth: "480px",
    margin: "0 auto",
    maxHeight: "85vh",
    overflowY: "auto",
    borderRadius: "20px 20px 0 0",
    padding: "20px",
  },
  dateTitle: { fontSize: "18px", fontWeight: 700, marginBottom: "4px" },
  countText: { fontSize: "14px", color: "#1a1a1a", fontWeight: 600, marginBottom: "16px" },
  card: {
    background: "#f8f9fb",
    borderRadius: "12px",
    padding: "12px 14px",
    marginBottom: "8px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cancelledCard: { opacity: 0.45, textDecoration: "line-through" },
  name: { fontSize: "15px", fontWeight: 700 },
  typeRow: { fontSize: "13px", color: "#1a1a1a", marginTop: "2px" },
  dia: { fontSize: "14px", fontWeight: 700, color: "#1b3a5c" },
  smallCancelBtn: {
    marginLeft: "10px",
    fontSize: "12px",
    color: "#e02020",
    background: "none",
    border: "none",
    textDecoration: "underline",
  },
  addBtn: {
    width: "100%",
    padding: "14px",
    marginTop: "8px",
    borderRadius: "12px",
    border: "none",
    background: "#1b3a5c",
    color: "#fff",
    fontSize: "15px",
    fontWeight: 700,
  },
  closeBtn: {
    width: "100%",
    padding: "14px",
    marginTop: "8px",
    borderRadius: "12px",
    border: "1px solid #ddd",
    background: "#fff",
    color: "#666",
    fontSize: "15px",
    fontWeight: 600,
  },
  formRow: { marginBottom: "14px" },
  label: { fontSize: "13px", color: "#666", marginBottom: "6px", display: "block" },
  input: {
    width: "100%",
    padding: "12px",
    fontSize: "15px",
    borderRadius: "10px",
    border: "1px solid #ddd",
  },
  typeChips: { display: "flex", flexWrap: "wrap", gap: "8px", marginTop: "8px" },
  chip: (active) => ({
    padding: "8px 14px",
    borderRadius: "999px",
    border: active ? "1px solid #1b3a5c" : "1px solid #ddd",
    background: active ? "#eaf1ff" : "#fff",
    color: active ? "#1b3a5c" : "#666",
    fontSize: "13px",
    fontWeight: 600,
  }),
};

const VACATION_TYPES = [...CAPACITY_TYPES, ...NON_CAPACITY_TYPES];

const tbl = {
  th: { padding: "5px 3px", textAlign: "center", fontSize: "11px", color: "#666", whiteSpace: "nowrap" },
  td: { padding: "6px 3px", textAlign: "center", verticalAlign: "top", fontSize: "13px", whiteSpace: "nowrap" },
};

function pad2(n) {
  return String(n).padStart(2, "0");
}

