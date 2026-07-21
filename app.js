// app.js - 휴가장부 앱
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

const TEAM_MAP = { ks: "경산", my: "문양" }; // 안심(as)/월배(wb)는 이 앱 대상 아님
const REVERSE_TEAM_MAP = { 경산: "ks", 문양: "my" };

// 중간관리자 명단. 수시로 바뀌면 여기 이름/소속만 수정·추가하면 돼요.
const MID_MANAGERS = [
  { name: "박광훈", branch: "경산" },
  { name: "고병준", branch: "경산" },
  { name: "류인석", branch: "경산" },
  { name: "김성대", branch: "경산" },
  { name: "이영식", branch: "경산" },
  { name: "이재환", branch: "경산" },
  { name: "황종만", branch: "경산" },
];

function isMidManagerUser(user) {
  return MID_MANAGERS.some((m) => m.name === user.name && m.branch === user.branch);
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
    fontWeight: 700,
    marginBottom: "24px",
    color: "#1a1a1a",
    textAlign: "center",
  },
  button: {
    width: "100%",
    maxWidth: "360px",
    padding: "16px",
    margin: "6px 0",
    borderRadius: "12px",
    border: "1px solid #e0e0e0",
    background: "#fff",
    fontSize: "16px",
    fontWeight: 600,
    color: "#1a1a1a",
    cursor: "pointer",
  },
  primaryButton: {
    width: "100%",
    maxWidth: "360px",
    padding: "16px",
    margin: "16px 0 6px",
    borderRadius: "12px",
    border: "none",
    background: "#3478f6",
    fontSize: "16px",
    fontWeight: 700,
    color: "#fff",
    cursor: "pointer",
  },
  pinDots: {
    display: "flex",
    gap: "16px",
    margin: "24px 0",
  },
  pinDot: (filled) => ({
    width: "18px",
    height: "18px",
    borderRadius: "50%",
    background: filled ? "#3478f6" : "#e0e0e0",
  }),
  keypad: {
    display: "grid",
    gridTemplateColumns: "repeat(3, 1fr)",
    gap: "20px",
    width: "100%",
    maxWidth: "340px",
  },
  key: {
    aspectRatio: "1",
    width: "100%",
    fontSize: "28px",
    fontWeight: 600,
    borderRadius: "50%",
    border: "none",
    background: "#f5f6f8",
    color: "#1a1a1a",
    boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
  },
  backspaceKey: {
    aspectRatio: "1",
    width: "100%",
    fontSize: "22px",
    borderRadius: "50%",
    border: "none",
    background: "transparent",
    color: "#aaa",
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
    background: "#3478f6",
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
  const [localAuth, setLocalAuth] = useState([]);
  const [branch, setBranch] = useState(null);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [pendingNameId, setPendingNameId] = useState("");
  const [pendingCode, setPendingCode] = useState("");
  const [loginTarget, setLoginTarget] = useState(null);
  const [pinError, setPinError] = useState("");

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
  }, []);

  const branchEmployees = employees.filter(
    (e) => e.branch === branch && !localAuth.some((a) => a.id === e.id)
  );

  /* ---- 최초 설정 흐름 ---- */
  const handleChooseBranch = (b) => {
    setBranch(b);
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
    const emp = branchEmployees.find((e) => e.id === pendingNameId);
    if (!emp) {
      alert("이름을 선택해주세요");
      return;
    }
    if (!pendingCode) {
      alert("교번을 선택해주세요");
      return;
    }
    if (pendingCode !== emp.code) {
      alert("교번이 일치하지 않아요. 본인의 오늘자 현재 교번을 다시 확인해주세요.");
      return;
    }

    if (ADMIN_NAMES.includes(emp.name)) {
      setSelectedEmp(emp);
      setStep("setPin");
      return;
    }

    waitForFirestore()
      .then(() => window.ApprovalAPI.getStatus(emp.id))
      .then((data) => {
        if (data && data.status === "approved") {
          alert("이미 승인되어 사용 중인 계정이에요. 본인이 맞다면 관리자에게 직접 문의해주세요.");
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

  const handleSetPin = (pin) => {
    const updated = [...localAuth, { id: selectedEmp.id, name: selectedEmp.name, branch: selectedEmp.branch, pin }];
    saveLocalAuth(updated);
    setLocalAuth(updated);

    if (ADMIN_NAMES.includes(selectedEmp.name)) {
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

    if (ADMIN_NAMES.includes(loginTarget.name)) {
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

  /* ------------------------------ 화면 렌더링 ------------------------------ */

  if (step === "loading") {
    return <div style={styles.screen}>불러오는 중...</div>;
  }

  // 소속 선택
  if (step === "chooseBranch") {
    return (
      <div style={styles.screen}>
        {installBanner}
        <div style={styles.title}>소속을 선택해주세요</div>
        <button style={styles.button} onClick={() => handleChooseBranch("경산")}>경산승무팀</button>
        <button style={styles.button} onClick={() => handleChooseBranch("문양")}>문양승무팀</button>
      </div>
    );
  }

  // 이름 + 교번 확인 (한 페이지, 드롭다운)
  if (step === "nameAndCode") {
    return (
      <div style={styles.screen}>
        {installBanner}
        <div style={styles.title}>{branch} · 이름과 교번을 선택해주세요</div>
        {branchEmployees.length === 0 && (
          <div style={styles.subText}>표시할 이름이 없어요. 인사이동으로 새로 오신 경우 직원목록 시트 반영 후 다시 시도해주세요.</div>
        )}
        {branchEmployees.length > 0 && (
          <React.Fragment>
            <div style={styles.fieldLabel}>이름</div>
            <select
              style={styles.select}
              value={pendingNameId}
              onChange={(e) => setPendingNameId(e.target.value)}
            >
              <option value="">이름 선택</option>
              {[...branchEmployees]
                .sort((a, b) => a.name.localeCompare(b.name, "ko"))
                .map((emp) => (
                  <option key={emp.id} value={emp.id}>{emp.name}</option>
                ))}
            </select>

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

            <button style={styles.primaryButton} onClick={handleConfirmNameCode}>확인</button>
          </React.Fragment>
        )}
        <button style={{ ...styles.button, border: "none", color: "#888" }} onClick={() => setStep("chooseBranch")}>
          ← 소속 다시 선택
        </button>
      </div>
    );
  }

  // PIN 설정
  if (step === "setPin") {
    return (
      <div style={styles.screen}>
        <div style={styles.title}>사용하실 PIN 4자리를 설정해주세요</div>
        <div style={styles.subText}>이 PIN은 이 휴대폰에만 저장돼요</div>
        <PinPad onComplete={handleSetPin} />
      </div>
    );
  }

  // 재로그인 - 이름 선택
  if (step === "loginName") {
    return (
      <div style={styles.screen}>
        {installBanner}
        <div style={styles.title}>이름을 선택해주세요</div>
        {localAuth.map((a) => (
          <button key={a.id} style={styles.button} onClick={() => handleLoginNameSelect(a)}>
            {a.name} ({a.branch})
          </button>
        ))}
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
    return <MainScreen currentUser={loginTarget || { ...selectedEmp }} employees={employees} />;
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

function formatDateHeader(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${dateStr} ${WEEKDAYS[d.getDay()]}요일`;
}

/* ------------------------------------------------------------------ */
/* 메인 화면 - 월별 달력                                                 */
/* ------------------------------------------------------------------ */
const cal = {
  wrap: { minHeight: "100vh", background: "#f5f6f8", paddingBottom: "40px", overflowX: "hidden" },
  header: {
    padding: "16px 12px 8px",
    background: "#fff",
    borderBottom: "1px solid #eee",
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
    background: "#f0f2f5",
    fontSize: "18px",
    color: "#333",
  },
  monthTitle: { fontSize: "18px", fontWeight: 700 },
  weekRow: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    marginTop: "14px",
    textAlign: "center",
    fontSize: "12px",
    color: "#999",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
    gap: "4px",
    padding: "8px 12px 16px",
    boxSizing: "border-box",
  },
  dayCell: (isToday) => ({
    aspectRatio: "1",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "10px",
    background: "#fff",
    border: isToday ? "2px solid #3478f6" : "1px solid #f0f0f0",
    cursor: "pointer",
    position: "relative",
  }),
  dayNum: (type) => ({
    fontSize: "14px",
    fontWeight: 700,
    color: type === "휴일" ? "#e02020" : type === "토요일" ? "#1a73e8" : "#333",
  }),
  dayCode: {
    fontSize: "13px",
    fontWeight: 700,
    color: "#1a1a1a",
    marginTop: "1px",
  },
  dayBadge: (color) => ({
    marginTop: "3px",
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "12px",
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
  "지정교번휴무", "검진공가", "연간지",
];

function isCapacityType(type) {
  return CAPACITY_TYPES.includes(type);
}

// 2026년 공휴일 폴백 목록 (API 호출 실패/오프라인 시에만 사용)
const FALLBACK_HOLIDAYS_2026 = new Set([
  "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18",
  "2026-03-01", "2026-03-02", "2026-05-05", "2026-05-24", "2026-05-25",
  "2026-06-03", "2026-06-06", "2026-08-15", "2026-08-17",
  "2026-09-24", "2026-09-25", "2026-09-26",
  "2026-10-03", "2026-10-05", "2026-10-09", "2026-12-25",
]);

// 수동으로 추가하는 공휴일 (임시공휴일, 선거일 등 API가 놓치는 날짜)
// ⚠️ 필요할 때 이 배열에 "YYYY-MM-DD" 형식으로 날짜만 추가하면 돼요. API 성공 여부와 무관하게 항상 적용됩니다.
const MANUAL_HOLIDAYS = [
  // 예시: "2026-06-03", // 전국동시지방선거
];

// API가 잘못 포함시키는 날짜(실제로는 근무일)를 매년 자동 제외
// 제헌절(7/17): 국경일이지만 2008년부터 법정 공휴일(휴무일) 아님
function isExcludedFakeHoliday(dateStr) {
  return dateStr.endsWith("-07-17");
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

const GUARANTEE = { 평일: 4, 토요일: 5, 휴일: 7 };

// activeRecords: 취소 아닌 전체 기록 (비번 감지는 전체 기록 대상)
function gyeongsanCapacity(dateStr, activeRecords, holidaySet) {
  let base = GUARANTEE[getDayType(dateStr, holidaySet)];
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
    maxHeight: "85vh",
    overflowY: "auto",
    borderRadius: "20px 20px 0 0",
    padding: "20px",
  },
  dateTitle: { fontSize: "18px", fontWeight: 700, marginBottom: "4px" },
  countText: { fontSize: "14px", color: "#888", marginBottom: "16px" },
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
  typeRow: { fontSize: "13px", color: "#888", marginTop: "2px" },
  dia: { fontSize: "14px", fontWeight: 700, color: "#3478f6" },
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
    background: "#3478f6",
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
    border: active ? "1px solid #3478f6" : "1px solid #ddd",
    background: active ? "#eaf1ff" : "#fff",
    color: active ? "#3478f6" : "#666",
    fontSize: "13px",
    fontWeight: 600,
  }),
};

const VACATION_TYPES = [...CAPACITY_TYPES, ...NON_CAPACITY_TYPES];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function MainScreen({ currentUser, employees }) {
  const isAdmin = ADMIN_NAMES.includes(currentUser.name);
  const isMidManager = isMidManagerUser(currentUser);
  const [showAdmin, setShowAdmin] = useState(false);
  const myCode = (employees || []).find((e) => e.id === currentUser.id)?.code || "";
  const myBaseCode = (employees || []).find((e) => e.id === currentUser.id)?.baseCode || "";
  const myTeamKey = REVERSE_TEAM_MAP[currentUser.branch];
  const myOrder = GYOBUN_ORDER[myTeamKey] || [];

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

  // 중간관리자 - 대신 기록 폼 상태
  const [showManagerForm, setShowManagerForm] = useState(false);
  const [managerTargetId, setManagerTargetId] = useState("");
  const [managerFormType, setManagerFormType] = useState(NON_CAPACITY_TYPES[0]);
  const [managerFormDia, setManagerFormDia] = useState("");
  const [managerSaving, setManagerSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchHolidays(viewYear).then((set) => {
      if (!cancelled) setHolidaySet(set);
    });
    return () => { cancelled = true; };
  }, [viewYear]);

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

  useEffect(() => {
    loadMonth(viewYear, viewMonth);
  }, [viewYear, viewMonth, loadMonth]);

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
  };

  const closeModal = () => {
    setSelectedDate(null);
    setShowRegisterForm(false);
    setShowManagerForm(false);
  };

  const dayRecords = selectedDate
    ? (monthMap[selectedDate] || []).filter((v) => v.branch === currentUser.branch)
    : [];
  const activeRecordsForCapacity = dayRecords.filter((v) => v.status !== "취소됨");
  const activeCount = activeRecordsForCapacity.length;
  const capacityCount = activeRecordsForCapacity.filter((v) => isCapacityType(v.vacationType)).length;
  const gyeongsanInfo =
    currentUser.branch === "경산" && selectedDate
      ? (() => {
          const capacity = gyeongsanCapacity(selectedDate, activeRecordsForCapacity, holidaySet);
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

  const handleSubmitRegister = () => {
    setSaving(true);
    window.VacationAPI.add({
      name: currentUser.name,
      branch: currentUser.branch,
      employeeId: currentUser.id,
      vacationType: formType,
      dia: formDia.trim(),
      date: selectedDate,
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
  const handleTouchStart = (e) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const handleTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 50) {
      changeMonth(dx < 0 ? 1 : -1);
    }
    touchStartX.current = null;
  };

  return (
    <div style={cal.wrap}>
      <div style={cal.header}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: "10px" }}>
          <div style={{ fontWeight: 700, fontSize: "16px" }}>{currentUser?.name}님</div>
          {isAdmin && (
            <button style={adminStyles.adminBtn} onClick={() => setShowAdmin(true)}>승인 관리</button>
          )}
        </div>
        <div style={cal.navRow}>
          <button style={cal.navBtn} onClick={() => changeMonth(-1)}>‹</button>
          <div style={cal.monthTitle}>{viewYear}년 {viewMonth + 1}월</div>
          <button style={cal.navBtn} onClick={() => changeMonth(1)}>›</button>
        </div>
        <div style={cal.weekRow}>
          {WEEKDAYS.map((w, i) => (
            <div key={w} style={{ color: i === 0 ? "#e02020" : i === 6 ? "#1a73e8" : "#999" }}>
              {w}
            </div>
          ))}
        </div>
      </div>

      <div style={cal.grid} onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} style={cal.emptyCell} />;
          const key = `${viewYear}-${pad2(viewMonth + 1)}-${pad2(d)}`;
          const dayType = getDayType(key, holidaySet);
          const branchRecords = (monthMap[key] || []).filter((v) => v.branch === currentUser.branch);
          const activeRecords = branchRecords.filter((v) => v.status !== "취소됨");
          const capacityCount = activeRecords.filter((v) => isCapacityType(v.vacationType)).length;

          let badge = null;
          if (currentUser.branch === "경산") {
            const capacity = gyeongsanCapacity(key, activeRecords, holidaySet);
            const remain = capacity - capacityCount;
            badge = <div style={cal.dayBadge(gyeongsanColor(remain))}>{capacityCount}</div>;
          } else if (activeRecords.length > 0) {
            badge = <div style={cal.dayBadge(badgeColor(activeRecords.length))}>{activeRecords.length}</div>;
          }

          return (
            <div key={i} style={cal.dayCell(key === todayKey)} onClick={() => openDate(d)}>
              <div style={cal.dayNum(dayType)}>{d}</div>
              <div style={cal.dayCode}>{codeForDate(key)}</div>
              {badge}
            </div>
          );
        })}
      </div>

      {loading && <div style={{ textAlign: "center", color: "#aaa", padding: "10px" }}>불러오는 중...</div>}

      {selectedDate && (
        <div style={modal.overlay} onClick={closeModal}>
          <div style={modal.sheet} onClick={(e) => e.stopPropagation()}>
            {!showRegisterForm ? (
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
                {dayRecords.map((v) => (
                  <div
                    key={v.id}
                    style={{ ...modal.card, ...(v.status === "취소됨" ? modal.cancelledCard : {}) }}
                  >
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ fontSize: "20px", marginRight: "10px" }}>
                        {TYPE_ICON[v.vacationType] || "📌"}
                      </div>
                      <div>
                        <div style={modal.name}>{v.name}</div>
                        <div style={modal.typeRow}>
                          {v.branch} · {v.vacationType}
                          {v.status === "취소됨" ? " (취소됨)" : ""}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center" }}>
                      <div style={modal.dia}>{v.dia}</div>
                      {v.status !== "취소됨" && v.employeeId === currentUser.id && (
                        <button style={modal.smallCancelBtn} onClick={() => handleCancel(v)}>
                          취소
                        </button>
                      )}
                      {isAdmin && (
                        <button
                          style={{ ...modal.smallCancelBtn, color: "#999" }}
                          onClick={() => handleAdminDelete(v)}
                        >
                          🗑
                        </button>
                      )}
                    </div>
                  </div>
                ))}
                {dayRecords.length > 0 && dayRecords.some((v) => v.status !== "취소됨") && (
                  <div style={{ marginBottom: "8px" }}>
                    {dayRecords
                      .filter((v) => v.status !== "취소됨")
                      .map((v) =>
                        v.confirmedBy ? (
                          <div key={v.id + "-confirm"} style={{ fontSize: "12px", color: "#1caa5c", marginBottom: "2px" }}>
                            ✅ {v.name} - {v.confirmedBy}님 확인
                          </div>
                        ) : isMidManager ? (
                          <div key={v.id + "-confirm"} style={{ display: "flex", alignItems: "center", marginBottom: "2px" }}>
                            <span style={{ fontSize: "12px", color: "#999", marginRight: "6px" }}>{v.name} - 확인 대기</span>
                            <button
                              style={{ ...modal.smallCancelBtn, color: "#3478f6" }}
                              onClick={() => handleConfirmStamp(v)}
                            >
                              확인 도장
                            </button>
                          </div>
                        ) : (
                          <div key={v.id + "-confirm"} style={{ fontSize: "12px", color: "#ccc", marginBottom: "2px" }}>
                            {v.name} - 확인 대기중
                          </div>
                        )
                      )}
                  </div>
                )}

                <button style={modal.addBtn} onClick={() => setShowRegisterForm(true)}>
                  + 휴가 신청
                </button>
                {isMidManager && (
                  <button style={{ ...modal.addBtn, background: "#1a73e8" }} onClick={openManagerForm}>
                    + 대신 기록 (병가·청휴·교육 등)
                  </button>
                )}
                <button style={modal.closeBtn} onClick={closeModal}>닫기</button>
              </React.Fragment>
            ) : showManagerForm ? (
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
                  <input
                    style={modal.input}
                    value={managerFormDia}
                    onChange={(e) => setManagerFormDia(e.target.value)}
                    placeholder="예: 22, 대1, 27~"
                  />
                </div>

                <button style={modal.addBtn} onClick={handleSubmitManagerRecord} disabled={managerSaving}>
                  {managerSaving ? "저장 중..." : "저장"}
                </button>
                <button style={modal.closeBtn} onClick={() => setShowManagerForm(false)}>취소</button>
              </React.Fragment>
            ) : (
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
                    {CAPACITY_TYPES.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                  <div style={{ fontSize: "12px", marginTop: "6px", color: "#888" }}>
                    병가·청휴·교육 등은 중간관리자가 대신 기록해요
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
            )}
          </div>
        </div>
      )}

      {showAdmin && <AdminPanel onClose={() => setShowAdmin(false)} />}
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
    marginLeft: "auto",
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid #ddd",
    background: "#fff",
    color: "#3478f6",
    fontWeight: 700,
    fontSize: "13px",
  },
};

function AdminPanel({ onClose }) {
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    waitForFirestore()
      .then(() => window.ApprovalAPI.listPending())
      .then((list) => setPending(list))
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

  return (
    <div style={modal.overlay} onClick={onClose}>
      <div style={modal.sheet} onClick={(e) => e.stopPropagation()}>
        <div style={modal.dateTitle}>승인 대기 목록 ({pending.length}명)</div>
        {loading && <div style={{ textAlign: "center", color: "#aaa", padding: "20px 0" }}>불러오는 중...</div>}
        {!loading && pending.length === 0 && (
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
        <button style={modal.closeBtn} onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
