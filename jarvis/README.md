# 나만의 자비스 플랫폼 (AI 해커톤)

참가자가 **아이디로 들어와 자기 PC 카메라·마이크를 연결하고, 서버의 haiku로 자기만의 카메라 앱을 만드는** 해커톤 플랫폼.
코드 없이 **설계도(프롬프트)** 한 장으로 앱이 된다. 졸음 감시관, 자세 코치, 냉장고 셰프, 표정 DJ, 책상 정리 잔소리꾼 등 예시가 들어 있다.

```bash
node server.js                                   # http://localhost:3100  (이 PC에 로그인된 Claude Code 계정으로 claude -p 실행)
ADMIN_PW=비밀번호 TLS_KEY=key.pem TLS_CERT=cert.pem node server.js   # 여러 PC에서 접속할 땐 https 필수 (아래 참고)
MOCK=1 node server.js                            # Claude 없이 UI만 확인
npm test                                         # 로그인→설계도→대화→관찰→현황판 자체 점검
```

## 참가자 화면 `/`
- 아이디+비밀번호 입장(처음 쓰는 아이디면 자동 생성) → **이름**(=호출어)과 **설계도** 작성(자동 저장). 예시 설계도 메뉴에서 골라 고쳐 써도 됨.
- 두 가지 동작 방식, 같이 켜도 됨:
  - 🎙 **듣기**: 이름을 부르면 그 뒤의 말 + 그 순간의 카메라 프레임(JPEG 640px)을 보내고, 답을 TTS로 읽어줌. 대화 기억은 참가자별 `claude --resume` 세션.
  - 👁 **자동 관찰**: 5/10/30초마다 프레임을 보내 설계도대로 판단. 결과는 `{hud, say, alert}` 구조화 출력 → 영상 위 HUD 한 줄, `say`가 있을 때만 말함, `alert`면 테두리가 빨갛게. 최근 HUD 6개를 함께 보내 흐름(상태 변화)을 알 수 있게 함. 관찰 호출은 세션을 잇지 않음(사진이 쌓이면 비대해지므로).
- 👀 버튼/텍스트 입력은 마이크 없이 쓰는 길. 카메라 선택 메뉴로 OBS 같은 가상 카메라 대신 실제 카메라 지정(기본값도 가상 장치는 피함).

## 운영자 화면 `/admin`
참가자별 자비스 이름·설계도·대화 수·관찰 수·마지막 말(5초 갱신), 참가자 삭제. 심사·시연용.

## 운영
- 저장: `data.json` 한 파일(아이디, 비밀번호 해시, 설계도, 대화 로그, Claude 세션 ID). 사진은 저장하지 않음.
- 환경변수: `PORT`(3100) `ADMIN_PW`(admin) `MODEL`(haiku) `DATA`(data.json) `MOCK=1` `TLS_KEY`/`TLS_CERT`
- 관찰 호출은 `watch-sessions/`를 cwd로 띄워서 세션 파일이 `~/.claude/projects/*-watch-sessions/`에 따로 쌓임. 자유롭게 지워도 됨:
  ```bash
  find ~/.claude/projects -path '*watch-sessions*' -name '*.jsonl' -mmin +60 -delete
  ```
- 같은 사람이 동시에 두 번 호출하면 429(대화 중엔 관찰 틱을 건너뜀). haiku 한 호출 3~5초.

## 카메라가 열리려면 https
브라우저는 localhost 또는 https에서만 카메라·마이크를 준다. 참가자 PC에서 서버로 접속하면 https가 필요.
같은 포트로 `http://`로 들어오면 https로 자동 이동. 자체 서명 인증서면 충분(브라우저 경고에서 "고급 → 계속" 한 번):
```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365 -subj "/CN=jarvis" -addext "subjectAltName=IP:192.168.0.178"
```
음성 인식은 크롬 계열만. 아레나 서버(`../server`)와 무관한 독립 앱.
