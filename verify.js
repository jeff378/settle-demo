// 매칭 엔진 검증 — index.html의 <script>에서 1~6절(데이터 + 엔진)만 떼어내 돌립니다.
// 실행: node verify.js
const fs = require("fs");
const path = require("path");
const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");

const script = html.split(/<script>\n"use strict";/)[1];
if (!script) throw new Error("script 블록을 찾지 못했습니다");
const engineOnly = script.split("   7. 렌더링")[0].replace(/\/\*\s*═+\s*$/, "");

const sandbox = {};
new Function("exports", engineOnly + "\n;Object.assign(exports,{SAMPLE_INTERNAL,SAMPLE_STATEMENT,SAMPLE_PERIOD,analyze,nameSim,CAUSE_LABEL,CAUSES});")(sandbox);

const { SAMPLE_INTERNAL, SAMPLE_STATEMENT, SAMPLE_PERIOD, analyze, nameSim, CAUSE_LABEL } = sandbox;
const R = analyze(SAMPLE_INTERNAL, SAMPLE_STATEMENT, SAMPLE_PERIOD);

const w = n => (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("en-US");
let fail = 0;
const check = (label, actual, expected) => {
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(30)} ${String(w(actual)).padStart(12)}${ok ? "" : "  (기대 " + w(expected) + ")"}`);
};

console.log("=== 합계 ===");
check("내부 합계", R.internalTotal, 4471000);
check("명세서 합계", R.statementTotal, 3862000);
check("총 차액", R.gap, -609000);
check("설명된 금액", R.explained, -609000);
check("미설명 잔액", R.residual, 0);

console.log("\n=== 매칭 단계 ===");
const stageExp = { 1: 8, 2: 5, 3: 1, 4: 1 };
for (const [s, e] of Object.entries(stageExp)) check(`${s}단계 매칭 건수`, R.stageCount[s], e);
check("미매칭 (내부)", R.inn.filter(r => !r.matched).length, 4);
check("미매칭 (명세서)", R.st.filter(r => !r.matched).length, 3);

console.log("\n=== 원인별 ===");
const expected = {
  오기재: [-58000, 2], 취소처리누락: [-358000, 2], 중복예약오류: [-270000, 1],
  매출미반영: [307000, 2], 이월가능성: [-260000, 1], 취소수수료: [30000, 1], 폴리오통합: [0, 1]
};
for (const [k, v] of Object.entries(R.causeAgg)) {
  const e = expected[k];
  const ok = e && e[0] === v.amount && e[1] === v.count;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${CAUSE_LABEL[k].padEnd(14)} ${String(w(v.amount)).padStart(10)}  ${v.count}건${ok ? "" : "  (기대 " + (e ? w(e[0]) + " / " + e[1] + "건" : "없음") + ")"}`);
}
for (const k of Object.keys(expected)) if (!R.causeAgg[k]) { fail++; console.log("FAIL  누락된 원인:", k); }

console.log("\n=== 플랫폼별 미설명 잔액 ===");
for (const p of R.plats) {
  const ok = p.residual === 0;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${p.name}  내부 ${w(p.internal).padStart(9)}  명세서 ${w(p.statement).padStart(9)}  차액 ${w(p.gap).padStart(9)}  잔액 ${w(p.residual)}`);
}

console.log("\n=== 이름 매칭 규칙 ===");
for (const [a, b, want] of [
  ["이서연", "서연 이", "성·이름 순서"],
  ["최준호", "최*호", "부분 마스킹"],
  ["신유겸", "신유겸신유겸", "중복 표기"],
  ["김민서", "김민서", "동일"],
  ["김민서", "박지훈", null],
]) {
  const r = nameSim(a, b);
  const matched = r.score >= 0.75;
  const ok = want ? (matched && r.how === want) : !matched;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  "${a}" ↔ "${b}"  →  ${r.score.toFixed(2)} ${r.how || "(매칭 안 됨)"}${ok ? "" : "  (기대 " + (want || "매칭 안 됨") + ")"}`);
}

console.log("\n=== 개별 판정 ===");
const findI = n => R.inn.find(r => r.고객명 === n);
const dupRows = R.inn.filter(r => r.고객명 === "임채원");
for (const [label, actual, want] of [
  ["정하윤 → 오기재", findI("정하윤").cause, "오기재"],
  ["문가온 → 오기재", findI("문가온").cause, "오기재"],
  ["윤서아 → 취소처리누락", findI("윤서아").cause, "취소처리누락"],
  ["한지우 → 이월가능성", findI("한지우").cause, "이월가능성"],
  ["강도윤 → 폴리오통합", findI("강도윤").cause, "폴리오통합"],
  ["강도윤 → 명세서 3건 묶임", String(findI("강도윤").pairs.length), "3"],
  ["남지호 → 취소처리누락", findI("남지호").cause, "취소처리누락"],
  ["배수진 → 4단계 매칭", String(findI("배수진").stage), "4"],
  ["조은결 → 취소수수료", R.st.find(r => r.고객명 === "조은결").cause, "취소수수료"],
  ["오세훈 → 매출미반영", R.st.find(r => r.고객명 === "오세훈").cause, "매출미반영"],
  ["류하람 → 매출미반영", R.st.find(r => r.고객명 === "류하람").cause, "매출미반영"],
  ["임채원 1건만 매칭", String(dupRows.filter(r => r.matched).length), "1"],
  ["임채원 나머지 → 중복예약오류", dupRows.find(r => !r.matched).cause, "중복예약오류"],
]) {
  const ok = actual === want;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label.padEnd(30)} ${actual}${ok ? "" : "  (기대 " + want + ")"}`);
}

console.log("\n" + (fail === 0 ? "✅ 전부 통과" : `❌ 실패 ${fail}건`));
process.exit(fail === 0 ? 0 : 1);
