// app.js - 휴가장부 앱
// 현재 단계: 로그인 흐름 (소속선택 → 이름선택 → 교번확인 → PIN설정 / 재로그인)
// TODO: fetchEmployees()의 실제 API 연동은 추후 처리 (지금은 더미 데이터)

const { useState, useEffect, useCallback } = React;

/* ------------------------------------------------------------------ */
/* 더미 직원 데이터 (실제 API 연동 전까지 임시 사용)                    */
/* 실제 연동 시 이 부분을 fetch(GAS_URL)로 교체할 예정                  */
/* ------------------------------------------------------------------ */
const DUMMY_EMPLOYEES = [
  { id: "E027", name: "이재용", branch: "경산", code: "2d" },
  { id: "E045", name: "권재림", branch: "경산", code: "23~" },
  { id: "E100", name: "홍길동", branch: "문양", code: "5d" },
];

function fetchEmployees() {
  // TODO: 실제 GAS API 연동 예정
  return Promise.resolve(DUMMY_EMPLOYEES);
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
    gap: "12px",
    width: "100%",
    maxWidth: "300px",
  },
  key: {
    padding: "20px 0",
    fontSize: "20px",
    fontWeight: 600,
    borderRadius: "50%",
    border: "1px solid #eee",
    background: "#fff",
    color: "#1a1a1a",
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
        <button style={styles.key} onClick={backspace}>⌫</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* 메인 앱                                                              */
/* ------------------------------------------------------------------ */
function App() {
  // step: "loading" | "chooseBranch" | "chooseName" | "confirmCode" | "setPin" | "loginName" | "loginPin" | "main"
  const [step, setStep] = useState("loading");
  const [employees, setEmployees] = useState([]);
  const [localAuth, setLocalAuth] = useState([]);
  const [branch, setBranch] = useState(null);
  const [selectedEmp, setSelectedEmp] = useState(null);
  const [loginTarget, setLoginTarget] = useState(null);
  const [pinError, setPinError] = useState("");

  useEffect(() => {
    fetchEmployees().then((list) => {
      setEmployees(list);
      const auth = loadLocalAuth();
      setLocalAuth(auth);
      setStep(auth.length > 0 ? "loginName" : "chooseBranch");
    });
  }, []);

  const branchEmployees = employees.filter(
    (e) => e.branch === branch && !localAuth.some((a) => a.id === e.id)
  );

  /* ---- 최초 설정 흐름 ---- */
  const handleChooseBranch = (b) => {
    setBranch(b);
    setStep("chooseName");
  };

  const handleChooseName = (emp) => {
    setSelectedEmp(emp);
    setStep("confirmCode");
  };

  const handleConfirmCode = (chosenCode) => {
    if (chosenCode === selectedEmp.code) {
      setStep("setPin");
    } else {
      alert("교번이 일치하지 않아요. 본인의 현재 교번을 다시 확인해주세요.");
    }
  };

  const handleSetPin = (pin) => {
    const updated = [...localAuth, { id: selectedEmp.id, name: selectedEmp.name, branch: selectedEmp.branch, pin }];
    saveLocalAuth(updated);
    setLocalAuth(updated);
    setStep("main");
  };

  /* ---- 재로그인 흐름 ---- */
  const handleLoginNameSelect = (auth) => {
    setLoginTarget(auth);
    setStep("loginPin");
    setPinError("");
  };

  const handleLoginPin = (pin) => {
    if (loginTarget.pin === pin) {
      setStep("main");
    } else {
      setPinError("PIN이 일치하지 않아요");
    }
  };

  /* ------------------------------ 화면 렌더링 ------------------------------ */

  if (step === "loading") {
    return <div style={styles.screen}>불러오는 중...</div>;
  }

  // 소속 선택
  if (step === "chooseBranch") {
    return (
      <div style={styles.screen}>
        <div style={styles.title}>소속을 선택해주세요</div>
        <button style={styles.button} onClick={() => handleChooseBranch("경산")}>경산승무팀</button>
        <button style={styles.button} onClick={() => handleChooseBranch("문양")}>문양승무팀</button>
      </div>
    );
  }

  // 이름 선택
  if (step === "chooseName") {
    return (
      <div style={styles.screen}>
        <div style={styles.title}>{branch} · 이름을 선택해주세요</div>
        {branchEmployees.length === 0 && (
          <div style={styles.subText}>표시할 이름이 없어요. 인사이동으로 새로 오신 경우 직원목록 시트 반영 후 다시 시도해주세요.</div>
        )}
        {branchEmployees.map((emp) => (
          <button key={emp.id} style={styles.button} onClick={() => handleChooseName(emp)}>
            {emp.name}
          </button>
        ))}
        <button style={{ ...styles.button, border: "none", color: "#888" }} onClick={() => setStep("chooseBranch")}>
          ← 소속 다시 선택
        </button>
      </div>
    );
  }

  // 교번 확인 (본인확인)
  if (step === "confirmCode") {
    // 실제로는 여러 교번 중 본인 것을 고르게 해야 하지만,
    // 여기서는 임시로 정답 포함 3개 보기 예시만 구성
    const options = [selectedEmp.code, "27~", "14d"].sort(() => Math.random() - 0.5);
    return (
      <div style={styles.screen}>
        <div style={styles.title}>{selectedEmp.name}님, 본인의 현재 교번을 선택해주세요</div>
        {options.map((c, i) => (
          <button key={i} style={styles.button} onClick={() => handleConfirmCode(c)}>
            {c}
          </button>
        ))}
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
        <div style={styles.title}>이름을 선택해주세요</div>
        {localAuth.map((a) => (
          <button key={a.id} style={styles.button} onClick={() => handleLoginNameSelect(a)}>
            {a.name} ({a.branch})
          </button>
        ))}
        <button style={{ ...styles.button, border: "none", color: "#888" }} onClick={() => setStep("chooseBranch")}>
          + 새로운 사용자 등록
        </button>
      </div>
    );
  }

  // 재로그인 - PIN 입력
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
    return <MainScreen currentUser={loginTarget || { ...selectedEmp }} />;
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
/* 메인 화면 컴포넌트 (날짜별 조회)                                       */
/* ------------------------------------------------------------------ */
const mainStyles = {
  wrap: { minHeight: "100vh", background: "#f5f6f8", paddingBottom: "80px" },
  header: {
    padding: "20px 20px 12px",
    background: "#fff",
    borderBottom: "1px solid #eee",
  },
  dateInput: {
    width: "100%",
    padding: "12px",
    fontSize: "16px",
    borderRadius: "10px",
    border: "1px solid #ddd",
    marginTop: "8px",
  },
  countBadge: {
    fontSize: "14px",
    color: "#3478f6",
    fontWeight: 700,
    marginTop: "6px",
  },
  list: { padding: "12px 16px" },
  card: {
    background: "#fff",
    borderRadius: "12px",
    padding: "14px 16px",
    marginBottom: "8px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    border: "1px solid #eee",
  },
  nameCol: { display: "flex", flexDirection: "column" },
  name: { fontSize: "16px", fontWeight: 700, color: "#1a1a1a" },
  typeRow: { fontSize: "13px", color: "#888", marginTop: "2px" },
  dia: { fontSize: "15px", fontWeight: 700, color: "#3478f6" },
  cancelledCard: { opacity: 0.45, textDecoration: "line-through" },
  empty: {
    textAlign: "center",
    color: "#aaa",
    padding: "60px 20px",
    fontSize: "15px",
  },
  fab: {
    position: "fixed",
    bottom: "28px",
    right: "20px",
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: "#3478f6",
    color: "#fff",
    fontSize: "28px",
    border: "none",
    boxShadow: "0 4px 12px rgba(0,0,0,0.2)",
    cursor: "pointer",
  },
};

function MainScreen({ currentUser }) {
  const [date, setDate] = useState(todayStr());
  const [vacations, setVacations] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback((d) => {
    setLoading(true);
    waitForFirestore()
      .then(() => window.VacationAPI.getByDate(d))
      .then((list) => {
        // 이름순 정렬, 취소된 건 뒤로
        list.sort((a, b) => {
          if ((a.status === "취소됨") !== (b.status === "취소됨")) {
            return a.status === "취소됨" ? 1 : -1;
          }
          return (a.name || "").localeCompare(b.name || "");
        });
        setVacations(list);
      })
      .catch((err) => {
        console.error(err);
        alert("데이터를 불러오지 못했어요");
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(date);
  }, [date, load]);

  const activeCount = vacations.filter((v) => v.status !== "취소됨").length;

  return (
    <div style={mainStyles.wrap}>
      <div style={mainStyles.header}>
        <div style={{ fontWeight: 700, fontSize: "18px" }}>{currentUser?.name}님</div>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={mainStyles.dateInput}
        />
        <div style={mainStyles.countBadge}>
          {formatDateHeader(date)} · 휴가자 {activeCount}명
        </div>
      </div>

      <div style={mainStyles.list}>
        {loading && <div style={mainStyles.empty}>불러오는 중...</div>}
        {!loading && vacations.length === 0 && (
          <div style={mainStyles.empty}>이 날짜에 등록된 휴가가 없어요</div>
        )}
        {!loading &&
          vacations.map((v) => (
            <div
              key={v.id}
              style={{
                ...mainStyles.card,
                ...(v.status === "취소됨" ? mainStyles.cancelledCard : {}),
              }}
            >
              <div style={mainStyles.nameCol}>
                <div style={mainStyles.name}>{v.name}</div>
                <div style={mainStyles.typeRow}>
                  {v.branch} · {v.vacationType}
                  {v.status === "취소됨" ? " (취소됨)" : ""}
                </div>
              </div>
              <div style={mainStyles.dia}>{v.dia}</div>
            </div>
          ))}
      </div>

      <button style={mainStyles.fab} onClick={() => alert("다음 단계에서 등록 화면을 만들 예정이에요")}>
        +
      </button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
