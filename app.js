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
function MainScreen({ currentUser, employees, managers, onSwitchUser }) {
  const isAdmin = ADMIN_NAMES.includes(currentUser.name);
  const isMidManager = isMidManagerUser(currentUser, managers);
  const [showAdmin, setShowAdmin] = useState(false);
  const [showManagerAdmin, setShowManagerAdmin] = useState(false);
  const [showImportTest, setShowImportTest] = useState(false);
  const [showMyVacations, setShowMyVacations] = useState(false);
  const [showEtiquetteNotice, setShowEtiquetteNotice] = useState(true); // 로그인할 때마다 한 번 안내
  const myCode = (employees || []).find((e) => e.id === currentUser.id)?.code || "";
  const myBaseCode = (employees || []).find((e) => e.id === currentUser.id)?.baseCode || "";
  const myTeamKey = REVERSE_TEAM_MAP[currentUser.branch];
  const myOrder = GYOBUN_ORDER[myTeamKey] || [];

  // "대신 기록" DIA 드롭다운용 - 교번틀 코드 목록 (자기 소속 기준)
  const managerBranchEmployees = (employees || []).filter((e) => e.branch === currentUser.branch);
  const managerTemplateCodes = myOrder.filter((c) => managerBranchEmployees.some((e) => e.code === c));
  const managerOtherCodes = [...new Set(managerBranchEmployees.map((e) => e.code))].filter(
    (c) => !managerTemplateCodes.includes(c)
  );
  const managerBranchCodes = [...managerTemplateCodes, ...managerOtherCodes];

  // 특정 날짜의 본인 교번을 계산 (기준일 대비 날짜차이만큼 교번틀을 밀어서)
  const codeForDate = (dateStr) => {
    if (!BASE_DATE || !myBaseCode || !myOrder.length) return "";
    const offset = diffDays_(BASE_DATE, dateStr);
    return shiftCodeByDays_(myOrder, myBaseCode, offset);
  };
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth()); // 0-indexed
  const [monthMap, setMonthMap] = useState({}); // { "YYYY-MM-DD": [records] }
  const [loading, setLoading] = useState(true);
  const [holidaySet, setHolidaySet] = useState(new Set());
  const [selectedDate, setSelectedDate] = useState(null); // 모달용
  const [showRegisterForm, setShowRegisterForm] = useState(false);
  const [formType, setFormType] = useState(VACATION_TYPES[0]);
  const [formDia, setFormDia] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingPriorityId, setEditingPriorityId] = useState(null); // 순번 수정 중인 기록 id
  const [priorityInput, setPriorityInput] = useState("");
  const [editingNoteId, setEditingNoteId] = useState(null); // 비고 수정 중인 기록 id
  const [noteInput, setNoteInput] = useState("");

  // 중간관리자 - 대신 기록 폼 상태
  const [showManagerForm, setShowManagerForm] = useState(false);
  const [managerTargetId, setManagerTargetId] = useState("");
  const [managerFormType, setManagerFormType] = useState(NON_CAPACITY_TYPES[0]);
  const [managerFormDia, setManagerFormDia] = useState("");
  const [managerFormNote, setManagerFormNote] = useState("");
  const [managerSaving, setManagerSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchHolidays(viewYear).then((set) => {
      if (!cancelled) setHolidaySet(set);
    });
    return () => { cancelled = true; };
  }, [viewYear]);

  // 수동 새로고침용 (저장/취소/확인 등 액션 직후 즉시 반영하고 싶을 때 호출)
  const loadMonth = useCallback((y, m) => {
    setLoading(true);
    const start = `${y}-${pad2(m + 1)}-01`;
    const lastDay = new Date(y, m + 1, 0).getDate();
    const end = `${y}-${pad2(m + 1)}-${pad2(lastDay)}`;
    waitForFirestore()
      .then(() => window.VacationAPI.getByRange(start, end))
      .then((list) => {
        const map = {};
        list.forEach((v) => {
          if (!map[v.date]) map[v.date] = [];
          map[v.date].push(v);
        });
        Object.values(map).forEach((arr) =>
          arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        );
        setMonthMap(map);
      })
      .catch((err) => {
        console.error(err);
        alert("데이터를 불러오지 못했어요: " + (err && err.message ? err.message : err));
      })
      .finally(() => setLoading(false));
  }, []);

  // 보고 있는 달의 데이터를 실시간으로 구독 - 다른 사람이 신청/취소/확인하면 화면이 자동으로 갱신돼요
  useEffect(() => {
    let unsubscribe = null;
    let cancelled = false;
    setLoading(true);
    const start = `${viewYear}-${pad2(viewMonth + 1)}-01`;
    const lastDay = new Date(viewYear, viewMonth + 1, 0).getDate();
    const end = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(lastDay)}`;

    waitForFirestore().then(() => {
      if (cancelled) return;
      unsubscribe = window.VacationAPI.subscribeRange(start, end, (list) => {
        const map = {};
        list.forEach((v) => {
          if (!map[v.date]) map[v.date] = [];
          map[v.date].push(v);
        });
        Object.values(map).forEach((arr) =>
          arr.sort((a, b) => (a.name || "").localeCompare(b.name || ""))
        );
        setMonthMap(map);
        setLoading(false);
      });
    });

    return () => {
      cancelled = true;
      if (unsubscribe) unsubscribe();
    };
  }, [viewYear, viewMonth]);

  const changeMonth = (delta) => {
    let y = viewYear;
    let m = viewMonth + delta;
    if (m < 0) { m = 11; y -= 1; }
    if (m > 11) { m = 0; y += 1; }
    setViewYear(y);
    setViewMonth(m);
  };

  const firstWeekday = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const todayKey = todayStr();

  const cells = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const openDate = (d) => {
    const key = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
    setSelectedDate(key);
    setShowRegisterForm(false);
    setShowManagerForm(false);
    setFormType(VACATION_TYPES[0]);
    setFormDia(codeForDate(key)); // 선택한 날짜의 실제 교번 (기준일 대비 계산, 수정 가능)
    window.history.pushState({ modal: true }, "");
  };

  // 날짜 모달/사이드 패널(내 휴가현황·승인 관리·운용 인원·가져오기 테스트) 공통으로 쓰는 닫기 함수.
  // 뒤로가기 버튼을 눌러도 popstate 핸들러가 똑같이 처리해서, 항상 달력 화면으로 돌아가요.
  const closeModal = () => {
    if (selectedDate || showAdmin || showManagerAdmin || showImportTest || showMyVacations) {
      window.history.back();
    }
  };

  // 사이드 패널을 열 때 히스토리를 하나 쌓아서, 뒤로가기 시 popstate로 자동 닫히게 함
  const openPanel = (setter) => {
    window.history.pushState({ modal: true }, "");
    setter(true);
  };

  // 안드로이드/브라우저 뒤로가기 버튼을 누르면 앱을 나가는 대신 모달/패널만 닫히도록 처리
  useEffect(() => {
    const handlePopState = () => {
      setSelectedDate(null);
      setShowRegisterForm(false);
      setShowManagerForm(false);
      setShowAdmin(false);
      setShowManagerAdmin(false);
      setShowImportTest(false);
      setShowMyVacations(false);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const dayRecords = selectedDate
    ? (monthMap[selectedDate] || []).filter((v) => v.branch === currentUser.branch)
    : [];
  // 보장휴가(연차·분지 등)를 순번(priority) 순서로 먼저 보여주고, 미보장(청휴·병가·노조 등)은 그 아래로
  const sortedDayRecords = [...dayRecords].sort((a, b) => {
    const groupA = isCapacityType(a.vacationType) ? 0 : 1;
    const groupB = isCapacityType(b.vacationType) ? 0 : 1;
    if (groupA !== groupB) return groupA - groupB;
    const pa = a.priority != null ? a.priority : Infinity;
    const pb = b.priority != null ? b.priority : Infinity;
    if (pa !== pb) return pa - pb;
    return (a.name || "").localeCompare(b.name || "");
  });
  const activeRecordsForCapacity = dayRecords.filter((v) => v.status !== "취소됨");
  const activeCount = activeRecordsForCapacity.length;
  const capacityCount = activeRecordsForCapacity.filter((v) => isCapacityType(v.vacationType)).length;
  const gyeongsanInfo = selectedDate
    ? (() => {
        const capacity = gyeongsanCapacity(currentUser.branch, selectedDate, activeRecordsForCapacity, holidaySet);
        const remain = capacity - capacityCount;
        return { capacity, remain, capacityCount };
      })()
    : null;

  const handleCancel = (record) => {
    if (!confirm(`${record.name}님의 ${record.vacationType} 기록을 취소할까요?`)) return;
    window.VacationAPI.cancel(record.id).then(() => {
      loadMonth(viewYear, viewMonth);
      // 모달 내 목록도 즉시 갱신
      setMonthMap((prev) => {
        const next = { ...prev };
        next[selectedDate] = (next[selectedDate] || []).map((v) =>
          v.id === record.id ? { ...v, status: "취소됨" } : v
        );
        return next;
      });
    });
  };

  // 짝수달 1일 선착순 신청 순번 수정 (본인이 그날 신청한 기록만, 그날 하루만 가능)
  const handleStartPriorityEdit = (record) => {
    setEditingPriorityId(record.id);
    setPriorityInput(String(record.priority != null ? record.priority : ""));
  };

  const handleSavePriorityEdit = (record) => {
    const num = parseInt(priorityInput, 10);
    if (Number.isNaN(num) || num < 1) {
      alert("1 이상의 숫자를 입력해주세요");
      return;
    }
    window.VacationAPI.update(record.id, { priority: num })
      .then(() => {
        setMonthMap((prev) => {
          const next = { ...prev };
          next[selectedDate] = (next[selectedDate] || []).map((v) =>
            v.id === record.id ? { ...v, priority: num } : v
          );
          return next;
        });
        setEditingPriorityId(null);
      })
      .catch((err) => alert("수정 실패: " + (err && err.message ? err.message : err)));
  };

  // 이미 등록된 기록에 나중에 비고(메모)를 추가/수정 - 운용(중간관리자)만
  const handleStartNoteEdit = (record) => {
    setEditingNoteId(record.id);
    setNoteInput(record.note || "");
  };

  const handleSaveNoteEdit = (record) => {
    const trimmed = noteInput.trim();
    window.VacationAPI.update(record.id, { note: trimmed })
      .then(() => {
        setMonthMap((prev) => {
          const next = { ...prev };
          next[selectedDate] = (next[selectedDate] || []).map((v) =>
            v.id === record.id ? { ...v, note: trimmed } : v
          );
          return next;
        });
        setEditingNoteId(null);
      })
      .catch((err) => alert("메모 저장 실패: " + (err && err.message ? err.message : err)));
  };

  const handleAdminDelete = (record) => {
    if (!confirm(`[관리자] ${record.name}님의 ${record.vacationType} 기록을 완전히 삭제할까요?\n되돌릴 수 없어요.`)) return;
    window.VacationAPI.remove(record.id).then(() => {
      setMonthMap((prev) => {
        const next = { ...prev };
        next[selectedDate] = (next[selectedDate] || []).filter((v) => v.id !== record.id);
        return next;
      });
    });
  };

  const submitVacationRecord = (priority) => {
    const docId = `${currentUser.id}_${selectedDate}`; // 직원ID_날짜 고정 ID - 중복 신청 원천 차단
    window.VacationAPI.addOnce(docId, {
      name: currentUser.name,
      branch: currentUser.branch,
      employeeId: currentUser.id,
      vacationType: formType,
      dia: formDia.trim(),
      date: selectedDate,
      ...(priority != null ? { priority } : {}),
    })
      .then(() => {
        setShowRegisterForm(false);
        setFormDia("");
        loadMonth(viewYear, viewMonth);
      })
      .catch((err) => {
        console.error(err);
        alert("등록에 실패했어요: " + (err && err.message ? err.message : err));
      })
      .finally(() => setSaving(false));
  };

  const handleSubmitRegister = () => {
    setSaving(true);
    // 저장 시점에 그날의 최신 데이터로 중복신청 여부와 보장인원 정원을 다시 확인해요
    // (동시 신청으로 인한 중복/초과 방지).
    waitForFirestore()
      .then(() => window.VacationAPI.getByDate(selectedDate))
      .then((freshDayRecords) => {
        const freshActive = (freshDayRecords || []).filter(
          (v) => v.branch === currentUser.branch && v.status !== "취소됨"
        );

        const alreadyMine = freshActive.some((v) => v.employeeId === currentUser.id);
        if (alreadyMine) {
          setSaving(false);
          alert("이미 이 날짜에 신청하신 기록이 있어요. 화면을 새로고침할게요.");
          loadMonth(viewYear, viewMonth);
          setShowRegisterForm(false);
          return;
        }

        const freshCapacityCount = freshActive.filter((v) => isCapacityType(v.vacationType)).length;
        const capacity = gyeongsanCapacity(currentUser.branch, selectedDate, freshActive, holidaySet);

        if (freshCapacityCount >= capacity) {
          setSaving(false);
          alert(
            `앗, 방금 다른 분이 신청해서 이 날짜의 보장인원(${capacity}명)이 다 찼어요. 다른 날짜를 선택해주세요.`
          );
          loadMonth(viewYear, viewMonth); // 화면도 최신 상태로 갱신
          setShowRegisterForm(false);
          return;
        }

        // 순번(짝수달 1일 선착순 신청용) - 그 날짜 보장휴가 기록 수(취소 포함) 다음 번호로 자동 부여
        const priorityBase = (freshDayRecords || []).filter(
          (v) => v.branch === currentUser.branch && isCapacityType(v.vacationType)
        ).length;
        const nextPriority =
          currentUser.branch === "경산" && isCapacityType(formType) ? priorityBase + 1 : null;

        submitVacationRecord(nextPriority);
      })
      .catch((err) => {
        console.error(err);
        setSaving(false);
        alert("확인 중 오류가 발생했어요: " + (err && err.message ? err.message : err));
      });
  };

  // 중간관리자 확인 도장
  const handleConfirmStamp = (record) => {
    window.VacationAPI.confirm(record.id, currentUser.name).then(() => {
      setMonthMap((prev) => {
        const next = { ...prev };
        next[selectedDate] = (next[selectedDate] || []).map((v) =>
          v.id === record.id ? { ...v, confirmedBy: currentUser.name } : v
        );
        return next;
      });
    });
  };

  // 중간관리자 - 대신 기록 폼 열기
  const openManagerForm = () => {
    setManagerTargetId("");
    setManagerFormType(NON_CAPACITY_TYPES[0]);
    setManagerFormDia("");
    setManagerFormNote("");
    setShowManagerForm(true);
  };

  const branchAllEmployees = employees.filter((e) => e.branch === currentUser.branch);

  const handleSubmitManagerRecord = () => {
    const target = branchAllEmployees.find((e) => e.id === managerTargetId);
    if (!target) {
      alert("대상자를 선택해주세요");
      return;
    }
    if (!managerFormDia.trim()) {
      alert("DIA를 입력해주세요");
      return;
    }
    setManagerSaving(true);
    window.VacationAPI.add({
      name: target.name,
      branch: target.branch,
      employeeId: target.id,
      vacationType: managerFormType,
      dia: managerFormDia.trim(),
      date: selectedDate,
      recordedBy: currentUser.name,
      ...(managerFormNote.trim() ? { note: managerFormNote.trim() } : {}),
    })
      .then(() => {
        setShowManagerForm(false);
        loadMonth(viewYear, viewMonth);
      })
      .catch((err) => {
        console.error(err);
        alert("등록에 실패했어요: " + (err && err.message ? err.message : err));
      })
      .finally(() => setManagerSaving(false));
  };

  const touchStartX = useRef(null);
  const gridRef = useRef(null);
  const [slideX, setSlideX] = useState(0);
  const [slideTransition, setSlideTransition] = useState(false);

  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
    setSlideTransition(false);
  };
  const handleTouchMove = (e) => {
    if (touchStartX.current == null) return;
    setSlideX(e.touches[0].clientX - touchStartX.current);
  };
  const handleTouchEnd = () => {
    if (touchStartX.current == null) return;
    const dx = slideX;
    touchStartX.current = null;
    const width = gridRef.current ? gridRef.current.offsetWidth : 320;

    if (Math.abs(dx) > 60) {
      const dir = dx < 0 ? 1 : -1; // dir 1 = 다음달(왼쪽으로 스와이프), -1 = 이전달
      setSlideTransition(true);
      setSlideX(-dir * width); // 현재 페이지가 화면 밖으로 완전히 빠져나감
      setTimeout(() => {
        changeMonth(dir);
        setSlideTransition(false);
        setSlideX(dir * width); // 다음 페이지를 반대편 화면 밖에 미리 배치
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setSlideTransition(true);
            setSlideX(0); // 화면 안으로 슬라이드 인
          });
        });
      }, 220);
    } else {
      setSlideTransition(true);
      setSlideX(0);
    }
  };

  return (
    <div style={cal.wrap}>
      <div style={cal.header}>
        <div style={cal.headerTop}>
          <div style={{ display: "flex", alignItems: "center" }}>
            <div style={cal.userName}>{currentUser?.name}님</div>
            {isMidManager && (
              <button style={cal.switchUserBtn} onClick={onSwitchUser}>전환</button>
            )}
          </div>
          <div style={cal.headerBtnRow}>
            {!isMidManager && (
              <button style={adminStyles.adminBtn} onClick={() => openPanel(setShowMyVacations)}>
                내 휴가현황
              </button>
            )}
            {isAdmin && (
              <button style={adminStyles.adminBtn} onClick={() => openPanel(setShowAdmin)}>승인 관리</button>
            )}
            {isAdmin && (
              <button style={adminStyles.adminBtn} onClick={() => openPanel(setShowManagerAdmin)}>
                운용 인원
              </button>
            )}
            {isAdmin && TEST_MODE && (
              <button style={adminStyles.adminBtn} onClick={() => openPanel(setShowImportTest)}>
                가져오기 테스트
              </button>
            )}
          </div>
        </div>
        <div style={cal.navRow}>
          <button style={cal.navBtn} onClick={() => changeMonth(-1)}>‹</button>
          <div style={cal.monthTitle}>{viewYear}년 {viewMonth + 1}월</div>
          <button style={cal.navBtn} onClick={() => changeMonth(1)}>›</button>
        </div>
        <div style={cal.weekRow}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} style={{ color: i === 0 ? "#ff8a80" : i === 6 ? "#8ecdff" : "#c9d4de" }}>
              {w}
            </div>
          ))}
        </div>
        <div style={cal.railDivider} />
      </div>

      <div
        style={{ overflow: "hidden", width: "100%" }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          ref={gridRef}
          style={{
            ...cal.grid,
            transform: `translateX(${slideX}px)`,
            transition: slideTransition ? "transform 220ms ease" : "none",
          }}
        >
        {cells.map((d, i) => {
          if (d === null) return <div key={i} style={cal.emptyCell} />;
          const key = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
          const dayType = getDayType(key, holidaySet);
          const branchRecords = (monthMap[key] || []).filter((v) => v.branch === currentUser.branch);
          const activeRecords = branchRecords.filter((v) => v.status !== "취소됨");
          const capacityCount = activeRecords.filter((v) => isCapacityType(v.vacationType)).length;

          const capacity = gyeongsanCapacity(currentUser.branch, key, activeRecords, holidaySet);
          const remain = capacity - capacityCount;
          const badge = <div style={cal.dayBadge(gyeongsanColor(remain))}>{activeRecords.length}</div>;

          return (
            <div key={i} style={cal.dayCell(key === todayKey)} onClick={() => openDate(d)}>
              <div style={cal.dayNum(dayType)}>{d}</div>
              <div style={cal.dayDivider} />
              <div style={cal.dayCode}>{codeForDate(key)}</div>
              {badge}
            </div>
          );
        })}
        </div>
      </div>

      {loading && <div style={{ textAlign: "center", color: "#aaa", padding: "10px" }}>불러오는 중...</div>}

      {selectedDate && (
        <div style={modal.overlay} onClick={closeModal}>
          <div style={modal.sheet} onClick={(e) => e.stopPropagation()}>
            {showManagerForm ? (
              <React.Fragment>
                <div style={modal.dateTitle}>{formatDateHeader(selectedDate)} 대신 기록</div>
                <div style={{ ...modal.countText, marginBottom: "20px" }}>중간관리자({currentUser.name}) 기록</div>

                <div style={modal.formRow}>
                  <label style={modal.label}>대상자</label>
                  <select
                    style={modal.input}
                    value={managerTargetId}
                    onChange={(e) => setManagerTargetId(e.target.value)}
                  >
                    <option value="">이름 선택</option>
                    {[...branchAllEmployees]
                      .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                      .map((emp) => (
                        <option key={emp.id} value={emp.id}>{emp.name}</option>
                      ))}
                  </select>
                </div>

                <div style={modal.formRow}>
                  <label style={modal.label}>휴가명</label>
                  <select
                    style={modal.input}
                    value={managerFormType}
                    onChange={(e) => setManagerFormType(e.target.value)}
                  >
                    <optgroup label="⚪ 보장인원 미포함">
                      {NON_CAPACITY_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </optgroup>
                    <optgroup label="🟢 보장인원 포함">
                      {CAPACITY_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </optgroup>
                  </select>
                </div>

                <div style={modal.formRow}>
                  <label style={modal.label}>DIA</label>
                  <select
                    style={modal.input}
                    value={managerFormDia}
                    onChange={(e) => setManagerFormDia(e.target.value)}
                  >
                    <option value="">교번을 선택해주세요</option>
                    {managerBranchCodes.map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div style={modal.formRow}>
                  <label style={modal.label}>비고 (선택)</label>
                  <input
                    style={modal.input}
                    value={managerFormNote}
                    onChange={(e) => setManagerFormNote(e.target.value)}
                    placeholder="예: 제8차 재직자 보수교육(7.20~7.22)"
                  />
                </div>

                <button style={modal.addBtn} onClick={handleSubmitManagerRecord} disabled={managerSaving}>
                  {managerSaving ? "저장 중..." : "저장"}
                </button>
                <button style={modal.closeBtn} onClick={() => setShowManagerForm(false)}>취소</button>
              </React.Fragment>
            ) : showRegisterForm ? (
              <React.Fragment>
                <div style={modal.dateTitle}>{formatDateHeader(selectedDate)} 휴가 신청</div>
                <div style={{ ...modal.countText, marginBottom: "20px" }}>{currentUser.name}님 이름으로 등록돼요</div>

                <div style={modal.formRow}>
                  <label style={modal.label}>휴가명</label>
                  <select
                    style={modal.input}
                    value={formType}
                    onChange={(e) => setFormType(e.target.value)}
                  >
                    <optgroup label="🟢 보장인원 포함">
                      {CAPACITY_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </optgroup>
                    <optgroup label="⚪ 보장인원 미포함">
                      <option value="청휴">청휴</option>
                    </optgroup>
                  </select>
                  <div style={{ fontSize: "12px", marginTop: "6px", color: "#888" }}>
                    병가·교육 등은 중간관리자가 대신 기록해요
                  </div>
                </div>

                <div style={modal.formRow}>
                  <label style={modal.label}>DIA</label>
                  <input
                    style={modal.input}
                    value={formDia}
                    onChange={(e) => setFormDia(e.target.value)}
                    placeholder="예: 22, 대1, 27~"
                  />
                </div>

                <button style={modal.addBtn} onClick={handleSubmitRegister} disabled={saving}>
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button style={modal.closeBtn} onClick={() => setShowRegisterForm(false)}>취소</button>
              </React.Fragment>
            ) : (
              <React.Fragment>
                <div style={modal.dateTitle}>{formatDateHeader(selectedDate)}</div>
                <div style={modal.countText}>
                  휴가자 {activeCount}명
                  {gyeongsanInfo &&
                    ` · 보장대상 ${gyeongsanInfo.capacityCount}/${gyeongsanInfo.capacity}명 (여유 ${gyeongsanInfo.remain}명)`}
                </div>

                {dayRecords.length === 0 && (
                  <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>
                    등록된 휴가가 없어요
                  </div>
                )}
                {dayRecords.length > 0 && (
                  <div style={{ overflowX: "auto", marginBottom: "12px" }}>
                    <table style={{ width: "max-content", minWidth: "100%", borderCollapse: "collapse", fontSize: "13px" }}>
                      <thead>
                        <tr style={{ borderBottom: "2px solid #333" }}>
                          <th style={tbl.th}>#</th>
                          <th style={{ ...tbl.th, textAlign: "left" }}>이름</th>
                          <th style={{ ...tbl.th, textAlign: "left" }}>휴가명</th>
                          <th style={tbl.th}>DIA</th>
                          <th style={{ ...tbl.th, textAlign: "left" }}>확인</th>
                          <th style={tbl.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedDayRecords.map((v, idx) => {
                          const cancelled = v.status === "취소됨";
                          const cap = isCapacityType(v.vacationType);
                          const prevCap = idx > 0 ? isCapacityType(sortedDayRecords[idx - 1].vacationType) : null;
                          const showGroupHeader = idx === 0 || cap !== prevCap;
                          const canEditPriority =
                            currentUser.branch === "경산" &&
                            !cancelled &&
                            v.employeeId === currentUser.id &&
                            isCapacityType(v.vacationType) &&
                            v.createdAt &&
                            formatEntryDateOnly(v.createdAt) === koreaTodayStr() &&
                            isEvenMonthFirstDay();
                          return (
                            <React.Fragment key={v.id}>
                              {showGroupHeader && (
                                <tr>
                                  <td
                                    colSpan={6}
                                    style={{
                                      padding: "10px 4px 6px",
                                      fontSize: "15px",
                                      fontWeight: 800,
                                      color: cap ? "#1b3a5c" : "#666",
                                      background: cap ? "#eaf1ff" : "#f2f2f2",
                                      borderBottom: "1px solid #ddd",
                                    }}
                                  >
                                    {cap ? "🟢 보장휴가" : "⚪ 보장휴가 미포함"}
                                  </td>
                                </tr>
                              )}
                              <tr
                                style={{
                                  borderBottom: "1px solid #eee",
                                  opacity: cancelled ? 0.45 : 1,
                                  textDecoration: cancelled ? "line-through" : "none",
                                }}
                              >
                              <td style={tbl.td}>
                                {editingPriorityId === v.id ? (
                                  <div style={{ display: "flex", gap: "2px", alignItems: "center" }}>
                                    <input
                                      type="number"
                                      value={priorityInput}
                                      onChange={(e) => setPriorityInput(e.target.value)}
                                      style={{ width: "36px", fontSize: "12px", padding: "2px" }}
                                    />
                                    <button
                                      style={{ ...modal.smallCancelBtn, margin: 0, color: "#1b3a5c" }}
                                      onClick={() => handleSavePriorityEdit(v)}
                                    >
                                      ✓
                                    </button>
                                  </div>
                                ) : canEditPriority ? (
                                  <span
                                    style={{ textDecoration: "underline", cursor: "pointer", color: "#1b3a5c" }}
                                    onClick={() => handleStartPriorityEdit(v)}
                                  >
                                    {v.priority != null ? v.priority : idx + 1}✏️
                                  </span>
                                ) : (
                                  v.priority != null ? v.priority : idx + 1
                                )}
                              </td>
                              <td style={{ ...tbl.td, textAlign: "left" }}>
                                <div style={{ fontWeight: 700, fontSize: "13px" }}>
                                  {TYPE_ICON[v.vacationType] || "📌"} {v.name}
                                </div>
                                {v.createdAt && (
                                  <div style={{ fontSize: "12px", color: "#333" }}>
                                    {formatEntryTime(v.createdAt)}
                                  </div>
                                )}
                              </td>
                              <td style={{ ...tbl.td, textAlign: "left" }}>
                                {v.vacationType}
                              </td>
                              <td style={{ ...tbl.td, fontWeight: 700, color: "#1b3a5c" }}>{v.dia}</td>
                              <td style={{ ...tbl.td, textAlign: "left" }}>
                                {cancelled ? (
                                  "-"
                                ) : v.confirmedBy ? (
                                  <span style={{ color: "#1caa5c" }}>✅{v.confirmedBy}</span>
                                ) : isMidManager ? (
                                  <button
                                    style={{ ...modal.smallCancelBtn, color: "#1b3a5c", margin: 0 }}
                                    onClick={() => handleConfirmStamp(v)}
                                  >
                                    확인
                                  </button>
                                ) : (
                                  <span style={{ color: "#ccc" }}>대기중</span>
                                )}
                              </td>
                              <td style={tbl.td}>
                                {!cancelled && v.employeeId === currentUser.id && !v.confirmedBy && (
                                  <button style={{ ...modal.smallCancelBtn, margin: 0 }} onClick={() => handleCancel(v)}>
                                    취소
                                  </button>
                                )}
                                {!cancelled && isMidManager && v.employeeId !== currentUser.id && (
                                  <button style={{ ...modal.smallCancelBtn, margin: 0 }} onClick={() => handleCancel(v)}>
                                    취소
                                  </button>
                                )}
                                {!cancelled && isMidManager && v.recordedBy === currentUser.name && (
                                  <button
                                    style={{ ...modal.smallCancelBtn, color: "#e02020", margin: 0 }}
                                    onClick={() => handleAdminDelete(v)}
                                  >
                                    삭제
                                  </button>
                                )}
                                {isAdmin && (
                                  <button
                                    style={{ ...modal.smallCancelBtn, color: "#999", margin: 0 }}
                                    onClick={() => handleAdminDelete(v)}
                                  >
                                    🗑
                                  </button>
                                )}
                              </td>
                            </tr>
                            {!cap && (v.note || editingNoteId === v.id || (isMidManager && !cancelled)) && (
                              <tr style={{ borderBottom: "1px solid #eee" }}>
                                <td></td>
                                <td colSpan={5} style={{ padding: "0 3px 6px", fontSize: "11px" }}>
                                  {editingNoteId === v.id ? (
                                    <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
                                      <input
                                        value={noteInput}
                                        onChange={(e) => setNoteInput(e.target.value)}
                                        placeholder="비고 메모"
                                        style={{ flex: 1, fontSize: "12px", padding: "3px 6px" }}
                                      />
                                      <button
                                        style={{ ...modal.smallCancelBtn, margin: 0, color: "#1b3a5c" }}
                                        onClick={() => handleSaveNoteEdit(v)}
                                      >
                                        ✓
                                      </button>
                                    </div>
                                  ) : (
                                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                      {v.note && <span style={{ color: "#999" }}>📝 {v.note}</span>}
                                      {isMidManager && !cancelled && (
                                        <span
                                          style={{ color: "#1b3a5c", textDecoration: "underline", cursor: "pointer" }}
                                          onClick={() => handleStartNoteEdit(v)}
                                        >
                                          {v.note ? "메모수정" : "+메모"}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {!isMidManager && (
                  dayRecords.some((v) => v.employeeId === currentUser.id && v.status !== "취소됨") ? (
                    <div style={{ textAlign: "center", color: "#999", fontSize: "13px", padding: "10px 0" }}>
                      이미 이 날짜에 신청하셨어요
                    </div>
                  ) : gyeongsanInfo && gyeongsanInfo.remain <= 0 ? (
                    <div style={{ textAlign: "center", color: "#e02020", fontSize: "13px", padding: "10px 0" }}>
                      이 날짜는 보장인원이 다 찼어요 (여유 0명)
                    </div>
                  ) : (
                    <button style={modal.addBtn} onClick={() => setShowRegisterForm(true)}>
                      + 휴가 신청
                    </button>
                  )
                )}
                {isMidManager && (
                  <button style={{ ...modal.addBtn, background: "#1a73e8" }} onClick={openManagerForm}>
                    + 대신 기록 (병가·청휴·교육 등)
                  </button>
                )}
                <button style={modal.closeBtn} onClick={closeModal}>닫기</button>
              </React.Fragment>
            )}
          </div>
        </div>
      )}

      {showAdmin && <AdminPanel onClose={closeModal} employees={employees} managers={managers} />}
      {showManagerAdmin && (
        <ManagerAdminPanel branch={currentUser.branch} onClose={closeModal} />
      )}
      {showImportTest && (
        <ImportTestPanel onClose={closeModal} employees={employees} managers={managers} />
      )}
      {showMyVacations && (
        <MyVacationsPanel currentUser={currentUser} onClose={closeModal} employees={employees} />
      )}
      {showEtiquetteNotice && (
        <div style={{ ...modal.overlay, alignItems: "center", justifyContent: "center" }}>
          <div style={{ ...modal.sheet, maxWidth: "340px", borderRadius: "16px", textAlign: "center" }}>
            <div style={{ fontSize: "26px", marginBottom: "10px" }}>🙏</div>
            <div style={{ fontSize: "15px", fontWeight: 600, lineHeight: 1.5, marginBottom: "18px" }}>
              휴가 자리는 여러 사람이 함께 쓰는 만큼, 서로 배려하는 마음으로 신청·취소는 신중하게 부탁드려요^^
            </div>
            <button style={modal.closeBtn} onClick={() => setShowEtiquetteNotice(false)}>확인</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 관리자 승인 패널 (관리자 이름으로 로그인했을 때만 버튼 노출)             */
/* ------------------------------------------------------------------ */
// 관리자로 지정할 이름 목록. 나중에 관리자가 바뀌면 여기 이름만 수정/추가하면 돼요.
const ADMIN_NAMES = ["권재림"];

const adminStyles = {
  approveBtn: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#1caa5c",
    color: "#fff",
    fontWeight: 700,
    fontSize: "13px",
  },
  rejectBtn: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#e02020",
    color: "#fff",
    fontWeight: 700,
    fontSize: "13px",
  },
  adminBtn: {
    padding: "5px 8px",
    borderRadius: "7px",
    border: "1px solid #ddd",
    background: "#fff",
    color: "#1b3a5c",
    fontWeight: 700,
    fontSize: "11px",
    whiteSpace: "nowrap",
    flexShrink: 0,
  },
  tabBtn: {
    flex: 1,
    padding: "9px 0",
    borderRadius: "8px",
    border: "1px solid #ddd",
    background: "#fff",
    color: "#888",
    fontWeight: 700,
    fontSize: "13px",
  },
  tabBtnActive: {
    flex: 1,
    padding: "9px 0",
    borderRadius: "8px",
    border: "1px solid #1b3a5c",
    background: "#1b3a5c",
    color: "#fff",
    fontWeight: 700,
    fontSize: "13px",
  },
  resetBtn: {
    padding: "8px 14px",
    borderRadius: "8px",
    border: "none",
    background: "#e08a20",
    color: "#fff",
    fontWeight: 700,
    fontSize: "13px",
  },
};
function MyVacationsPanel({ currentUser, onClose, employees }) {
  const [list, setList] = useState([]);
  const [yearStats, setYearStats] = useState([]); // 올해 종류별 보장휴가 사용 개수
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null); // 휴가종류 수정 중인 기록 id
  const [editType, setEditType] = useState("");
  const [editDia, setEditDia] = useState("");
  const [editSaving, setEditSaving] = useState(false);

  // 교번틀 드롭다운용 - 본인 소속의 교번 코드 목록 (오타 방지)
  const myTeamKey = REVERSE_TEAM_MAP[currentUser.branch];
  const myOrder = GYOBUN_ORDER[myTeamKey] || [];
  const branchEmployees = (employees || []).filter((e) => e.branch === currentUser.branch);
  const templateCodes = myOrder.filter((c) => branchEmployees.some((e) => e.code === c));
  const otherCodes = [...new Set(branchEmployees.map((e) => e.code))].filter(
    (c) => !templateCodes.includes(c)
  );
  const branchCodes = [...templateCodes, ...otherCodes];

  const load = () => {
    setLoading(true);
    waitForFirestore()
      .then(() => window.VacationAPI.getMine(currentUser.id))
      .then((records) => {
        const today = todayStr();
        const upcoming = records
          .filter((v) => v.date >= today)
          .sort((a, b) => a.date.localeCompare(b.date));
        setList(upcoming);

        // 올해(1월 1일부터) 보장휴가만, 취소되지 않은 것만 종류별로 집계
        // 단, 연차비/분지비/장재비는 야간근무 시 다음날에 같이 기록되는 것일 뿐 실제 사용 개수는 아니라서 집계에서 제외해요
        const currentYear = today.slice(0, 4);
        const NIGHT_SHIFT_COMPANION_TYPES = ["연차비", "분지비", "장재비"];
        const counts = {};
        records
          .filter(
            (v) =>
              v.date.startsWith(currentYear) &&
              v.status !== "취소됨" &&
              isCapacityType(v.vacationType) &&
              !NIGHT_SHIFT_COMPANION_TYPES.includes(v.vacationType)
          )
          .forEach((v) => {
            counts[v.vacationType] = (counts[v.vacationType] || 0) + 1;
          });
        const stats = CAPACITY_TYPES.filter((t) => counts[t]).map((t) => ({ type: t, count: counts[t] }));
        setYearStats(stats);
      })
      .catch((err) => alert("불러오기 실패: " + (err && err.message ? err.message : err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleCancelMine = (record) => {
    if (!confirm(`${record.date} ${record.vacationType} 기록을 취소할까요?`)) return;
    window.VacationAPI.cancel(record.id).then(() => {
      setList((prev) => prev.map((v) => (v.id === record.id ? { ...v, status: "취소됨" } : v)));
    });
  };

  const handleStartEdit = (record) => {
    setEditingId(record.id);
    setEditType(record.vacationType);
    setEditDia(record.dia || "");
  };

  const handleSaveTypeEdit = (record) => {
    if (editType === record.vacationType && editDia === (record.dia || "")) {
      setEditingId(null);
      return;
    }
    setEditSaving(true);
    window.VacationAPI.update(record.id, { vacationType: editType, dia: editDia.trim() })
      .then(() => {
        setList((prev) =>
          prev.map((v) => (v.id === record.id ? { ...v, vacationType: editType, dia: editDia.trim() } : v))
        );
        setEditingId(null);
      })
      .catch((err) => alert("수정 실패: " + (err && err.message ? err.message : err)))
      .finally(() => setEditSaving(false));
  };

  const currentYear = todayStr().slice(0, 4);

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={modal.dateTitle}>{currentUser.name}님의 예정된 휴가</div>
        {!loading && (
          <div
            style={{
              background: "#f8f9fb",
              borderRadius: "10px",
              padding: "10px 14px",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "12px", fontWeight: 600, color: "#888", marginBottom: "6px" }}>
              {currentYear}년 보장휴가 사용 현황
            </div>
            {yearStats.length === 0 ? (
              <div style={{ fontSize: "13px", color: "#aaa" }}>올해 사용한 보장휴가가 없어요</div>
            ) : (
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#1b3a5c" }}>
                {yearStats.map((s) => `${s.type} ${s.count}`).join(" · ")}
              </div>
            )}
          </div>
        )}
        <div style={modal.countText}>오늘부터 이후 신청 내역이에요</div>
        {loading && <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>불러오는 중...</div>}
        {!loading && list.length === 0 && (
          <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>예정된 휴가가 없어요</div>
        )}
        {!loading &&
          list.map((v) => {
            const cancelled = v.status === "취소됨";
            return (
              <div
                key={v.id}
                style={{ ...modal.card, flexDirection: "column", alignItems: "stretch", ...(cancelled ? modal.cancelledCard : {}) }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={modal.name}>{v.date} ({weekdayShort(v.date)})</div>
                  <div style={{ display: "flex", alignItems: "center" }}>
                    <div style={modal.dia}>{v.dia}</div>
                    {!cancelled && !v.confirmedBy && (
                      <React.Fragment>
                        <button
                          style={{ ...modal.smallCancelBtn, color: "#1b3a5c" }}
                          onClick={() => handleStartEdit(v)}
                        >
                          수정
                        </button>
                        <button style={modal.smallCancelBtn} onClick={() => handleCancelMine(v)}>
                          취소
                        </button>
                      </React.Fragment>
                    )}
                  </div>
                </div>
                {editingId === v.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                    <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                      <select
                        style={{ ...styles.select, flex: 1.4, marginBottom: 0 }}
                        value={editType}
                        onChange={(e) => setEditType(e.target.value)}
                      >
                        <optgroup label="🟢 보장인원 포함">
                          {CAPACITY_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </optgroup>
                        <optgroup label="⚪ 보장인원 미포함">
                          <option value="청휴">청휴</option>
                        </optgroup>
                      </select>
                      <select
                        style={{ ...styles.select, flex: 1, marginBottom: 0 }}
                        value={editDia}
                        onChange={(e) => setEditDia(e.target.value)}
                      >
                        <option value="">교번 선택</option>
                        {editDia && !branchCodes.includes(editDia) && (
                          <option value={editDia}>{editDia} (기존값)</option>
                        )}
                        {branchCodes.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div style={{ display: "flex", gap: "6px", justifyContent: "flex-end" }}>
                      <button
                        style={adminStyles.approveBtn}
                        disabled={editSaving}
                        onClick={() => handleSaveTypeEdit(v)}
                      >
                        저장
                      </button>
                      <button
                        style={{ ...modal.smallCancelBtn, margin: 0 }}
                        onClick={() => setEditingId(null)}
                      >
                        취소
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={modal.typeRow}>
                    {TYPE_ICON[v.vacationType] || "📌"} {v.vacationType}
                    {v.confirmedBy ? ` · ✅${v.confirmedBy} 확인` : " · 확인 대기중"}
                  </div>
                )}
                {!cancelled && v.confirmedBy && (
                  <div style={{ fontSize: "12px", color: "#1a1a1a", marginTop: "4px" }}>
                    확인완료 · 취소는 관리자에게 문의해주세요
                  </div>
                )}
              </div>
            );
          })}
        <button style={modal.closeBtn} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

function AdminPanel({ onClose, employees, managers }) {
  const [tab, setTab] = useState("pending"); // "pending" | "approved"
  const [pending, setPending] = useState([]);
  const [approved, setApproved] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    waitForFirestore()
      .then(() => Promise.all([window.ApprovalAPI.listPending(), window.ApprovalAPI.listApproved()]))
      .then(([pendingList, approvedList]) => {
        setPending(pendingList);
        setApproved(approvedList);
      })
      .catch((err) => alert("불러오기 실패: " + (err && err.message ? err.message : err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleAction = (id, status) => {
    window.ApprovalAPI.setStatus(id, status).then(() => {
      setPending((prev) => prev.filter((p) => p.id !== id));
    });
  };

  const handleResetDevice = (p) => {
    if (
      !confirm(
        `${p.name} (${p.branch})님의 기기변경을 허용할까요?\n기존 등록 정보가 초기화되고, 새 기기에서 다시 등록 후 재승인을 받아야 해요.`
      )
    )
      return;
    window.ApprovalAPI.reset(p.id).then(() => {
      setApproved((prev) => prev.filter((a) => a.id !== p.id));
    });
  };

  // 인사이동/퇴사로 현재 직원목록에 없는 사람 - 접근 차단 + 그동안의 휴가 기록까지 완전 삭제 (되돌릴 수 없음)
  const handleRemoveDeparted = (p) => {
    if (
      !confirm(
        `${p.name} (${p.branch})님은 현재 직원목록에 없어요.\n\n` +
          `접근을 차단하고, 이 사람이 신청했던 휴가 기록도 전부 삭제할까요?\n` +
          `※ 되돌릴 수 없어요. 단순 기기변경이 필요한 거라면 이 버튼 대신 "기기변경"을 사용해주세요.`
      )
    )
      return;
    Promise.all([window.ApprovalAPI.reset(p.id), window.VacationAPI.removeAllForEmployee(p.id)])
      .then(([, deletedCount]) => {
        alert(`${p.name}님의 접근을 차단하고, 휴가 기록 ${deletedCount}건을 삭제했어요.`);
        setApproved((prev) => prev.filter((a) => a.id !== p.id));
      })
      .catch((err) => alert("처리 실패: " + (err && err.message ? err.message : err)));
  };

  const handleDeleteAll = () => {
    if (
      !confirm(
        "테스트용으로 쌓인 승인 기록을 전부 삭제할까요?\n(대기중·승인됨 전부 지워져서, 다들 처음부터 자유롭게 다시 등록해볼 수 있어요)"
      )
    )
      return;
    window.ApprovalAPI.deleteAll().then((count) => {
      alert(`승인 기록 ${count}건을 삭제했어요.`);
      setPending([]);
      setApproved([]);
    });
  };

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", gap: "6px", marginBottom: "14px" }}>
          <button
            style={tab === "pending" ? adminStyles.tabBtnActive : adminStyles.tabBtn}
            onClick={() => setTab("pending")}
          >
            승인 대기 ({pending.length})
          </button>
          <button
            style={tab === "approved" ? adminStyles.tabBtnActive : adminStyles.tabBtn}
            onClick={() => setTab("approved")}
          >
            승인된 사용자
          </button>
        </div>

        {TEST_MODE && (
          <button
            style={{ ...styles.button, border: "1px dashed #e02020", color: "#e02020", marginBottom: "14px", padding: "10px" }}
            onClick={handleDeleteAll}
          >
            🔄 (테스트용) 승인 기록 전체 삭제
          </button>
        )}

        {loading && <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>불러오는 중...</div>}

        {!loading && tab === "pending" && (
          <React.Fragment>
            {pending.length === 0 && (
              <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>대기중인 요청이 없어요</div>
            )}
            {pending.map((p) => (
              <div key={p.id} style={modal.card}>
                <div>
                  <div style={modal.name}>{p.name}</div>
                  <div style={modal.typeRow}>{p.branch} · {p.id}</div>
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                  <button style={adminStyles.approveBtn} onClick={() => handleAction(p.id, "approved")}>승인</button>
                  <button style={adminStyles.rejectBtn} onClick={() => handleAction(p.id, "rejected")}>거절</button>
                </div>
              </div>
            ))}
          </React.Fragment>
        )}

        {!loading && tab === "approved" && (
          <React.Fragment>
            <div style={{ ...modal.countText, marginBottom: "10px" }}>
              폰을 바꾼 사람은 "기기변경", 인사이동·퇴사로 명단에 없는 사람은 아래 표시와 함께 삭제할 수 있어요
            </div>
            {approved.length === 0 && (
              <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>승인된 사용자가 없어요</div>
            )}
            {approved.map((p) => {
              const stillInRoster =
                (employees || []).some((e) => e.id === p.id) ||
                (managers || []).some((m) => m.name === p.name && m.branch === p.branch);
              return (
                <div key={p.id} style={{ ...modal.card, flexDirection: "column", alignItems: "stretch" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div>
                      <div style={modal.name}>{p.name}</div>
                      <div style={modal.typeRow}>{p.branch} · {p.id}</div>
                    </div>
                    <button style={adminStyles.resetBtn} onClick={() => handleResetDevice(p)}>기기변경</button>
                  </div>
                  {!stillInRoster && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginTop: "8px",
                        paddingTop: "8px",
                        borderTop: "1px dashed #e6e0d0",
                      }}
                    >
                      <div style={{ fontSize: "12px", color: "#e02020", fontWeight: 700 }}>
                        ⚠️ 현재 명단에 없음 (인사이동/퇴사 추정)
                      </div>
                      <button style={adminStyles.rejectBtn} onClick={() => handleRemoveDeparted(p)}>
                        접근 차단+기록 삭제
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </React.Fragment>
        )}

        <button style={modal.closeBtn} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 운용(중간관리자) 인원 관리 패널 (관리자 전용)                          */
/* ------------------------------------------------------------------ */
function ManagerAdminPanel({ branch, onClose }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState("");
  const [newBranch, setNewBranch] = useState(branch || "경산");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    waitForFirestore()
      .then(() => window.ManagerAPI.list())
      .then((data) => setList(data))
      .catch((err) => alert("불러오기 실패: " + (err && err.message ? err.message : err)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) {
      alert("이름을 입력해주세요");
      return;
    }
    if (list.some((m) => m.name === name && m.branch === newBranch)) {
      alert("이미 등록된 이름이에요");
      return;
    }
    setSaving(true);
    window.ManagerAPI.add({ name, branch: newBranch })
      .then(() => {
        setNewName("");
        load();
      })
      .catch((err) => alert("추가 실패: " + (err && err.message ? err.message : err)))
      .finally(() => setSaving(false));
  };

  const handleRemove = (m) => {
    if (!confirm(`${m.name} (${m.branch})님을 운용 명단에서 삭제할까요?`)) return;
    window.ManagerAPI.remove(m.id)
      .then(() => setList((prev) => prev.filter((x) => x.id !== m.id)))
      .catch((err) => alert("삭제 실패: " + (err && err.message ? err.message : err)));
  };

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={modal.dateTitle}>운용 인원 관리</div>
        <div style={{ ...modal.countText, marginBottom: "12px" }}>
          인사이동으로 인원이 바뀌면 여기서 바로 추가/삭제하면 돼요
        </div>

        <div style={{ display: "flex", gap: "6px", marginBottom: "16px" }}>
          <select
            style={{ ...styles.select, flex: "0 0 90px", marginBottom: 0 }}
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
          >
            <option value="경산">경산</option>
            <option value="문양">문양</option>
          </select>
          <input
            style={{ ...styles.select, flex: 1, marginBottom: 0 }}
            placeholder="이름 입력"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button style={adminStyles.approveBtn} disabled={saving} onClick={handleAdd}>
            추가
          </button>
        </div>

        {loading && <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>불러오는 중...</div>}
        {!loading && list.length === 0 && (
          <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>등록된 운용 인원이 없어요</div>
        )}
        {!loading &&
          list.map((m) => (
            <div key={m.id} style={modal.card}>
              <div>
                <div style={modal.name}>{m.name}</div>
                <div style={modal.typeRow}>{m.branch}</div>
              </div>
              <button style={adminStyles.rejectBtn} onClick={() => handleRemove(m)}>삭제</button>
            </div>
          ))}
        <button style={modal.closeBtn} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 가져오기 테스트 패널 (관리자 전용, TEST_MODE에서만 노출)                */
/* 교번앱이 쓰는 검증된 VACATION_API_URL로 경산 휴가 데이터를 가져와        */
/* 확인·집계 후 실제로 저장까지 할 수 있어요                              */
/* ------------------------------------------------------------------ */
function ImportTestPanel({ onClose, employees, managers }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [rows, setRows] = useState([]); // 검증된 VACATION_API_URL에서 받아온 원본 기록들
  const [tab, setTab] = useState("raw"); // "raw" | "tally" | "convert"
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null); // { success, fail }
  const [importedIds, setImportedIds] = useState([]); // 방금 실제로 저장한 기록 id들 (되돌리기용)

  useEffect(() => {
    setLoading(true);
    setError("");

    // 교번앱이 이미 안정적으로 쓰고 있는 검증된 API - 날짜가 이미 완성된 형태("YYYY-MM-DD")로 와서
    // 지난번 같은 날짜 조합 버그가 원천적으로 없어요. 확인란 데이터는 없고, 그건 운용이 앱에서 직접 확인해요.
    jsonpRequest(VACATION_API_URL, {})
      .then((json) => {
        if (!json || !json.ok || !Array.isArray(json.vacations)) {
          throw new Error((json && json.error) || "응답 형식이 예상과 달라요");
        }
        const flat = json.vacations
          .filter((v) => v && v.date && v.name)
          .filter((v) => v.date >= IMPORT_FROM_DATE) // 이 날짜 이전 데이터는 제외
          .map((v) => ({
            date: v.date,
            name: String(v.name).trim(),
            type: v.type ? String(v.type).trim() : "",
            dia: v.dia == null ? "" : v.dia,
            cancelled: !!v.cancelled,
            seq: v.seq || 0,
          }));
        flat.sort((a, b) => a.date.localeCompare(b.date));
        setRows(flat);
      })
      .catch((err) => {
        console.error(err);
        setError("불러오기 실패: " + (err && err.message ? err.message : err));
      })
      .finally(() => setLoading(false));
  }, []);

  const total = rows.length;
  const cancelledCount = rows.filter((r) => r.cancelled).length;
  const activeCount = total - cancelledCount;

  // 이름 -> employeeId 매칭 (직원목록 우선, 없으면 운용 명단에서 확인). 인사이동으로 명단에 없으면 null.
  const matchEmployeeId = (name) => {
    const emp = (employees || []).find((e) => e.name === name && e.branch === "경산");
    if (emp) return emp.id;
    const mgr = (managers || []).find((m) => m.name === name && m.branch === "경산");
    if (mgr) return mgr.id;
    return null;
  };

  // 지금 "기관사 직원목록"에 실제로 있는 사람인지만 확인 (운용으로 넘어간 사람은 제외) - 미래 날짜 필터링용
  const isCurrentLineEmployee = (name) =>
    (employees || []).some((e) => e.name === name && e.branch === "경산");

  // 종류별 집계 미리보기 - 현재 명단에 있는 사람만 집계 (인사이동으로 빠진 사람은 기록은 가져오되 집계에서 제외)
  const NIGHT_COMPANION_TYPES = ["연차비", "분지비", "장재비"];
  const tallyByPerson = {};
  rows.forEach((r) => {
    if (r.cancelled) return;
    if (!isCapacityType(r.type)) return;
    if (NIGHT_COMPANION_TYPES.includes(r.type)) return;
    if (!isCurrentLineEmployee(r.name)) return; // 지금 기관사가 아니면 집계 제외
    if (!tallyByPerson[r.name]) tallyByPerson[r.name] = {};
    tallyByPerson[r.name][r.type] = (tallyByPerson[r.name][r.type] || 0) + 1;
  });
  const tallyList = Object.keys(tallyByPerson)
    .sort((a, b) => a.localeCompare(b, "ko"))
    .map((name) => ({
      name,
      summary: Object.entries(tallyByPerson[name])
        .map(([t, c]) => `${t} ${c}`)
        .join(" · "),
    }));

  // 전체 기간(과거+미래) - 실제 앱에서 쓰는 Firestore 레코드 형태로 변환
  // 과거 ~ 오늘+2일까지는 이미 확정된 거나 마찬가지라 "확인됨"으로 자동 처리하고,
  // 그보다 먼 미래 날짜만 운용이 앱에서 직접 확인하도록 "대기중"으로 남겨둬요.
  // 인사이동으로 명단에 없는 사람: 과거 기록은 그대로 가져오되(이미 지난 사실이니까),
  // 오늘 이후(미래) 기록은 혼란 방지를 위해 아예 제외해요.
  const today = todayStr();
  const cutoffDate = (() => {
    const d = new Date(today + "T00:00:00");
    d.setDate(d.getDate() + 2);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${mo}-${dd}`;
  })();
  const excludedFutureCount = rows.filter((r) => r.date >= today && !isCurrentLineEmployee(r.name)).length;
  const converted = rows
    .filter((r) => isCurrentLineEmployee(r.name) || r.date < today) // 미래+지금 기관사 아닌 사람은 제외
    .map((r) => {
      const matchedId = matchEmployeeId(r.name);
      const autoConfirmed = r.date <= cutoffDate;
      return {
        date: r.date,
        name: r.name,
        branch: "경산",
        employeeId: matchedId || `departed-${r.name}`,
        isDeparted: !isCurrentLineEmployee(r.name),
        vacationType: r.type,
        dia: r.dia,
        status: r.cancelled ? "취소됨" : "정상",
        confirmedBy: autoConfirmed ? "확인" : null,
        priority: isCapacityType(r.type) ? r.seq || 0 : null, // 일단 원본 순번(임시), 아래에서 날짜별로 다시 매김
      };
    });
  // 제외된 사람 때문에 순번에 구멍이 생기지 않도록, 날짜별로 보장휴가 순번을 1번부터 다시 매겨요
  const priorityCounters = {};
  converted
    .filter((c) => c.priority != null)
    .sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority)
    .forEach((c) => {
      priorityCounters[c.date] = (priorityCounters[c.date] || 0) + 1;
      c.priority = priorityCounters[c.date];
    });
  const departedCount = converted.filter((c) => c.isDeparted).length;

  const handleRealImport = () => {
    if (converted.length === 0) {
      alert("가져올 기록이 없어요");
      return;
    }
    if (
      !confirm(
        `전체 ${converted.length}건을 실제로 저장할까요?\n` +
          `(과거 날짜는 이미 사용한 기록으로, 미래 날짜는 확인 대기중으로 들어가요.\n` +
          `달력에 바로 나타나요. 문제 있으면 "방금 저장한 것 되돌리기"로 지울 수 있어요)`
      )
    )
      return;

    setImporting(true);
    setImportResult(null);
    const newIds = [];
    let successCount = 0;
    let failCount = 0;

    const importOne = (c) =>
      window.VacationAPI.add({
        name: c.name,
        branch: c.branch,
        employeeId: c.employeeId,
        vacationType: c.vacationType,
        dia: c.dia,
        date: c.date,
        ...(c.priority != null ? { priority: c.priority } : {}),
      })
        .then((id) => {
          newIds.push(id);
          successCount += 1;
          if (c.status === "취소됨") return window.VacationAPI.cancel(id);
          if (c.confirmedBy) return window.VacationAPI.confirm(id, c.confirmedBy);
        })
        .catch((err) => {
          console.error(err);
          failCount += 1;
        });

    converted
      .reduce((chain, c) => chain.then(() => importOne(c)), Promise.resolve())
      .then(() => {
        setImportedIds((prev) => [...prev, ...newIds]);
        setImportResult({ success: successCount, fail: failCount });
      })
      .finally(() => setImporting(false));
  };

  const handleUndoImport = () => {
    if (importedIds.length === 0) return;
    if (!confirm(`방금 저장한 ${importedIds.length}건을 전부 삭제할까요? (되돌릴 수 없어요)`)) return;
    setImporting(true);
    Promise.all(importedIds.map((id) => window.VacationAPI.remove(id)))
      .then(() => {
        setImportedIds([]);
        setImportResult(null);
        alert("삭제했어요");
      })
      .catch((err) => alert("삭제 중 오류: " + (err && err.message ? err.message : err)))
      .finally(() => setImporting(false));
  };

  // 경산 휴가 기록 전체 삭제 - 중복 저장 등으로 꼬였을 때, 완전히 비우고 처음부터 다시 가져오기 위한 기능
  const handleResetAllBranchData = () => {
    if (
      !confirm(
        "⚠️ 경산 소속의 휴가 기록을 전부 삭제할까요?\n\n" +
          "지금까지 신청/저장된 기록이 전부 사라져요 (되돌릴 수 없어요).\n" +
          "삭제 후 위쪽 '가져오기' 탭에서 다시 '실제로 저장하기'를 누르면 깨끗하게 다시 채울 수 있어요."
      )
    )
      return;
    if (!confirm("정말로 진행할까요? 한 번 더 확인할게요.")) return;
    setImporting(true);
    window.VacationAPI.removeAllForBranch("경산")
      .then((count) => {
        alert(`경산 휴가 기록 ${count}건을 전부 삭제했어요. 이제 다시 가져오기를 눌러주세요.`);
        setImportedIds([]);
        setImportResult(null);
      })
      .catch((err) => alert("삭제 중 오류: " + (err && err.message ? err.message : err)))
      .finally(() => setImporting(false));
  };

  // 예전 코드로 저장된 "가져오기(자동확인)" 문구만 "확인"으로 바꿔주는 일회성 정리 (기존 기록은 그대로 유지)
  const handleFixAutoConfirmLabel = () => {
    setImporting(true);
    window.VacationAPI.fixAutoConfirmLabel()
      .then((count) => {
        alert(`"가져오기(자동확인)" 문구 ${count}건을 "확인"으로 정리했어요.`);
      })
      .catch((err) => alert("정리 중 오류: " + (err && err.message ? err.message : err)))
      .finally(() => setImporting(false));
  };

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={modal.dateTitle}>가져오기 테스트 (검증된 API 사용)</div>
        <div style={{ ...modal.countText, marginBottom: "14px" }}>
          교번앱이 쓰는 안정적인 API예요. {IMPORT_FROM_DATE} 이후 기록만 가져와요. 아직 Firestore엔 저장 안 해요 - 확인용이에요.
        </div>

        {loading && <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>불러오는 중...</div>}
        {!loading && error && (
          <div style={{ color: "#e02020", fontSize: "13px", padding: "10px 0", whiteSpace: "pre-wrap" }}>
            {error}
          </div>
        )}

        {!loading && (
          <React.Fragment>
            <div style={{ display: "flex", gap: "5px", marginBottom: "14px" }}>
              <button style={tab === "raw" ? adminStyles.tabBtnActive : adminStyles.tabBtn} onClick={() => setTab("raw")}>
                전체 ({total})
              </button>
              <button style={tab === "tally" ? adminStyles.tabBtnActive : adminStyles.tabBtn} onClick={() => setTab("tally")}>
                종류별 집계
              </button>
              <button
                style={tab === "convert" ? adminStyles.tabBtnActive : adminStyles.tabBtn}
                onClick={() => setTab("convert")}
              >
                가져오기
              </button>
            </div>

            {tab === "raw" && (
              <React.Fragment>
                <div
                  style={{
                    background: "#f8f9fb",
                    borderRadius: "10px",
                    padding: "10px 14px",
                    marginBottom: "16px",
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#1b3a5c",
                  }}
                >
                  전체 {total}건 · 정상 {activeCount} · 취소 {cancelledCount}
                </div>
                {rows.length === 0 && (
                  <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>불러온 데이터가 없어요</div>
                )}
                {rows.map((r, idx) => (
                  <div key={idx} style={{ ...modal.card, flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={modal.name}>{r.date} · {r.name}</div>
                      <div style={modal.dia}>{r.dia}</div>
                    </div>
                    <div style={modal.typeRow}>
                      {r.type || "(종류 없음)"}
                      {r.cancelled ? " · 취소됨" : ""}
                    </div>
                  </div>
                ))}
              </React.Fragment>
            )}

            {tab === "tally" && (
              <React.Fragment>
                <div style={{ ...modal.countText, marginBottom: "10px" }}>
                  현재 직원목록/운용명단에 있는 사람만 집계 (인사이동으로 빠진 사람 제외) · 취소·연차비류 제외
                </div>
                {tallyList.length === 0 && (
                  <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>집계할 기록이 없어요</div>
                )}
                {tallyList.map((t) => (
                  <div key={t.name} style={modal.card}>
                    <div>
                      <div style={modal.name}>{t.name}</div>
                      <div style={modal.typeRow}>{t.summary}</div>
                    </div>
                  </div>
                ))}
              </React.Fragment>
            )}

            {tab === "convert" && (
              <React.Fragment>
                <div style={{ ...modal.countText, marginBottom: "10px" }}>
                  전체 기간을 Firestore 형태로 변환한 미리보기예요 (오늘: {today}, {cutoffDate}까지는 자동 확인 처리)
                  {departedCount > 0 && (
                    <span style={{ color: "#e08a20", fontWeight: 700 }}>
                      {" "}
                      (⚠️ 과거 기록 중 인사이동 등으로 명단에 없는 사람 {departedCount}건 - 기록은 그대로 가져오되 집계엔 안 잡혀요)
                    </span>
                  )}
                  {excludedFutureCount > 0 && (
                    <span style={{ color: "#e02020", fontWeight: 700 }}>
                      {" "}
                      (🚫 오늘 이후 날짜 중 명단에 없는 사람 {excludedFutureCount}건은 혼란 방지를 위해 아예 제외했어요)
                    </span>
                  )}
                </div>

                <button
                  style={{ ...adminStyles.approveBtn, width: "100%", padding: "12px", marginBottom: "8px" }}
                  disabled={importing || converted.length === 0}
                  onClick={handleRealImport}
                >
                  {importing ? "저장 중..." : `실제로 저장하기 (${converted.length}건)`}
                </button>

                {importResult && (
                  <div
                    style={{
                      background: "#f8f9fb",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      marginBottom: "8px",
                      fontSize: "13px",
                      fontWeight: 700,
                      color: "#1b3a5c",
                    }}
                  >
                    저장 완료: 성공 {importResult.success}건 · 실패 {importResult.fail}건 — 달력에서 확인해보세요!
                  </div>
                )}

                {importedIds.length > 0 && (
                  <button
                    style={{ ...styles.button, border: "1px dashed #e02020", color: "#e02020", marginBottom: "8px", padding: "10px" }}
                    disabled={importing}
                    onClick={handleUndoImport}
                  >
                    🔄 방금 저장한 {importedIds.length}건 되돌리기(삭제)
                  </button>
                )}

                <button
                  style={{ ...styles.button, border: "1px dashed #1b3a5c", color: "#1b3a5c", marginBottom: "8px", padding: "10px" }}
                  disabled={importing}
                  onClick={handleFixAutoConfirmLabel}
                >
                  ✏️ "가져오기(자동확인)" → "확인"으로 문구만 정리
                </button>

                <button
                  style={{ ...styles.button, border: "1px dashed #e02020", color: "#e02020", marginBottom: "14px", padding: "10px" }}
                  disabled={importing}
                  onClick={handleResetAllBranchData}
                >
                  🗑️ 경산 전체 초기화 (모든 휴가 기록 삭제)
                </button>

                {converted.length === 0 && (
                  <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>가져올 기록이 없어요</div>
                )}
                {converted.map((c, idx) => (
                  <div key={idx} style={{ ...modal.card, flexDirection: "column", alignItems: "stretch" }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <div style={modal.name}>{c.date} · {c.name}</div>
                      <div style={modal.dia}>{c.dia}</div>
                    </div>
                    <div style={modal.typeRow}>
                      {c.vacationType} · {c.status}
                      {c.confirmedBy ? " · ✅확인됨" : " · 확인 대기중"}
                    </div>
                    {c.isDeparted && (
                      <div style={{ fontSize: "11px", color: "#e08a20", marginTop: "2px" }}>
                        ⚠️ 현재 명단에 없는 사람 (집계 제외)
                      </div>
                    )}
                  </div>
                ))}
              </React.Fragment>
            )}
          </React.Fragment>
        )}

        <button style={modal.closeBtn} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
