import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { workerConfig, createWorker, WorkerError } from "./worker.mjs";

try { loadEnvFile(fileURLToPath(new URL(".env", import.meta.url))); }
catch (error) { if (error.code !== "ENOENT") { console.error(".env 파일을 읽지 못했습니다."); process.exit(1); } }

async function main() {
  const config = workerConfig(), worker = createWorker(config);
  const status = await worker.checkConnection();
  if (process.argv.includes("--check")) {
    console.log(status.ready ? "연결 확인 완료: 외부 봇 전송 모드입니다. 메시지는 보내지 않았습니다." : "인증 확인 완료: 아직 Vercel 직접 전송 모드입니다. 메시지는 보내지 않았습니다.");
    return;
  }
  if (!status.ready) console.log("연결 확인 완료. 사이트를 worker 모드로 전환하면 대기 알림을 가져옵니다.");
  let stopping = false, wake;
  const stop = () => { stopping = true; wake?.(); };
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  console.log("겜마루 알림 봇 시작: 보고서 사이트의 대기 알림을 확인합니다.");
  while (!stopping) {
    let delay = config.pollMs;
    try {
      for (let count = 0; count < 20 && !stopping; count++) {
        const result = await worker.runOne();
        if (!result || result === "rate_limited") break;
        console.log(`알림 처리: ${result}`);
      }
    } catch (error) {
      console.error(error instanceof WorkerError ? error.message : "알림 처리 중 오류가 발생했습니다. 설정과 연결을 확인하세요.");
      if ([401, 403, 409, 429, 503].includes(error.status)) delay = Math.max(delay, 300000);
    }
    if (!stopping) await new Promise((resolve) => { const timer = setTimeout(resolve, delay); wake = () => { clearTimeout(timer); resolve(); }; });
    wake = null;
  }
  console.log("겜마루 알림 봇을 종료했습니다.");
}
main().catch((error) => { console.error(error instanceof WorkerError ? error.message : "봇 시작 실패. 설정을 확인하세요."); process.exitCode = 1; });
